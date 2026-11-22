// Classroom: chalkboard with chalk doodles, clock, bunting, window and bulletin board behind;
// two student desks with a book stack and a pencil cup in front.
import { Container, Graphics } from 'pixi.js';
import { getScene } from '../../../shared/scenes';
import type { ScenePreset } from './types';

const FLOOR_Y = 1000;
const DESK_TOP = 1088;

const CHALK = { color: 0xf4f1e8, width: 7, cap: 'round', join: 'round' } as const;

export function buildSchoolBackground(width: number, height: number): Container {
  const c = new Container();
  const g = new Graphics();

  // Wall, ceiling strip, skirting and wood floor
  g.rect(0, 0, width, FLOOR_Y).fill(0xe3edd9);
  for (let x = 0; x < width; x += 120) g.rect(x, 0, 60, FLOOR_Y).fill({ color: 0xd8e6cc, alpha: 0.5 });
  g.rect(0, 0, width, 70).fill(0xc7d6bb);
  g.rect(0, FLOOR_Y, width, height - FLOOR_Y).fill(0xc9a074);
  for (let y = FLOOR_Y + 40; y < height; y += 60) g.rect(0, y, width, 4).fill({ color: 0xa97f56, alpha: 0.6 });
  g.rect(0, FLOOR_Y - 18, width, 22).fill(0x8b6a4a);

  // Clock (top centre, above the header area)
  g.circle(540, 150, 62).fill(0x5a6b7a);
  g.circle(540, 150, 52).fill(0xffffff);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.circle(540 + Math.cos(a) * 42, 150 + Math.sin(a) * 42, 3.5).fill(0x5a6b7a);
  }
  g.moveTo(540, 150).lineTo(540, 116).stroke({ color: 0x2b2b2b, width: 6, cap: 'round' });
  g.moveTo(540, 150).lineTo(566, 162).stroke({ color: 0x2b2b2b, width: 6, cap: 'round' });
  g.circle(540, 150, 6).fill(0xf07c5a);

  // Bunting pennants under the ceiling
  const pennant = [0xf07c5a, 0xffd166, 0x2f9c95, 0x5b8bd9, 0xf07c9a];
  g.moveTo(0, 96).quadraticCurveTo(250, 140, 420, 100).stroke({ color: 0x8b6a4a, width: 3 });
  g.moveTo(660, 100).quadraticCurveTo(830, 140, width, 96).stroke({ color: 0x8b6a4a, width: 3 });
  for (let i = 0; i < 6; i++) {
    const x = 20 + i * 66;
    const y = 100 + Math.sin((i / 6) * Math.PI) * 18;
    g.poly([x, y, x + 50, y, x + 25, y + 46]).fill(pennant[i % 5]);
    const x2 = 690 + i * 66;
    const y2 = 104 + Math.sin(((i + 1) / 7) * Math.PI) * 18;
    g.poly([x2, y2, x2 + 50, y2, x2 + 25, y2 + 46]).fill(pennant[(i + 2) % 5]);
  }

  // Chalkboard
  const bx = 130, by = 420, bw = 800, bh = 480;
  g.roundRect(bx - 18, by - 18, bw + 36, bh + 36, 12).fill(0x9a6a48);
  g.rect(bx, by, bw, bh).fill(0x2f5a46);
  g.rect(bx, by, bw, 26).fill({ color: 0xffffff, alpha: 0.04 });
  g.roundRect(bx - 30, by + bh + 14, bw + 60, 20, 6).fill(0x7d5539);
  g.roundRect(bx + 60, by + bh + 4, 40, 12, 4).fill(0xffffff);
  g.roundRect(bx + 120, by + bh + 4, 40, 12, 4).fill(0xffd166);
  g.roundRect(bx + bw - 140, by + bh, 80, 18, 4).fill(0x6b7b8c);

  // Chalk doodles mostly in the strip above the heads and the gap between characters
  // Triangle + circle + square (shapes lesson)
  g.poly([170, 540, 215, 460, 260, 540]).stroke(CHALK);
  g.circle(320, 500, 38).stroke(CHALK);
  g.rect(385, 464, 72, 72).stroke(CHALK);
  // "1 + 2 = 3" with dots: three dots groups
  const dot = (x: number, y: number) => g.circle(x, y, 8).fill(0xf4f1e8);
  dot(500, 480);
  g.moveTo(530, 480).lineTo(560, 480).stroke(CHALK).moveTo(545, 465).lineTo(545, 495).stroke(CHALK);
  dot(585, 470); dot(605, 490);
  g.moveTo(632, 472).lineTo(662, 472).stroke(CHALK).moveTo(632, 488).lineTo(662, 488).stroke(CHALK);
  dot(690, 470); dot(710, 490); dot(730, 470);
  // Smiling sun doodle (right)
  g.circle(850, 500, 32).stroke({ ...CHALK, color: 0xffe08a });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.moveTo(850 + Math.cos(a) * 44, 500 + Math.sin(a) * 44)
      .lineTo(850 + Math.cos(a) * 60, 500 + Math.sin(a) * 60)
      .stroke({ ...CHALK, color: 0xffe08a, width: 5 });
  }
  // Wavy underline and an arrow in the middle gap
  g.moveTo(450, 600).bezierCurveTo(480, 570, 510, 630, 540, 600).bezierCurveTo(570, 570, 600, 630, 630, 600)
    .stroke({ ...CHALK, color: 0xa8e0ff, width: 6 });
  g.moveTo(470, 700).lineTo(600, 700).stroke(CHALK);
  g.poly([600, 684, 630, 700, 600, 716]).fill(0xf4f1e8);
  // Chalk smudges
  g.ellipse(520, 800, 70, 22).fill({ color: 0xffffff, alpha: 0.06 });
  g.ellipse(780, 860, 90, 20).fill({ color: 0xffffff, alpha: 0.05 });

  // Bulletin board (left edge, partly cut)
  g.roundRect(-20, 940 - 520, 100, 300, 8).fill(0x9a6a48);
  g.rect(-20, 432, 88, 276).fill(0xd9a86c);
  const notes = [0xffffff, 0xffd166, 0xa8e0ff, 0xf7b2c4];
  for (let i = 0; i < 4; i++) {
    g.rect(4 + (i % 2) * 6, 450 + i * 64, 54, 50).fill(notes[i]);
    g.circle(31 + (i % 2) * 6, 456 + i * 64, 5).fill(0xf07c5a);
  }

  // Window (right edge, partly cut)
  g.roundRect(960, 400, 160, 340, 10).fill(0xffffff);
  g.rect(974, 414, 132, 312).fill(0xbfe6f5);
  g.circle(1040, 640, 50).fill(0x7cc063);
  g.rect(974, 680, 132, 46).fill(0x8ccf6e);
  g.rect(1034, 414, 10, 312).fill(0xffffff);
  g.rect(974, 560, 132, 10).fill(0xffffff);

  // Cubby shelf low on the wall (left, mostly behind Lupita)
  g.rect(0, 880, 120, 100).fill(0xb98a5f);
  const cubby = [0xf07c5a, 0x5b8bd9, 0xffd166];
  for (let i = 0; i < 3; i++) g.roundRect(6 + i * 38, 892, 32, 80, 4).fill(cubby[i]);

  c.addChild(g);
  return c;
}

function desk(g: Graphics, x: number, w: number, height: number) {
  // Legs (metal) to the floor, front panel, wooden top
  g.rect(x + 20, DESK_TOP + 40, 18, height).fill(0x6b7b8c);
  g.rect(x + w - 38, DESK_TOP + 40, 18, height).fill(0x6b7b8c);
  g.roundRect(x + 10, DESK_TOP + 30, w - 20, 360, 10).fill(0x5d8fb3);
  g.rect(x + 10, DESK_TOP + 30, w - 20, 16).fill(0x4a7798);
  g.roundRect(x + w / 2 - 70, DESK_TOP + 120, 140, 14, 7).fill({ color: 0x4a7798, alpha: 0.8 });
  g.roundRect(x, DESK_TOP, w, 42, 8).fill(0xd9a86c);
  g.rect(x, DESK_TOP + 30, w, 12).fill(0xb8875a);
  // Feet
  g.roundRect(x + 10, height - 10, 40, 10, 4).fill(0x4f5c69);
}

export function buildDesks(width: number, height: number): Container {
  const c = new Container();
  const g = new Graphics();
  desk(g, 80, 435, height);
  desk(g, 540, 435, height);

  // Desk 1: book stack + apple (right side of Lupita, below her face)
  g.roundRect(380, DESK_TOP - 30, 110, 30, 4).fill(0x5b8bd9);
  g.rect(380, DESK_TOP - 26, 8, 22).fill(0xffffff);
  g.roundRect(390, DESK_TOP - 58, 96, 28, 4).fill(0xf07c5a);
  g.roundRect(384, DESK_TOP - 84, 104, 26, 4).fill(0x2f9c95);
  g.circle(160, DESK_TOP - 26, 26).fill(0xe0473c);
  g.rect(158, DESK_TOP - 62, 5, 14).fill(0x6b4a2e);
  g.ellipse(172, DESK_TOP - 56, 12, 6).fill(0x4f9a5b);
  // Open notebook
  g.poly([210, DESK_TOP + 2, 230, DESK_TOP - 12, 330, DESK_TOP - 12, 350, DESK_TOP + 2]).fill(0xffffff);
  g.rect(279, DESK_TOP - 12, 2, 14).fill(0xc0c8d0);

  // Desk 2: pencil cup + eraser + ruler
  g.roundRect(580, DESK_TOP - 70, 60, 70, 8).fill(0xffd166);
  g.rect(590, DESK_TOP - 120, 10, 56).fill(0xf07c5a);
  g.poly([590, DESK_TOP - 120, 600, DESK_TOP - 120, 595, DESK_TOP - 134]).fill(0x3b2620);
  g.rect(606, DESK_TOP - 130, 10, 66).fill(0x5b8bd9);
  g.rect(622, DESK_TOP - 110, 10, 46).fill(0x4f9a5b);
  g.roundRect(800, DESK_TOP - 22, 50, 22, 4).fill(0xf7b2c4);
  g.roundRect(660, DESK_TOP - 6, 130, 10, 2).fill(0xffe08a);
  c.addChild(g);
  return c;
}

export const schoolPreset: ScenePreset = {
  meta: getScene('school'),
  buildBackground: buildSchoolBackground,
  buildForeground: buildDesks,
};
