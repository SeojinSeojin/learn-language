import { normalizeTopic } from '../dialogue/gemini';
import curriculum from '../../curriculum/daily.json';
import type { EpisodeState, Ledger } from './state';

type Episode = { id: string; mode: string; topic: string };
type Day = { theme: string; episodes: Episode[] };

export function validateCurriculum(days: Day[]) {
  const ids = new Set<string>();
  const topics = new Set<string>();
  for (const day of days) {
    if (!day.theme.trim() || day.episodes.length !== 6 ||
        day.episodes.filter((episode) => episode.mode === 'dialogue').length !== 3 ||
        day.episodes.filter((episode) => episode.mode === 'vocab').length !== 3) {
      throw new Error(`Expected three dialogue and three vocab episodes for "${day.theme}".`);
    }
    for (const episode of day.episodes) {
      const topic = normalizeTopic(episode.topic).toLowerCase();
      if (!new RegExp(`^d\\d{2,}-${episode.mode}-[1-3]$`).test(episode.id) || ids.has(episode.id) || topics.has(topic)) {
        throw new Error(`Invalid or duplicate episode ID or topic: ${episode.id}.`);
      }
      ids.add(episode.id);
      topics.add(topic);
    }
  }
  return days;
}

export function nyDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', dateStyle: 'short' }).format(date);
}

function dayNumber(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid publishing date "${date}". Use YYYY-MM-DD.`);
  }
  return +parsed / 86_400_000;
}

export function dailyPlan(date: string, ledger?: Ledger) {
  const days = validateCurriculum(curriculum);
  const index = dayNumber(date) - dayNumber(ledger?.startDate ?? date);
  if (index < 0) throw new Error(`${date} precedes the curriculum start date ${ledger?.startDate}.`);
  const day = days[index];
  if (!day) throw new Error(`Curriculum exhausted for ${date} (day ${index + 1}). Append more days to curriculum/daily.json.`);
  const currentIds = new Set(day.episodes.map(({ id }) => id));
  for (const [id, episode] of Object.entries(ledger?.episodes ?? {})) {
    if ((episode.date === date) !== currentIds.has(id)) {
      throw new Error(`Curriculum date assignment changed for ${id} (${episode.date}). Restore the original queue order and IDs.`);
    }
  }
  return day;
}

/**
 * Inputs for the Short workflow. `preparedRunId` is the Daily run whose `daily-scripts-*` artifact holds this
 * episode's validated script; the child then makes no Gemini request.
 */
export function dispatchInputs(episode: Episode, preparedRunId?: string) {
  return {
    topic: episode.topic,
    mode: episode.mode,
    upload: 'true',
    visibility: 'public',
    scene: 'auto',
    tts_provider: 'edge',
    daily_episode: episode.id,
    ...(preparedRunId ? { prepared_script: `${preparedRunId}/${episode.id}` } : {}),
  };
}

export function isPublished(episode?: EpisodeState) {
  return episode?.status === 'published' && episode.visibility === 'public' && /^[\w-]{11}$/.test(episode.videoId ?? '');
}

export function pendingEpisodes(day: Day, ledger?: Ledger) {
  return day.episodes.filter(({ id }) => !isPublished(ledger?.episodes[id]));
}
