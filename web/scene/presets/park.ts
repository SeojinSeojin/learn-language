// Sunny city park: sky, skyline, trees, a lamp post and a path behind; a hedge with flowers in front.
import { Container, Graphics } from 'pixi.js';
import { getScene } from '../../../shared/scenes';
import type { ScenePreset } from './types';

const HORIZON = 960;
const HEDGE_TOP = 1100;

function cloud(g: Graphics, x: number, y: number, s: number) {
  g.circle(x, y, 34 * s).fill(0xffffff);
  g.circle(x + 40 * s, y - 18 * s, 44 * s).fill(0xffffff);
  g.circle(x + 86 * s, y, 32 * s).fill(0xffffff);
  g.roundRect(x - 30 * s, y, 150 * s, 30 * s, 15 * s).fill(0xffffff);
}

function tree(g: Graphics, x: number, baseY: number, s: number, leaf: number, leafDark: number) {
  g.roundRect(x - 16 * s, baseY - 200 * s, 32 * s, 200 * s, 8 * s).fill(0x7a5236);
  g.circle(x - 60 * s, baseY - 230 * s, 70 * s).fill(leafDark);
  g.circle(x + 60 * s, baseY - 240 * s, 74 * s).fill(leafDark);
  g.circle(x, baseY - 300 * s, 92 * s).fill(leaf);
  g.circle(x - 40 * s, baseY - 250 * s, 60 * s).fill(leaf);
  g.circle(x + 44 * s, baseY - 262 * s, 58 * s).fill(leaf);
  g.circle(x - 26 * s, baseY - 330 * s, 26 * s).fill({ color: 0xffffff, alpha: 0.12 });
}

export function buildParkBackground(width: number, height: number): Container {
  const c = new Container();
  const g = new Graphics();

  // Sky in soft bands
  const bands = [0x8fd3f4, 0x9ed9f5, 0xaedff6, 0xbde5f7, 0xcdebf7];
  const bandH = HORIZON / bands.length;
  bands.forEach((col, i) => g.rect(0, i * bandH, width, bandH + 1).fill(col));

  // Sun (top right, above the header area)
  g.circle(940, 150, 120).fill({ color: 0xfff3b0, alpha: 0.35 });
  g.circle(940, 150, 78).fill(0xffd166);

  cloud(g, 120, 140, 1);
  cloud(g, 520, 470, 0.8);
  cloud(g, 820, 520, 0.6);

  // Distant skyline
  const sky = [
    [0, 820, 90], [80, 760, 70], [150, 840, 110], [250, 720, 80], [330, 800, 90],
    [430, 690, 70], [500, 780, 100], [600, 740, 80], [680, 810, 90], [770, 700, 85], [855, 780, 100], [955, 740, 125],
  ] as const;
  for (const [x, y, w] of sky) {
    g.rect(x, y, w, HORIZON - y).fill(0xb9c7dd);
    for (let wy = y + 20; wy < HORIZON - 30; wy += 34)
      for (let wx = x + 12; wx < x + w - 18; wx += 24) g.rect(wx, wy, 10, 14).fill({ color: 0xffffff, alpha: 0.45 });
  }
  g.rect(0, HORIZON - 70, width, 70).fill({ color: 0xcdebf7, alpha: 0.5 });

  // Rolling grass
  g.rect(0, HORIZON, width, height - HORIZON).fill(0x8ccf6e);
  g.ellipse(200, HORIZON + 10, 380, 60).fill(0x9bd77c);
  g.ellipse(860, HORIZON + 20, 360, 56).fill(0x9bd77c);
  g.rect(0, HORIZON + 40, width, height).fill(0x7cc063);

  // Path winding toward the viewer
  g.poly([500, HORIZON + 30, 580, HORIZON + 30, 760, height, 320, height]).fill(0xe8d6b0);
  g.poly([520, HORIZON + 30, 560, HORIZON + 30, 640, height, 440, height]).fill({ color: 0xf2e4c4, alpha: 0.6 });

  // Trees (background row)
  tree(g, 40, 1000, 1.25, 0x4f9a5b, 0x3f8550);
  tree(g, 1040, 1000, 1.2, 0x4f9a5b, 0x3f8550);
  tree(g, 640, 975, 0.55, 0x5fae69, 0x4f9a5b);
  tree(g, 410, 970, 0.5, 0x5fae69, 0x4f9a5b);

  // Lamp post between the characters
  g.rect(514, 700, 12, 360).fill(0x34495e);
  g.roundRect(500, 1040, 40, 24, 6).fill(0x34495e);
  g.roundRect(496, 660, 48, 50, 10).fill(0x34495e);
  g.roundRect(503, 668, 34, 34, 6).fill(0xfff1b8);
  g.poly([490, 664, 550, 664, 520, 636]).fill(0x34495e);

  // A few flowers in the grass
  for (const [fx, fy, col] of [[160, 1040, 0xffffff], [880, 1050, 0xffd166], [250, 1070, 0xf07c9a], [700, 1060, 0xffffff]] as const) {
    g.circle(fx, fy, 7).fill(col);
    g.circle(fx, fy, 3).fill(0xffb000);
  }
  c.addChild(g);
  return c;
}

export function buildHedge(width: number, height: number): Container {
  const c = new Container();
  const g = new Graphics();
  // Hedge body with a bumpy top
  g.rect(0, HEDGE_TOP, width, 330).fill(0x3f8550);
  for (let x = 0; x <= width + 60; x += 68) g.circle(x, HEDGE_TOP + 8, 42).fill(0x3f8550);
  for (let x = 34; x <= width + 60; x += 68) g.circle(x, HEDGE_TOP + 22, 34).fill(0x4f9a5b);
  for (let x = 10; x < width; x += 96)
    for (let y = HEDGE_TOP + 80; y < HEDGE_TOP + 310; y += 70) g.circle(x + ((y / 10) % 3) * 14, y, 22).fill({ color: 0x4f9a5b, alpha: 0.7 });

  // Flowers dotted on the hedge
  const flowerCols = [0xf07c9a, 0xffffff, 0xffd166, 0xf07c5a];
  let i = 0;
  for (let x = 50; x < width; x += 110) {
    const y = HEDGE_TOP + 40 + ((i * 53) % 160);
    const col = flowerCols[i % flowerCols.length];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      g.circle(x + Math.cos(a) * 9, y + Math.sin(a) * 9, 7).fill(col);
    }
    g.circle(x, y, 6).fill(0xffb000);
    i++;
  }

  // Stone border + lawn down to the bottom
  const lawnTop = HEDGE_TOP + 330;
  g.rect(0, lawnTop, width, 30).fill(0xb8b0a2);
  for (let x = 0; x < width; x += 90) g.rect(x, lawnTop, 4, 30).fill(0x9d9587);
  g.rect(0, lawnTop + 30, width, height - lawnTop - 30).fill(0x7cc063);
  for (let x = 20; x < width; x += 60) {
    const y = lawnTop + 70 + ((x * 7) % 300);
    g.poly([x, y, x + 6, y - 18, x + 12, y]).fill(0x6aae53);
  }

  // Small bird perched on the hedge between the characters
  g.ellipse(520, HEDGE_TOP - 34, 26, 20).fill(0x5b8bd9);
  g.circle(540, HEDGE_TOP - 52, 14).fill(0x5b8bd9);
  g.poly([552, HEDGE_TOP - 54, 566, HEDGE_TOP - 50, 552, HEDGE_TOP - 46]).fill(0xffb000);
  g.circle(544, HEDGE_TOP - 55, 3).fill(0x1e1b22);
  g.ellipse(514, HEDGE_TOP - 30, 14, 9).fill(0x4a74bd);
  g.poly([496, HEDGE_TOP - 38, 474, HEDGE_TOP - 48, 480, HEDGE_TOP - 28]).fill(0x4a74bd);

  // Water bottle + sunglasses resting on the hedge (left, below the face)
  g.roundRect(118, HEDGE_TOP - 110, 44, 104, 12).fill(0x7fd1e8);
  g.rect(118, HEDGE_TOP - 70, 44, 30).fill(0xffffff);
  g.roundRect(126, HEDGE_TOP - 128, 28, 22, 6).fill(0x2f6f6a);
  c.addChild(g);
  return c;
}

export const parkPreset: ScenePreset = {
  meta: getScene('park'),
  buildBackground: buildParkBackground,
  buildForeground: buildHedge,
};
