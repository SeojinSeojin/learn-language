// Registry of implemented (drawable) presets, keyed by the ids in shared/scenes.ts.
import { SCENE_IDS, type SceneId } from '../../../shared/scenes';
import type { ScenePreset } from './types';
import { cafePreset } from './cafe';
import { parkPreset } from './park';
import { schoolPreset } from './school';
import { officePreset } from './office';
import { homePreset } from './home';

export const PRESETS: Record<SceneId, ScenePreset> = {
  cafe: cafePreset,
  park: parkPreset,
  school: schoolPreset,
  office: officePreset,
  home: homePreset,
};

export function getPreset(id: string): ScenePreset {
  const p = (PRESETS as Record<string, ScenePreset | undefined>)[id];
  if (!p) throw new Error(`Scene preset "${id}" is not implemented. Implemented: ${Object.keys(PRESETS).join(', ')}`);
  return p;
}

export const IMPLEMENTED_SCENE_IDS = SCENE_IDS.filter((id) => id in PRESETS);
