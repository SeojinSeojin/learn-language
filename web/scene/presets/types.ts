import type { Container } from 'pixi.js';
import type { SceneMeta } from '../../../shared/scenes';

/**
 * A drawable scene preset. Layers are static (built once per episode):
 *  - background: everything behind the characters (walls, sky, furniture, props)
 *  - foreground: drawn in front of the characters; MUST hide each character's waist
 *    (its top edge must be at or above `placement.y - 40` across `placement.x ± 140`).
 * Characters, gestures and subtitles are shared and drawn by ShortScene/Overlay.
 */
export interface ScenePreset {
  meta: SceneMeta;
  buildBackground(width: number, height: number): Container;
  buildForeground(width: number, height: number): Container;
}
