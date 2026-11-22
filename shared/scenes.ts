// Scene registry metadata (no PixiJS imports, so the Node pipeline can use it too).
// Drawing code for each preset lives in web/scene/presets and is looked up by id.
import type { Pose } from './animation';
import type { Speaker } from './types';

export interface ScenePlacement {
  x: number; // px, character center
  y: number; // px, character base (waist line hidden by the foreground)
  scale: number;
  /** Static base pose offsets for this scene (e.g. arms resting on a desk). */
  pose?: Partial<Pose>;
}

export interface SceneMeta {
  id: string;
  name: string;
  /** Short description passed to Gemini when it chooses a scene. */
  description: string;
  characters: Record<Speaker, ScenePlacement>;
}

export const SCENES = [
  {
    id: 'cafe',
    name: 'Café',
    description: 'A cozy coffee shop with a counter, menu board and cups: ordering drinks or snacks, paying, chatting over coffee.',
    characters: {
      lupita: { x: 290, y: 1160, scale: 1 },
      jisoo: { x: 750, y: 1160, scale: 1 },
    },
  },
  {
    id: 'park',
    name: 'Park',
    description: 'A sunny city park with trees, a path and a bench: meeting friends, weekend plans, weather, pets, exercise, small talk outdoors.',
    characters: {
      lupita: { x: 300, y: 1170, scale: 0.98 },
      jisoo: { x: 740, y: 1170, scale: 0.98 },
    },
  },
  {
    id: 'school',
    name: 'School',
    description: 'A classroom with a chalkboard and desks: classes, homework, exams, asking a classmate or teacher for help, schedules.',
    characters: {
      lupita: { x: 300, y: 1150, scale: 0.96, pose: { innerUpper: 0.2, outerUpper: 0.18 } },
      jisoo: { x: 745, y: 1150, scale: 0.96, pose: { innerUpper: 0.2, outerUpper: 0.18 } },
    },
  },
  {
    id: 'office',
    name: 'Office',
    description: 'A bright office with desks, a monitor and plants: work tasks, meetings, job interviews, asking a coworker for something, emails.',
    characters: {
      lupita: { x: 295, y: 1150, scale: 0.97 },
      jisoo: { x: 750, y: 1150, scale: 0.97 },
    },
  },
  {
    id: 'home',
    name: 'Home',
    description: 'A warm living room and kitchen with a sofa, lamp and kitchen island: family, cooking, chores, guests, daily routines, renting.',
    characters: {
      lupita: { x: 295, y: 1165, scale: 0.98 },
      jisoo: { x: 750, y: 1165, scale: 0.98 },
    },
  },
] as const satisfies readonly SceneMeta[];

export type SceneId = (typeof SCENES)[number]['id'];
export const SCENE_IDS = SCENES.map((s) => s.id) as [SceneId, ...SceneId[]];
export const DEFAULT_SCENE: SceneId = 'cafe';

export function isSceneId(v: unknown): v is SceneId {
  return typeof v === 'string' && (SCENE_IDS as string[]).includes(v);
}

export function getScene(id: string): SceneMeta {
  const s = (SCENES as readonly SceneMeta[]).find((x) => x.id === id);
  if (!s) throw new Error(`Unknown scene "${id}". Allowed: ${SCENE_IDS.join(', ')}`);
  return s;
}
