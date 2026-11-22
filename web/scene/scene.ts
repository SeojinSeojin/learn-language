// The one PixiJS scene used by both the browser preview and the frame renderer.
// One scene preset per episode: the same layers, framing and character placement
// are used for the Mexican Spanish and the Korean sections.
import { Application, Container } from 'pixi.js';
import type { Speaker, Timeline } from '../../shared/types';
import { SPEAKERS } from '../../shared/types';
import { CharacterAnimator } from '../../shared/animation';
import { Character, LOOKS } from './character';
import { Overlay } from './overlay';
import { getPreset } from './presets';

export interface SceneOptions {
  renderer?: 'webgl' | 'canvas';
}

interface Actor {
  view: Character;
  anim: CharacterAnimator;
}

export class ShortScene {
  readonly app = new Application();
  private actors: Actor[] = [];
  private overlay!: Overlay;

  constructor(readonly timeline: Timeline) {}

  async init(opts: SceneOptions = {}) {
    const { width, height } = this.timeline;
    const preset = getPreset(this.timeline.sceneId); // throws for unimplemented presets
    await this.app.init({
      width,
      height,
      resolution: 1,
      antialias: true,
      background: 0xffffff,
      preference: opts.renderer ? [opts.renderer] : ['webgl', 'canvas'],
      preserveDrawingBuffer: true,
      autoStart: false,
      sharedTicker: false,
    });
    this.app.ticker.stop();

    const stage = this.app.stage;
    stage.addChild(preset.buildBackground(width, height));

    const chars = new Container();
    const place = preset.meta.characters;
    for (const speaker of SPEAKERS as readonly Speaker[]) {
      const other = speaker === 'lupita' ? 'jisoo' : 'lupita';
      const p = place[speaker];
      const dir: 1 | -1 = place[other].x > p.x ? 1 : -1;
      const view = new Character(LOOKS[speaker], dir);
      view.position.set(p.x, p.y);
      view.scale.set(p.scale);
      chars.addChild(view);
      this.actors.push({ view, anim: new CharacterAnimator(this.timeline, speaker, dir, p.pose ?? {}) });
    }
    stage.addChild(chars);
    stage.addChild(preset.buildForeground(width, height));

    this.overlay = new Overlay(this.timeline);
    stage.addChild(this.overlay);
    this.update(0);
  }

  get rendererName(): string {
    return this.app.renderer.name;
  }

  /** Pose everything for time t (seconds) and draw one frame. */
  update(t: number) {
    for (const a of this.actors) a.view.apply(a.anim.pose(t));
    this.overlay.update(t);
    this.app.renderer.render(this.app.stage);
  }
}
