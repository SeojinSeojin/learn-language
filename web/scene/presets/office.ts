// Bright office: ceiling lights, a big window with a city skyline, a whiteboard, a shelf and a plant
// behind; a long desk with a monitor (back side), mug, papers and a small plant in front.
import { Container, Graphics } from 'pixi.js';
import { getScene } from '../../../shared/scenes';
import type { ScenePreset } from './types';

const FLOOR_Y = 1010;
const DESK_TOP = 1086;

export function buildOfficeBackground(width: number, height: number): Container {
  const c = new Container();
  const g = new Graphics();

  // Wall, ceiling, floor (carpet tiles)
  g.rect(0, 0, width, FLOOR_Y).fill(0xeef1f5);
  g.rect(0, 0, width, 110).fill(0xdfe4ea);
  for (let x = 0; x < width; x += 180) g.rect(x, 0, 3, 110).fill(0xcfd6de);
  g.rect(0, 108, width, 6).fill(0xc9d1da);
  g.rect(0, FLOOR_Y, width, height - FLOOR_Y).fill(0x8f9cab);
  for (let x = 0; x < width; x += 120) g.rect(x, FLOOR_Y, 3, height - FLOOR_Y).fill({ color: 0x7d8a99, alpha: 0.6 });
  for (let y = FLOOR_Y + 120; y < height; y += 120) g.rect(0, y, width, 3).fill({ color: 0x7d8a99, alpha: 0.6 });
  g.rect(0, FLOOR_Y - 16, width, 18).fill(0xc9d1da);

  // Ceiling light panels with soft glow
  for (const lx of [140, 540, 940]) {
    g.roundRect(lx - 110, 112, 220, 20, 6).fill(0xffffff);
    g.ellipse(lx, 150, 170, 40).fill({ color: 0xfffbe6, alpha: 0.35 });
  }

  // Big window with city skyline (centre/right)
  const wx = 380, wy = 420, ww = 660, wh = 560;
  g.roundRect(wx - 16, wy - 16, ww + 32, wh + 32, 8).fill(0x5a6b7a);
  g.rect(wx, wy, ww, wh).fill(0xa8d8f0);
  g.rect(wx, wy + wh * 0.55, ww, wh * 0.45).fill(0xbfe3f3);
  g.circle(wx + 120, wy + 90, 34).fill({ color: 0xffffff, alpha: 0.7 });
  const towers = [
    [0, 260, 70, 0x6f8fb3], [62, 160, 80, 0x5b7da6], [150, 300, 60, 0x86a3c3], [205, 120, 90, 0x4f6f96],
    [300, 220, 70, 0x6f8fb3], [365, 90, 80, 0x5b7da6], [450, 250, 75, 0x86a3c3], [520, 170, 85, 0x4f6f96], [600, 280, 60, 0x6f8fb3],
  ] as const;
  for (const [ox, oy, w, col] of towers) {
    const x = wx + ox;
    const y = wy + oy;
    g.rect(x, y, w, wy + wh - y).fill(col);
    for (let yy = y + 18; yy < wy + wh - 20; yy += 30)
      for (let xx = x + 10; xx < x + w - 14; xx += 20) g.rect(xx, yy, 9, 14).fill({ color: 0xfff6c9, alpha: 0.75 });
  }
  // Mullions
  g.rect(wx + ww / 3 - 5, wy, 10, wh).fill(0x5a6b7a);
  g.rect(wx + (2 * ww) / 3 - 5, wy, 10, wh).fill(0x5a6b7a);
  g.rect(wx, wy + 250, ww, 10).fill(0x5a6b7a);
  // Window glare
  g.poly([wx + 30, wy, wx + 90, wy, wx + 10, wy + 120, wx, wy + 120, wx, wy + 40]).fill({ color: 0xffffff, alpha: 0.18 });

  // Whiteboard (left) with sticky notes and a marker chart
  g.roundRect(30, 420, 320, 300, 10).fill(0xb9c2cc);
  g.roundRect(42, 432, 296, 276, 6).fill(0xffffff);
  g.moveTo(70, 620).lineTo(120, 560).lineTo(170, 590).lineTo(230, 500)
    .stroke({ color: 0x2f9c95, width: 7, cap: 'round', join: 'round' });
  g.moveTo(70, 470).lineTo(70, 640).lineTo(240, 640).stroke({ color: 0x5a6b7a, width: 4 });
  const sticky = [0xffd166, 0xf7b2c4, 0xa8e0ff];
  sticky.forEach((col, i) => g.rect(258, 450 + i * 74, 62, 60).fill(col));
  g.roundRect(80, 714, 70, 10, 4).fill(0xe0473c);
  g.roundRect(160, 714, 70, 10, 4).fill(0x5b8bd9);

  // Wall shelf with binders under the whiteboard (left edge)
  g.rect(0, 860, 160, 14).fill(0x9a6a48);
  const binders = [0x5b8bd9, 0xf07c5a, 0x2f9c95, 0xffd166];
  binders.forEach((col, i) => g.roundRect(12 + i * 34, 760, 28, 100, 4).fill(col));

  // Tall floor plant between the characters
  g.roundRect(486, 900, 70, 96, 10).fill(0xf0f0f0);
  g.rect(486, 900, 70, 12).fill(0xd9dde2);
  for (const [px, py, rx, ry, rot] of [
    [500, 840, 22, 70, -0.4], [545, 830, 22, 74, 0.35], [520, 800, 20, 80, 0], [480, 870, 18, 50, -0.9], [565, 870, 18, 50, 0.9],
  ] as const) {
    const leaf = new Graphics().ellipse(0, 0, rx, ry).fill(0x3f8550);
    leaf.position.set(px, py);
    leaf.rotation = rot;
    c.addChild(leaf);
  }

  c.addChildAt(g, 0);
  return c;
}

export function buildOfficeDesk(width: number, height: number): Container {
  const c = new Container();
  const g = new Graphics();
  // Long desk: light top, white front panel, darker floor continuation
  g.rect(0, DESK_TOP + 36, width, height - DESK_TOP - 36).fill(0xdfe4ea);
  g.rect(0, DESK_TOP + 36, width, 14).fill(0xc2cad3);
  for (let x = 0; x < width; x += 270) g.rect(x, DESK_TOP + 50, 4, 500).fill({ color: 0xc2cad3, alpha: 0.8 });
  g.rect(0, DESK_TOP + 550, width, height).fill(0x7d8a99);
  g.rect(0, DESK_TOP + 550, width, 10).fill(0x6b7786);
  g.roundRect(-10, DESK_TOP, width + 20, 40, 6).fill(0xe8c9a0);
  g.rect(0, DESK_TOP + 28, width, 12).fill(0xc9a77c);

  // Monitor back (between the characters, below face level)
  g.roundRect(430, DESK_TOP - 160, 190, 128, 12).fill(0x3d4753);
  g.circle(525, DESK_TOP - 96, 10).fill(0x5a6574);
  g.rect(510, DESK_TOP - 34, 30, 30).fill(0x3d4753);
  g.roundRect(470, DESK_TOP - 8, 110, 10, 4).fill(0x2c343d);

  // Mug (left) with steam
  g.roundRect(120, DESK_TOP - 84, 70, 80, 12).fill(0x2f9c95);
  g.roundRect(182, DESK_TOP - 70, 28, 44, 12).stroke({ color: 0x2f9c95, width: 9 });
  g.rect(130, DESK_TOP - 60, 50, 10).fill({ color: 0xffffff, alpha: 0.5 });

  // Paper stack (right of Jisoo's hands, before the side buttons)
  g.rect(660, DESK_TOP - 14, 120, 12).fill(0xffffff);
  g.rect(666, DESK_TOP - 24, 116, 10).fill(0xf4f6f8);
  g.rect(656, DESK_TOP - 34, 122, 10).fill(0xffffff);
  g.roundRect(800, DESK_TOP - 12, 70, 10, 4).fill(0x5b8bd9);

  // Small succulent (far left)
  g.roundRect(28, DESK_TOP - 60, 64, 58, 10).fill(0xf07c5a);
  for (const [lx, ly, r] of [[46, DESK_TOP - 74, 20], [74, DESK_TOP - 76, 20], [60, DESK_TOP - 96, 22]] as const) g.circle(lx, ly, r).fill(0x4f9a5b);

  // Pen holder near the monitor
  g.roundRect(360, DESK_TOP - 60, 44, 58, 8).fill(0x5a6574);
  g.rect(368, DESK_TOP - 96, 8, 40).fill(0xffd166);
  g.rect(382, DESK_TOP - 86, 8, 30).fill(0xe0473c);
  c.addChild(g);
  return c;
}

export const officePreset: ScenePreset = {
  meta: getScene('office'),
  buildBackground: buildOfficeBackground,
  buildForeground: buildOfficeDesk,
};
