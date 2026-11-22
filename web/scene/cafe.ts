// Simple café backdrop and foreground counter (static Graphics, drawn once).
import { Container, Graphics } from 'pixi.js';

export const COUNTER_TOP = 1130;

export function buildCafeBackground(width: number, height: number): Container {
  const c = new Container();
  const g = new Graphics();
  // Wall + wainscot
  g.rect(0, 0, width, height).fill(0xf6e7d3);
  for (let x = 0; x < width; x += 90) g.rect(x, 0, 45, 1000).fill({ color: 0xf1dcc2, alpha: 0.6 });
  g.rect(0, 960, width, 200).fill(0xc98f65);
  for (let x = 20; x < width; x += 120) g.roundRect(x, 985, 90, 150, 10).fill(0xb87e55);
  g.rect(0, 950, width, 16).fill(0x8b5a3c);

  // Ceiling beam + hanging lamps
  g.rect(0, 0, width, 90).fill(0x5a3a2a);
  for (const lx of [200, 540, 880]) {
    g.rect(lx - 3, 90, 6, 120).fill(0x3d2a20);
    g.poly([lx - 60, 260, lx + 60, 260, lx + 34, 206, lx - 34, 206]).fill(0x2f6f6a);
    g.circle(lx, 266, 18).fill({ color: 0xfff1b8, alpha: 0.95 });
    g.circle(lx, 300, 90).fill({ color: 0xfff1b8, alpha: 0.12 });
  }

  // Window with awning and plants
  g.roundRect(330, 430, 420, 400, 18).fill(0x8b5a3c);
  g.roundRect(348, 448, 384, 364, 10).fill(0xbfe6f5);
  g.rect(348, 700, 384, 112).fill(0xa7d9b0);
  g.circle(650, 530, 40).fill({ color: 0xfffbe6, alpha: 0.9 });
  g.rect(532, 448, 16, 364).fill(0x8b5a3c);
  g.rect(348, 620, 384, 14).fill(0x8b5a3c);
  for (let i = 0; i < 7; i++) {
    g.rect(320 + i * 63, 395, 63, 50).fill(i % 2 === 0 ? 0xf07c5a : 0xfff4e6);
  }

  // Chalk menu board (left) and shelf with cups (right)
  g.roundRect(60, 400, 220, 300, 14).fill(0x6e4a36);
  g.roundRect(74, 414, 192, 272, 8).fill(0x2e3b36);
  for (let i = 0; i < 5; i++) g.roundRect(96, 450 + i * 46, 110 + ((i * 37) % 40), 12, 6).fill({ color: 0xf6f1e7, alpha: 0.75 });
  g.circle(226, 456, 12).fill(0xffd166);

  g.rect(800, 610, 230, 18).fill(0x8b5a3c);
  g.rect(800, 760, 230, 18).fill(0x8b5a3c);
  const cupColors = [0xffffff, 0xf07c5a, 0x2f9c95, 0xffd166];
  for (let i = 0; i < 4; i++) {
    g.roundRect(812 + i * 54, 560, 40, 50, 8).fill(cupColors[i]);
    g.roundRect(812 + i * 54, 710, 40, 50, 8).fill(cupColors[(i + 2) % 4]);
  }
  // Potted plant
  g.roundRect(70, 820, 90, 110, 12).fill(0xd9643f);
  for (const [px, py, r] of [[90, 790, 40], [140, 780, 44], [115, 740, 42]] as const) g.circle(px, py, r).fill(0x4f9a5b);
  c.addChild(g);
  return c;
}

export function buildCounter(width: number, height: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.rect(0, COUNTER_TOP, width, height - COUNTER_TOP).fill(0x6e4630);
  g.rect(0, COUNTER_TOP - 8, width, 46).fill(0x9a6a48);
  g.rect(0, COUNTER_TOP + 38, width, 10).fill(0x553422);
  for (let x = 0; x < width; x += 135) g.rect(x, COUNTER_TOP + 48, 6, height).fill({ color: 0x553422, alpha: 0.7 });

  // Cups on the counter: a mug and an iced glass, plus a sugar jar.
  g.roundRect(150, COUNTER_TOP - 100, 86, 96, 14).fill(0xffffff);
  g.roundRect(228, COUNTER_TOP - 80, 30, 50, 12).stroke({ color: 0xffffff, width: 10 });
  g.rect(162, COUNTER_TOP - 90, 62, 12).fill(0x7b4a2e);
  g.roundRect(840, COUNTER_TOP - 140, 80, 136, 10).fill({ color: 0xdff4ff, alpha: 0.9 });
  g.rect(846, COUNTER_TOP - 100, 68, 92).fill(0xa0673f);
  g.rect(852, COUNTER_TOP - 128, 22, 22).fill({ color: 0xffffff, alpha: 0.8 });
  g.rect(882, COUNTER_TOP - 116, 22, 22).fill({ color: 0xffffff, alpha: 0.8 });
  g.rect(872, COUNTER_TOP - 200, 10, 90).fill(0xf07c5a);
  g.roundRect(500, COUNTER_TOP - 70, 80, 66, 12).fill(0x2f9c95);
  g.roundRect(510, COUNTER_TOP - 88, 60, 22, 8).fill(0x247c76);
  c.addChild(g);
  return c;
}
