// Original, slightly blocky 2D characters built from PixiJS Graphics.
// Every facial feature and limb is its own display object so it can be posed independently.
import { Container, Graphics } from 'pixi.js';
import type { Pose } from '../../shared/animation';

export interface CharacterLook {
  skin: number;
  skinShade: number;
  hair: number;
  shirt: number;
  shirtShade: number;
  accent: number;
  eye: number;
  brow: number;
  style: 'bob' | 'beanie';
}

/** Lupita (루피타): recurring Mexican character. */
export const LOOK_LUPITA: CharacterLook = {
  skin: 0xf2c29b, skinShade: 0xe0a77f, hair: 0x3b2620, shirt: 0xf07c5a, shirtShade: 0xd9643f,
  accent: 0xffd166, eye: 0x2b1d18, brow: 0x3b2620, style: 'bob',
};

/** Jisoo (지수): recurring Korean character. */
export const LOOK_JISOO: CharacterLook = {
  skin: 0xc98b5e, skinShade: 0xb27448, hair: 0x1e1b22, shirt: 0x3a7fc1, shirtShade: 0x2c66a0,
  accent: 0xe0a93b, eye: 0x1e1b22, brow: 0x1e1b22, style: 'beanie',
};

const TORSO_W = 236;
const TORSO_H = 300;
const HEAD_W = 244;
const HEAD_H = 228;
const BROW_DY = -45; // brow centre relative to eye centre (sits in the forehead gap)

interface Arm {
  root: Container; // pivot at shoulder
  elbow: Container; // pivot at elbow
  side: -1 | 1; // -1 = screen-left arm, +1 = screen-right arm
}

interface Eye {
  root: Container;
  pupil: Container;
  lid: Graphics;
  lash: Graphics;
}

export class Character extends Container {
  private body = new Container();
  private head = new Container();
  private face = new Container();
  private arms: { left: Arm; right: Arm };
  private eyes: Eye[] = [];
  private brows: Graphics[] = [];
  private mouth = new Graphics();
  private shoulderY = -TORSO_H + 34;

  /** dir = +1 when the partner stands to the right of this character. */
  constructor(private look: CharacterLook, private dir: 1 | -1) {
    super();
    this.addChild(this.body);

    // Torso (behind arms), neck, collar.
    const neck = new Graphics().rect(-34, -TORSO_H - 30, 68, 60).fill(look.skinShade);
    const torso = new Graphics()
      .roundRect(-TORSO_W / 2, -TORSO_H, TORSO_W, TORSO_H + 40, 30)
      .fill(look.shirt)
      .rect(-TORSO_W / 2 + 18, -40, TORSO_W - 36, 80)
      .fill(look.shirtShade);
    const collar = new Graphics()
      .poly([-46, -TORSO_H, 0, -TORSO_H + 44, 46, -TORSO_H, 26, -TORSO_H, 0, -TORSO_H + 20, -26, -TORSO_H])
      .fill(look.skinShade);
    this.body.addChild(neck, torso, collar);
    if (look.style === 'beanie') {
      // Jisoo: hoodie with drawstrings and a front pocket
      const hoodie = new Graphics()
        .roundRect(-70, -TORSO_H - 6, 140, 34, 14).fill(look.shirtShade)
        .rect(-30, -TORSO_H + 20, 8, 90).fill(0xf6f1e7)
        .rect(22, -TORSO_H + 20, 8, 90).fill(0xf6f1e7)
        .roundRect(-80, -120, 160, 80, 16).fill(look.shirtShade);
      this.body.addChild(hoodie);
    } else {
      // Lupita: embroidered-style yoke stripe
      const yoke = new Graphics().rect(-TORSO_W / 2 + 10, -TORSO_H + 64, TORSO_W - 20, 14).fill(look.accent);
      for (let i = 0; i < 6; i++) yoke.rect(-TORSO_W / 2 + 26 + i * 36, -TORSO_H + 82, 14, 14).fill(0x2f9c95);
      this.body.addChild(yoke);
    }

    this.arms = { left: this.makeArm(-1), right: this.makeArm(1) };

    // Head
    this.head.position.set(0, -TORSO_H - 10);
    this.body.addChild(this.head);
    this.buildHead();
  }

  private makeArm(side: -1 | 1): Arm {
    const look = this.look;
    const root = new Container();
    root.position.set(side * (TORSO_W / 2 - 14), this.shoulderY);
    const upper = new Graphics().roundRect(-29, -20, 58, 150, 18).fill(look.shirt);
    const elbow = new Container();
    elbow.position.set(0, 124);
    const fore = new Graphics().roundRect(-26, -8, 52, 112, 16).fill(look.skin);
    const sleeveEdge = new Graphics().roundRect(-30, -12, 60, 22, 8).fill(look.shirtShade);
    const hand = new Graphics().roundRect(-31, 92, 62, 58, 16).fill(look.skin);
    const thumb = new Graphics().roundRect(side * 18 - 9, 96, 22, 32, 8).fill(look.skinShade);
    elbow.addChild(fore, sleeveEdge, thumb, hand);
    root.addChild(upper, elbow);
    this.body.addChild(root);
    return { root, elbow, side };
  }

  private buildHead() {
    const look = this.look;
    const h = this.head;
    // Ears
    h.addChild(new Graphics().roundRect(-HEAD_W / 2 - 18, -150, 36, 56, 12).fill(look.skinShade));
    h.addChild(new Graphics().roundRect(HEAD_W / 2 - 18, -150, 36, 56, 12).fill(look.skinShade));
    // Head block
    h.addChild(new Graphics().roundRect(-HEAD_W / 2, -HEAD_H, HEAD_W, HEAD_H, 44).fill(look.skin));

    // Hair / hat behind the face features
    if (look.style === 'bob') {
      // Fringe ends at y=-200, leaving a forehead strip for the brows above the eyes.
      h.addChild(new Graphics().roundRect(-HEAD_W / 2 - 16, -HEAD_H - 22, HEAD_W + 32, 50, 24).fill(look.hair));
      h.addChild(new Graphics().roundRect(46, -HEAD_H + 2, 46, 20, 6).fill(look.accent)); // hair clip
    } else {
      h.addChild(
        new Graphics()
          .rect(-HEAD_W / 2 + 4, -HEAD_H + 40, 28, 56).fill(look.hair)
          .rect(HEAD_W / 2 - 32, -HEAD_H + 40, 28, 56).fill(look.hair)
          .roundRect(-HEAD_W / 2 - 10, -HEAD_H - 40, HEAD_W + 20, 72, 36).fill(look.accent)
          .rect(-HEAD_W / 2 - 14, -HEAD_H + 18, HEAD_W + 28, 24).fill(0xc58f2c)
          .roundRect(-22, -HEAD_H - 66, 44, 36, 14).fill(look.accent),
      );
    }

    // Face features live in a container that shifts for head turns/nods.
    h.addChild(this.face);
    const eyeY = -132;
    for (const side of [-1, 1] as const) {
      const root = new Container();
      root.position.set(side * 52, eyeY);
      const white = new Graphics().roundRect(-25, -29, 50, 58, 16).fill(0xffffff);
      const pupil = new Container();
      pupil.addChild(new Graphics().roundRect(-13, -15, 26, 30, 9).fill(look.eye));
      pupil.addChild(new Graphics().rect(2, -11, 8, 8).fill(0xffffff));
      const lid = new Graphics().roundRect(-25, -29, 50, 58, 16).fill(look.skin);
      lid.pivot.set(0, -29);
      lid.position.set(0, -29);
      const lash = new Graphics().roundRect(-26, -3, 52, 7, 3).fill(look.eye);
      root.addChild(white, pupil, lid, lash);
      this.face.addChild(root);
      this.eyes.push({ root, pupil, lid, lash });

      const brow = new Graphics().roundRect(-28, -6, 56, 12, 6).fill(look.brow);
      brow.position.set(side * 52, eyeY + BROW_DY);
      this.face.addChild(brow);
      this.brows.push(brow);

      this.face.addChild(new Graphics().roundRect(side * 72 - 18, -86, 36, 18, 9).fill({ color: 0xff7f7f, alpha: 0.35 }));
    }
    this.face.addChild(new Graphics().roundRect(-10, -104, 20, 26, 8).fill(look.skinShade)); // nose
    this.mouth.position.set(0, -58);
    this.face.addChild(this.mouth);

    // Bob side locks sit in front of the face so shifted features never paint over the hair.
    if (look.style === 'bob') {
      h.addChild(
        new Graphics()
          .roundRect(-HEAD_W / 2 - 18, -HEAD_H + 20, 44, 170, 16).fill(look.hair)
          .roundRect(HEAD_W / 2 - 26, -HEAD_H + 20, 44, 170, 16).fill(look.hair),
      );
    }
  }

  private poseArm(arm: Arm, upper: number, fore: number) {
    // Outward raise: screen-left arm rotates clockwise (positive) to move outward.
    const outwardSign = arm.side === -1 ? 1 : -1;
    arm.root.rotation = upper * outwardSign;
    arm.elbow.rotation = fore * outwardSign;
  }

  private drawMouth(open: number, smile: number) {
    const g = this.mouth.clear();
    const w = 64 - open * 14;
    const hgt = 10 + open * 44;
    if (open < 0.04) {
      // Closed mouth: flat bar with corners lifted by smile.
      const lift = smile * 7;
      g.roundRect(-w / 2 + 6, -4, w - 12, 9, 4).fill(0x5a2320);
      g.roundRect(-w / 2, -4 - lift, 12, 9, 4).fill(0x5a2320);
      g.roundRect(w / 2 - 12, -4 - lift, 12, 9, 4).fill(0x5a2320);
      return;
    }
    g.roundRect(-w / 2, -hgt / 2, w, hgt, Math.min(16, hgt / 2)).fill(0x5a2320);
    if (open > 0.25) g.roundRect(-w / 2 + 8, -hgt / 2 + 3, w - 16, Math.min(10, hgt * 0.22), 4).fill(0xffffff);
    if (open > 0.35) g.roundRect(-w / 4, hgt / 2 - hgt * 0.38, w / 2, hgt * 0.3, 8).fill(0xe0646a);
  }

  apply(p: Pose) {
    this.body.y = p.bodyY;
    const outer = this.dir === 1 ? this.arms.left : this.arms.right;
    const inner = this.dir === 1 ? this.arms.right : this.arms.left;
    for (const arm of [outer, inner]) arm.root.y = this.shoulderY - p.shoulderLift;
    this.poseArm(outer, p.outerUpper, p.outerFore);
    this.poseArm(inner, p.innerUpper, p.innerFore);

    this.head.rotation = p.headRot;
    this.head.position.set(p.headX, -TORSO_H - 10 + p.headY - p.shoulderLift * 0.4);
    this.face.position.set(p.faceX, p.faceY);

    for (const eye of this.eyes) {
      eye.pupil.position.set(p.gazeX * 10, p.gazeY * 11);
      const closed = Math.max(0.05, p.lidClose);
      eye.lid.scale.y = closed;
      eye.lash.y = -29 + 58 * closed - 3;
      eye.lash.visible = closed > 0.12;
    }
    this.brows.forEach((brow, i) => {
      const side = i === 0 ? -1 : 1;
      const tiltUp = p.browTilt * (side === this.dir ? 1 : -0.3);
      brow.y = -132 + BROW_DY - p.browRaise * 9 - tiltUp * 6;
      brow.rotation = side * (-0.08 * p.browRaise) + side * 0.06 * tiltUp;
    });
    this.drawMouth(p.mouthOpen, p.smile);
  }
}

export const LOOK_A = LOOK_LUPITA;
export const LOOK_B = LOOK_JISOO;
export const LOOKS = { lupita: LOOK_LUPITA, jisoo: LOOK_JISOO } as const;
