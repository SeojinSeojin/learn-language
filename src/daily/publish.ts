import { appendFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { dailyPlan, dispatchInputs, isPublished, nyDate, pendingEpisodes } from './plan';
import { github, readLedger, startLedger, updateEpisode, type EpisodeState } from './state';

interface Run {
  status: string;
  created_at: string;
}

async function runDetails(id: number | string | undefined) {
  return github.request<Run>(`/actions/runs/${id}`);
}

async function settle(id: string, episode: EpisodeState) {
  const runId = episode.runId;
  if (!runId) {
    throw new Error(`Reconcile ${id} (${episode.date}): dispatch result missing for controller ${episode.controller}.`);
  }
  const deadline = Date.now() + 55 * 60_000;
  while ((await runDetails(runId)).status !== 'completed') {
    if (Date.now() >= deadline) throw new Error(`Run ${runId} for ${id} is still active. Retry after it finishes.`);
    await delay(20_000);
  }

  const current = (await readLedger())?.data.episodes[id];
  if (isPublished(current)) return;
  if (current?.runId !== runId) throw new Error(`Unexpected ledger entry for ${id} and run ${runId}.`);

  const { jobs } = await github.request<{ jobs: { steps?: { name: string; conclusion: string }[] }[] }>(
    `/actions/runs/${runId}/attempts/1/jobs?per_page=100`,
  );
  const quota = jobs.some((job) => job.steps?.some((step) =>
    step.name === 'Provider quota stop' && step.conclusion === 'success',
  ));

  if (current.status !== 'dispatched') {
    throw new Error(`${quota ? 'Provider quota exhausted. ' : ''}Reconcile ${id} (${episode.date}): run ${runId} may have uploaded a video without a confirmed public result.`);
  }
  await updateEpisode(id, (entry) => {
    if (entry?.runId !== runId || entry.status !== 'dispatched') throw new Error(`State changed for ${id}.`);
    return { ...entry, status: 'failed' };
  });
  if (quota) throw new Error(`Provider quota exhausted in run ${runId} for ${id}. Stopped the batch.`);
}

async function dispatch(id: string, date: string, ref: string, inputs: ReturnType<typeof dispatchInputs>) {
  const controller = `${process.env.GITHUB_RUN_ID}/${process.env.GITHUB_RUN_ATTEMPT}`;
  const intent: EpisodeState = { date, controller, status: 'dispatched' };
  await updateEpisode(id, (current) => {
    if (current && (current.status !== 'failed' || current.date !== date)) {
      throw new Error(`Cannot dispatch ${id} from state ${current.status}.`);
    }
    return intent;
  });

  const result = await github.request<{ workflow_run_id: number } | undefined>(
    '/actions/workflows/short.yml/dispatches', 'POST', { ref, inputs, return_run_details: true },
  );
  if (!Number.isSafeInteger(result?.workflow_run_id) || !result?.workflow_run_id) {
    throw new Error(`Dispatch result missing for ${id}. Reconcile the ledger before retrying.`);
  }
  const runId = result.workflow_run_id;
  console.log(`Dispatched ${id} to run ${runId}.`);
  await updateEpisode(id, (current) => {
    if (current?.controller !== controller || current.status !== 'dispatched' || current.runId) {
      throw new Error(`Dispatch intent changed for ${id}.`);
    }
    return { ...current, runId };
  });
  await settle(id, { ...intent, runId });
}

function summary(message: string) {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n');
}

export async function publishDaily() {
  const { DAILY_MODE, DAILY_DATE, DEFAULT_BRANCH, GITHUB_RUN_ID } = process.env;
  const preview = DAILY_MODE === 'preview';
  const scheduled = DAILY_MODE === 'scheduled';
  if (!preview && !scheduled && DAILY_MODE !== 'retry') throw new Error('Unknown daily publishing mode.');
  if (!DEFAULT_BRANCH) throw new Error('Default branch missing.');
  const today = nyDate();
  const date = scheduled ? nyDate(new Date((await runDetails(GITHUB_RUN_ID)).created_at)) : DAILY_DATE || today;
  if (DAILY_MODE === 'retry' && (!DAILY_DATE || date > today)) throw new Error('Retry requires an intended date on or before today.');

  const original = (await readLedger())?.data;
  const day = dailyPlan(date, original);
  summary(`## Daily Shorts · ${date} · ${day.theme}\n`);
  if (preview) {
    if (!original) summary('Day 1 preview. The first enabled scheduled run sets the start date.\n');
    summary('Planned workflow inputs (preview only).\n\n' + day.episodes.map((episode) =>
      `- \`${JSON.stringify(dispatchInputs(episode))}\`${isPublished(original?.episodes[episode.id]) ? ' · already published' : ''}`,
    ).join('\n'));
    return;
  }
  if (!original && !scheduled) throw new Error('The first enabled schedule must establish the curriculum start date.');
  if (!original) await startLedger(date);

  let problem: unknown;
  try {
    for (const [id, episode] of Object.entries(original?.episodes ?? {})) {
      if (episode.status !== 'failed' && !isPublished(episode)) await settle(id, episode);
    }
    const ledger = (await readLedger())?.data;
    for (const episode of pendingEpisodes(day, ledger)) {
      await dispatch(episode.id, date, DEFAULT_BRANCH, dispatchInputs(episode));
    }
  } catch (error) {
    problem = error;
    summary(`**Stopped.** ${error instanceof Error ? error.message : String(error)}\n`);
  }

  const final = (await readLedger())?.data;
  summary(day.episodes.map(({ id, topic }) => {
    const episode = final?.episodes[id];
    const status = isPublished(episode) ? `[Published](https://youtube.com/shorts/${episode?.videoId})` : episode?.status ?? 'not started';
    const run = episode?.runId ? ` · [run ${episode.runId}](${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${episode.runId})` : '';
    return `- **${id}** · ${status}${run} · ${topic}`;
  }).join('\n'));
  if (problem) throw problem;
  const remaining = pendingEpisodes(day, final);
  if (remaining.length) throw new Error(`${remaining.length} episode(s) remain for ${date}. Use the daily retry entry point.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishDaily().catch((error: unknown) => {
    summary(`\n**Daily publisher:** ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
