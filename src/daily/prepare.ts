// Prepares validated scripts for a Daily batch in one job, before any Short is dispatched.
//
//   --phase gemini    Gemini (primary) for every pending episode without a valid prepared file. Episodes whose
//                     Gemini request timed out or kept returning 503 after the client's bounded retries are
//                     recorded for the fallback; any other error stops the batch. Sets the step outputs
//                     `date`, `fallback_needed` and `fallback_count`.
//   --phase fallback  Only when fallback_needed: the local Ollama server (started once by
//                     .github/actions/ollama) loads the model once and generates the recorded episodes.
//   --phase check     Re-validates every prepared file of the batch.
//   --find-reusable   Retry support: finds the newest unexpired daily-scripts-<date> artifact on the default
//                     branch and sets the outputs `run_id` / `artifact`.
//
// Episodes come from the curriculum and publishing ledger, or from --episodes <file.json> (smoke tests).
// Files are written to --dir (default out/daily-scripts) as <episodeId>.json; batch state goes to --state.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dailyPlan, pendingEpisodes } from './plan';
import { resolveDailyRun } from './publish';
import { github, readLedger } from './state';
import { generateDialogue } from '../dialogue/gemini';
import { generateVocab } from '../vocab/gemini';
import { geminiTextGenerator, isGeminiFallbackEligible, type TextGenerator } from '../text/provider';
import { ollamaLoadModel, ollamaModel, ollamaTextGenerator, ollamaVersion, type OllamaCallStats } from '../ollama/client';
import { assertEpisodeId, preparedFile, PreparedScriptError, readPreparedScript, writePreparedScript, type EpisodeRef } from '../prepared/script';
import { DEFAULT_GEMINI_MODEL, optionalEnv, parseArgs, requireEnv } from '../util/env';
import { runCli, UserFacingError } from '../util/errors';

export interface EpisodeResult {
  provider: 'gemini' | 'ollama';
  model: string;
  /** Wall-clock generation time for this episode (0 when an earlier artifact was reused). */
  seconds: number;
  reused?: boolean;
  /** Ollama only: model load time reported for this episode's requests (≈0 when the model stayed loaded). */
  loadSeconds?: number;
  requests?: number;
}

export interface FallbackRecord {
  id: string;
  reason: 'timeout' | 'http';
  status?: number;
  message: string;
}

export interface BatchState {
  date: string;
  episodes: EpisodeRef[];
  results: Record<string, EpisodeResult>;
  fallback: FallbackRecord[];
  ollama?: { model: string; version: string; loadSeconds: number; cacheHit?: string; restoreSeconds?: string; downloadSeconds?: string };
}

const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v.trim() : '');
const secs = (ms: number) => Math.round(ms / 100) / 10;

function setOutput(name: string, value: string | number | boolean) {
  console.log(`  → ${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function summary(markdown: string) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
}

function loadEpisodes(file: string): EpisodeRef[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(raw) || !raw.length) throw new UserFacingError(`${file} must be a non-empty JSON array of {id, mode, topic}.`);
  return raw.map((e) => {
    if (!e || typeof e.topic !== 'string' || (e.mode !== 'dialogue' && e.mode !== 'vocab')) throw new UserFacingError(`Invalid episode in ${file}: ${JSON.stringify(e)}`);
    return { id: assertEpisodeId(String(e.id)), mode: e.mode, topic: e.topic };
  });
}

/** Pending (not yet published) episodes of today's Daily batch, or a fixed list for tests. */
export async function resolveEpisodes(episodesFile?: string): Promise<{ date: string; episodes: EpisodeRef[] }> {
  if (episodesFile) return { date: optionalEnv('DAILY_DATE') ?? 'test', episodes: loadEpisodes(episodesFile) };
  const { date, preview } = await resolveDailyRun();
  if (preview) throw new UserFacingError('Preview runs do not prepare scripts.');
  const ledger = (await readLedger())?.data;
  const day = dailyPlan(date, ledger);
  const episodes = pendingEpisodes(day, ledger).map(({ id, mode, topic }) => {
    if (mode !== 'dialogue' && mode !== 'vocab') throw new UserFacingError(`Unknown mode "${mode}" for ${id}.`);
    return { id, mode, topic } as EpisodeRef;
  });
  return { date, episodes };
}

export function generateScript(episode: EpisodeRef, generator: TextGenerator) {
  return episode.mode === 'dialogue'
    ? generateDialogue(episode.topic, { generator, scene: 'auto' })
    : generateVocab(episode.topic, { generator });
}

function saveState(file: string, state: BatchState) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
}

function loadState(file: string): BatchState {
  if (!existsSync(file)) throw new UserFacingError(`Batch state ${file} is missing; run --phase gemini first.`);
  return JSON.parse(readFileSync(file, 'utf8')) as BatchState;
}

/** Phase 1: Gemini for each episode; records outage failures for the fallback instead of stopping. */
export async function prepareWithGemini(opts: { dir: string; stateFile: string; date: string; episodes: EpisodeRef[]; gemini?: () => TextGenerator }) {
  const state: BatchState = { date: opts.date, episodes: opts.episodes, results: {}, fallback: [] };
  let gemini: TextGenerator | undefined;
  const getGemini = () =>
    (gemini ??= opts.gemini?.() ??
      geminiTextGenerator({
        apiKey: requireEnv('GEMINI_API_KEY', 'Create a free key at https://aistudio.google.com/apikey.'),
        model: optionalEnv('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL,
      }));
  try {
    for (const episode of opts.episodes) {
      const file = preparedFile(opts.dir, episode.id);
      if (existsSync(file)) {
        try {
          const { meta } = readPreparedScript(file, episode);
          state.results[episode.id] = { provider: meta.provider, model: meta.model, seconds: 0, reused: true };
          console.log(`✓ ${episode.id}: reusing prepared script (${meta.provider} ${meta.model}).`);
          continue;
        } catch (err) {
          if (!(err instanceof PreparedScriptError)) throw err;
          console.warn(`! ${episode.id}: discarding unusable earlier script. ${err.message}`);
          rmSync(file);
        }
      }
      const generator = getGemini();
      const t0 = performance.now();
      try {
        const script = await generateScript(episode, generator);
        writePreparedScript(opts.dir, episode, generator, script);
        state.results[episode.id] = { provider: 'gemini', model: generator.model, seconds: secs(performance.now() - t0) };
        console.log(`✓ ${episode.id}: ${episode.mode} script from Gemini (${generator.model}) in ${secs(performance.now() - t0)} s.`);
      } catch (err) {
        if (!isGeminiFallbackEligible(err)) throw err;
        state.fallback.push({ id: episode.id, reason: err.reason, status: err.status, message: err.message });
        console.warn(`! ${episode.id}: ${err.message} → queued for the local Qwen fallback.`);
      }
    }
  } finally {
    saveState(opts.stateFile, state);
  }
  return state;
}

/** Phase 2: one already-running Ollama server; the model is loaded once and reused for every episode. */
export async function prepareWithOllama(opts: { dir: string; stateFile: string; host?: string; model?: string }) {
  const state = loadState(opts.stateFile);
  if (!state.fallback.length) {
    console.log('No episodes need the fallback.');
    return state;
  }
  const model = ollamaModel(opts.model);
  const version = await ollamaVersion({ host: opts.host });
  console.log(`Ollama ${version} on localhost; loading ${model} once for ${state.fallback.length} episode(s).`);
  const load = await ollamaLoadModel({ host: opts.host, model });
  state.ollama = {
    model,
    version,
    loadSeconds: secs(load.wallMs),
    cacheHit: process.env.OLLAMA_CACHE_HIT,
    restoreSeconds: process.env.OLLAMA_RESTORE_SECONDS,
    downloadSeconds: process.env.OLLAMA_DOWNLOAD_SECONDS,
  };
  console.log(`Model loaded in ${secs(load.wallMs)} s (Ollama load_duration ${secs(load.loadMs)} s).`);

  const stats: OllamaCallStats[] = [];
  const generator = ollamaTextGenerator({ host: opts.host, model, stats });
  try {
    for (const { id } of state.fallback) {
      const episode = state.episodes.find((e) => e.id === id);
      if (!episode) throw new UserFacingError(`Fallback episode ${id} is not part of the batch.`);
      const before = stats.length;
      const t0 = performance.now();
      // Invalid output after the generator's retry-with-issues throws here: no file is written and the
      // batch stops before any child (and therefore any TTS) runs.
      const script = await generateScript(episode, generator);
      writePreparedScript(opts.dir, episode, generator, script);
      const mine = stats.slice(before);
      state.results[id] = {
        provider: 'ollama',
        model,
        seconds: secs(performance.now() - t0),
        loadSeconds: secs(mine.reduce((n, s) => n + s.loadMs, 0)),
        requests: mine.length,
      };
      console.log(`✓ ${id}: ${episode.mode} script from ${generator.label} in ${state.results[id].seconds} s (${mine.length} request(s), ${mine.reduce((n, s) => n + (s.outputTokens ?? 0), 0)} tokens).`);
    }
  } finally {
    saveState(opts.stateFile, state);
  }
  return state;
}

/** Every episode of the batch has a valid prepared file. */
export function checkPrepared(dir: string, state: BatchState) {
  const problems: string[] = [];
  for (const episode of state.episodes) {
    try {
      readPreparedScript(preparedFile(dir, episode.id), episode);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (problems.length) throw new PreparedScriptError(`Prepared scripts are incomplete:\n${problems.join('\n')}`);
}

export function summarizeBatch(state: BatchState): string {
  const rows = state.episodes.map((e) => {
    const r = state.results[e.id];
    const failed = state.fallback.find((f) => f.id === e.id);
    const source = r ? `${r.provider} \`${r.model}\`${r.reused ? ' (reused)' : ''}` : failed ? 'pending fallback' : 'not prepared';
    const gemini = failed ? (failed.reason === 'timeout' ? 'timeout' : `HTTP ${failed.status}`) : r?.provider === 'gemini' && !r.reused ? 'ok' : '—';
    return `| \`${e.id}\` | ${e.mode} | ${gemini} | ${source} | ${r && !r.reused ? r.seconds : '—'} |`;
  });
  const lines = [
    `### Prepared scripts · ${state.date}`,
    '',
    '| Episode | Mode | Gemini | Script source | Generation (s) |',
    '| --- | --- | --- | --- | ---: |',
    ...rows,
  ];
  if (state.ollama) {
    const o = state.ollama;
    lines.push(
      '',
      `**Qwen fallback:** \`${o.model}\` on Ollama ${o.version} (localhost) · model cache ${o.cacheHit === 'true' ? 'hit' : o.cacheHit === 'false' ? 'miss' : 'n/a'}` +
        `${o.restoreSeconds ? ` · restore ${o.restoreSeconds} s` : ''}${o.downloadSeconds ? ` · download ${o.downloadSeconds} s` : ''} · model load ${o.loadSeconds} s`,
    );
  }
  return lines.join('\n') + '\n';
}

/** Newest unexpired daily-scripts-<date> artifact from a default-branch run (for Daily retry). */
export async function findReusableArtifact(date: string, branch: string) {
  const name = `daily-scripts-${date}`;
  const { artifacts } = await github.request<{
    artifacts: { name: string; expired: boolean; created_at: string; workflow_run?: { id?: number; head_branch?: string } }[];
  }>(`/actions/artifacts?name=${encodeURIComponent(name)}&per_page=30`);
  const usable = artifacts
    .filter((a) => a.name === name && !a.expired && a.workflow_run?.id && a.workflow_run.head_branch === branch)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return usable[0] ? { name, runId: usable[0].workflow_run!.id! } : undefined;
}

async function main() {
  const args = parseArgs();
  const dir = str(args.dir) || 'out/daily-scripts';
  const stateFile = str(args.state) || 'out/daily-prepare/state.json';

  if (args['find-reusable']) {
    const { date } = await resolveDailyRun();
    const branch = process.env.DEFAULT_BRANCH;
    if (!branch) throw new UserFacingError('DEFAULT_BRANCH missing.');
    const found = await findReusableArtifact(date, branch);
    console.log(found ? `Reusing scripts from run ${found.runId} (${found.name}).` : `No earlier scripts for ${date}.`);
    setOutput('run_id', found?.runId ?? '');
    setOutput('artifact', found?.name ?? '');
    return;
  }

  const phase = str(args.phase);
  if (phase === 'gemini') {
    const { date, episodes } = await resolveEpisodes(str(args.episodes) || undefined);
    setOutput('date', date);
    let state: BatchState;
    try {
      state = await prepareWithGemini({ dir, stateFile, date, episodes });
    } catch (err) {
      if (existsSync(stateFile)) summary(summarizeBatch(loadState(stateFile)));
      throw err;
    }
    summary(summarizeBatch(state));
    setOutput('fallback_needed', state.fallback.length > 0);
    setOutput('fallback_count', state.fallback.length);
  } else if (phase === 'fallback') {
    let state: BatchState | undefined;
    try {
      state = await prepareWithOllama({ dir, stateFile });
      checkPrepared(dir, state);
    } finally {
      summary(summarizeBatch(state ?? loadState(stateFile)));
    }
  } else if (phase === 'check') {
    const state = loadState(stateFile);
    checkPrepared(dir, state);
    console.log(`All ${state.episodes.length} prepared script(s) are valid.`);
  } else {
    throw new UserFacingError('Use --phase gemini|fallback|check or --find-reusable.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli(main);
