// Warm living room / kitchen: patterned wallpaper, a curtained window, picture frames, a floor lamp
// and a shelf behind; a kitchen island with a fruit bowl, mug and flower vase in front.
import { Container, Graphics } from 'pixi.js';
import { getScene } from '../../../shared/scenes';
import type { ScenePreset } from './types';

const FLOOR_Y = 1010;
const ISLAND_TOP = 1096;

export function buildHomeBackground(width: number, height: number): Container {
  const c = new Container();
  const g = new Graphics();

  // Wallpaper with soft stripes and little diamonds
  g.rect(0, 0, width, FLOOR_Y).fill(0xf7e1d0);
  for (let x = 0; x < width; x += 100) g.rect(x, 0, 50, FLOOR_Y).fill({ color: 0xf2d4bf, alpha: 0.6 });
  for (let y = 60; y < FLOOR_Y; y += 120)
    for (let x = 75; x < width; x += 100) g.poly([x, y - 9, x + 7, y, x, y + 9, x - 7, y]).fill({ color: 0xe8a98a, alpha: 0.5 });
  // Crown moulding + wainscot
  g.rect(0, 0, width, 40).fill(0xfaf3ea);
  g.rect(0, 40, width, 8).fill(0xe8d3c0);
  g.rect(0, 880, width, FLOOR_Y - 880).fill(0xfaf3ea);
  g.rect(0, 872, width, 10).fill(0xe8d3c0);
  for (let x = 20; x < width; x += 140) g.roundRect(x, 900, 110, 90, 6).stroke({ color: 0xe8d3c0, width: 4 });
  // Wood floor
  g.rect(0, FLOOR_Y, width, height - FLOOR_Y).fill(0xb7835a);
  for (let y = FLOOR_Y + 50; y < height; y += 70) g.rect(0, y, width, 4).fill({ color: 0x9c6c47, alpha: 0.7 });
  // Rug edge peeking out
  g.roundRect(240, FLOOR_Y + 30, 600, 80, 30).fill(0xd97a5a);
  g.roundRect(260, FLOOR_Y + 44, 560, 52, 24).stroke({ color: 0xffd166, width: 4 });

  // Window with curtains (between the characters)
  const wx = 400, wy = 430, ww = 280, wh = 380;
  g.roundRect(wx - 14, wy - 14, ww + 28, wh + 28, 10).fill(0xffffff);
  g.rect(wx, wy, ww, wh).fill(0xbfe6f5);
  g.poly([wx, wy + wh - 60, wx + 90, wy + wh - 100, wx + 190, wy + wh - 90, wx + ww, wy + wh - 120, wx + ww, wy + wh, wx, wy + wh]).fill(0x8ccf6e);
  g.circle(wx + 200, wy + 90, 30).fill({ color: 0xfff3b0, alpha: 0.9 });
  g.rect(wx + ww / 2 - 5, wy, 10, wh).fill(0xffffff);
  g.rect(wx, wy + wh / 2 - 5, ww, 10).fill(0xffffff);
  g.rect(wx - 30, wy + wh + 10, ww + 60, 14).fill(0xe8d3c0);
  // Curtain rod + curtains
  g.roundRect(wx - 80, wy - 40, ww + 160, 12, 6).fill(0x8b5a3c);
  g.circle(wx - 84, wy - 34, 12).fill(0x8b5a3c);
  g.circle(wx + ww + 84, wy - 34, 12).fill(0x8b5a3c);
  for (const side of [-1, 1] as const) {
    const x0 = side < 0 ? wx - 70 : wx + ww + 70;
    const inner = side < 0 ? wx + 30 : wx + ww - 30;
    g.poly([x0, wy - 30, inner, wy - 30, inner - side * 40, wy + 200, x0 + side * -6, wy + wh + 60, x0, wy + wh + 60]).fill(0x2f9c95);
    for (let k = 1; k < 3; k++) {
      const fx = x0 + ((inner - x0) * k) / 3;
      g.moveTo(fx, wy - 28).lineTo(fx - side * 14, wy + wh + 58).stroke({ color: 0x247c76, width: 5 });
    }
    g.roundRect(Math.min(x0, inner - side * 40) - 4, wy + 196, Math.abs(inner - side * 40 - x0) + 8, 14, 6).fill(0xffd166);
  }

  // Picture frames (upper left)
  g.roundRect(60, 430, 150, 120, 6).fill(0x8b5a3c);
  g.rect(72, 442, 126, 96).fill(0xfff4e6);
  g.poly([80, 530, 120, 470, 150, 510, 168, 488, 190, 530]).fill(0x4f9a5b);
  g.circle(170, 465, 12).fill(0xf07c5a);
  g.roundRect(230, 420, 90, 110, 6).fill(0xffd166);
  g.rect(240, 430, 70, 90).fill(0xa8e0ff);
  g.circle(275, 465, 18).fill(0xf2c29b);
  g.rect(255, 485, 40, 35).fill(0xf07c5a);

  // Floating shelf with books, a plant and a jar (upper right)
  g.rect(780, 600, 300, 16).fill(0x8b5a3c);
  const books = [0xf07c5a, 0x5b8bd9, 0xffd166, 0x2f9c95];
  books.forEach((col, i) => g.roundRect(800 + i * 30, 500 + (i % 2) * 14, 26, 100 - (i % 2) * 14, 3).fill(col));
  g.roundRect(950, 548, 56, 52, 8).fill(0xd9643f);
  for (const [lx, ly, r] of [[960, 530, 22], [996, 528, 22], [978, 506, 24]] as const) g.circle(lx, ly, r).fill(0x4f9a5b);
  g.poly([1000, 580, 1020, 640, 1030, 700, 1010, 690]).fill(0x4f9a5b);
  g.roundRect(1030, 556, 40, 44, 8).fill({ color: 0xdff4ff, alpha: 0.9 });

  // Floor lamp (left edge)
  g.rect(64, 700, 10, 300).fill(0x5a3a2a);
  g.roundRect(34, 994, 70, 14, 6).fill(0x5a3a2a);
  g.ellipse(69, 700, 90, 50).fill({ color: 0xfff1b8, alpha: 0.25 });
  g.poly([20, 700, 118, 700, 98, 610, 40, 610]).fill(0xffe2a8);
  g.rect(20, 692, 98, 10).fill(0xf0c27a);

  // Upper kitchen cabinets hint (top right, above the shelf)
  g.roundRect(800, 130, 280, 210, 8).fill(0xa9c9b8);
  g.rect(938, 130, 4, 210).fill(0x8fb3a0);
  g.roundRect(915, 220, 8, 40, 4).fill(0xffffff);
  g.roundRect(957, 220, 8, 40, 4).fill(0xffffff);

  c.addChild(g);
  return c;
}

export function buildIsland(width: number, height: number): Container {
  const c = new Container();
  const g = new Graphics();
  // Island cabinets with doors + knobs
  g.rect(0, ISLAND_TOP + 30, width, 520).fill(0x8fb3a0);
  for (let x = 20; x < width; x += 210) {
    g.roundRect(x, ISLAND_TOP + 60, 190, 460, 10).fill(0xa9c9b8);
    g.roundRect(x + 14, ISLAND_TOP + 74, 162, 432, 6).stroke({ color: 0x8fb3a0, width: 4 });
    g.circle(x + 165, ISLAND_TOP + 110, 7).fill(0xf6f1e7);
  }
  // Toe kick + floor down to the bottom
  g.rect(0, ISLAND_TOP + 550, width, 30).fill(0x5f7f6e);
  g.rect(0, ISLAND_TOP + 580, width, height).fill(0xb7835a);
  for (let y = ISLAND_TOP + 640; y < height; y += 70) g.rect(0, y, width, 4).fill({ color: 0x9c6c47, alpha: 0.7 });
  // Countertop
  g.roundRect(-10, ISLAND_TOP, width + 20, 38, 6).fill(0xf4efe8);
  g.rect(0, ISLAND_TOP + 30, width, 8).fill(0xd9d1c6);

  // Fruit bowl (centre, between the characters)
  g.circle(500, ISLAND_TOP - 56, 26).fill(0xe0473c);
  g.circle(548, ISLAND_TOP - 60, 26).fill(0xf5a524);
  g.circle(526, ISLAND_TOP - 86, 22).fill(0x8cc152);
  g.ellipse(560, ISLAND_TOP - 84, 40, 14).fill(0xffd166);
  g.poly([450, ISLAND_TOP - 50, 600, ISLAND_TOP - 50, 576, ISLAND_TOP, 474, ISLAND_TOP]).fill(0xf6f1e7);
  g.rect(450, ISLAND_TOP - 50, 150, 10).fill(0xd97a5a);

  // Mug (left)
  g.roundRect(140, ISLAND_TOP - 80, 66, 78, 12).fill(0xffd166);
  g.roundRect(198, ISLAND_TOP - 66, 26, 42, 12).stroke({ color: 0xffd166, width: 9 });
  g.circle(173, ISLAND_TOP - 44, 12).fill(0xf07c5a);

  // Cutting board with carrots (right of Jisoo's hands)
  g.roundRect(640, ISLAND_TOP - 14, 200, 14, 5).fill(0xc98f65);
  g.poly([680, ISLAND_TOP - 22, 760, ISLAND_TOP - 30, 760, ISLAND_TOP - 16, 680, ISLAND_TOP - 14]).fill(0xf07c3a);
  g.ellipse(770, ISLAND_TOP - 23, 12, 6).fill(0x4f9a5b);

  // Flower vase (far left)
  g.roundRect(40, ISLAND_TOP - 90, 44, 88, 14).fill(0x5b8bd9);
  g.moveTo(62, ISLAND_TOP - 90).lineTo(54, ISLAND_TOP - 140).stroke({ color: 0x4f9a5b, width: 4 });
  g.moveTo(62, ISLAND_TOP - 90).lineTo(78, ISLAND_TOP - 132).stroke({ color: 0x4f9a5b, width: 4 });
  g.circle(54, ISLAND_TOP - 146, 14).fill(0xf07c9a);
  g.circle(80, ISLAND_TOP - 136, 12).fill(0xffffff);
  c.addChild(g);
  return c;
}

export const homePreset: ScenePreset = {
  meta: getScene('home'),
  buildBackground: buildHomeBackground,
  buildForeground: buildIsland,
};
