import { getScene } from '../../../shared/scenes';
import { buildCafeBackground, buildCounter } from '../cafe';
import type { ScenePreset } from './types';

export const cafePreset: ScenePreset = {
  meta: getScene('cafe'),
  buildBackground: buildCafeBackground,
  buildForeground: buildCounter,
};
