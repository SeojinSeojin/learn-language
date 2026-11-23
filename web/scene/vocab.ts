// Vocabulary-mode PixiJS scene (preview and frame renderer). One view per word:
//   picture card, then rows for Mexican Spanish, Korean (+ pronunciation) and English.
// The row being spoken is highlighted, and two dots per language show the ×2 repetition.
// Layout stays inside the YouTube Shorts safe area (same SAFE box as the dialogue overlay).
import { Application, Assets, Container, Graphics, Sprite, Text, TextStyle, type Texture } from 'pixi.js';
import type { Lang, TimelineCard, VocabTimeline, VocabTimelineWord } from '../../shared/types';
import { vocabStateAt } from '../../shared/vocab';
import { FONT, SAFE } from './overlay';

const W = SAFE.right - SAFE.left; // 830
const CX = SAFE.left + W / 2;
const INK = 0x3d2a20;
const PANEL_DARK = 0x1d1714;
const LANG_COLOR: Record<Lang | 'en', number> = { es: 0x2f8a4e, ko: 0x2f6f9c, en: 0x8a7a6c };
const LANG_TAG: Record<Lang | 'en', string> = { es: 'ES', ko: 'KO', en: 'EN' };
const ACCENTS = [0xf2a65a, 0x7fc8a9, 0x6ab0de, 0xf08a8a, 0xc39bd3, 0xf6c445];

// Vertical layout (px): header 230–350, card 384–1042, rows 1066–1424 (inside SAFE, bottom ≤ 1440).
const PHOTO = 580;
const CARD_PAD = 20;
const CARD_W = PHOTO + CARD_PAD * 2;
const CARD_H = PHOTO + CARD_PAD + 58;
const CARD_Y = 384;
const ROWS_Y = CARD_Y + CARD_H + 26;
const ROW_H = { es: 104, ko: 150, en: 78 } as const;
const ROW_GAP = 14;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOutBack = (x: number) => {
  const c = 1.6;
  const u = clamp01(x) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;

function style(size: number, weight: '500' | '700' | '900', fill: number, wrap = 0, align: 'left' | 'center' = 'left'): TextStyle {
  return new TextStyle({ fontFamily: FONT, fontSize: size, fontWeight: weight, fill, wordWrap: wrap > 0, wordWrapWidth: wrap || 100, align, lineHeight: Math.round(size * 1.25) });
}

/** Shrinks a single-line Text until it is at most maxWidth wide. */
function fitWidth(t: Text, base: number, maxWidth: number, min: number) {
  let size = base;
  t.style.fontSize = size;
  while (t.width > maxWidth && size > min) {
    size -= 2;
    t.style.fontSize = size;
  }
}

function fitHeight(t: Text, base: number, maxHeight: number, min: number) {
  let size = base;
  const set = () => {
    t.style.fontSize = size;
    t.style.lineHeight = Math.round(size * 1.22);
  };
  set();
  while (t.height > maxHeight && size > min) {
    size -= 2;
    set();
  }
}

class Row extends Container {
  readonly bg = new Graphics();
  readonly chip = new Graphics();
  readonly tag: Text;
  readonly word = new Text({ text: '', style: style(72, '900', 0xffffff) });
  readonly pron = new Text({ text: '', style: style(36, '500', 0xffd98a) });
  readonly dots = new Graphics();

  constructor(readonly lang: Lang | 'en', readonly h: number) {
    super();
    this.tag = new Text({ text: LANG_TAG[lang], style: style(30, '900', 0xffffff) });
    this.addChild(this.bg, this.chip, this.tag, this.word, this.pron, this.dots);
    this.pivot.set(W / 2, h / 2);
  }

  layout(text: string, pron?: string) {
    const spoken = this.lang !== 'en';
    this.chip.clear().roundRect(24, this.h / 2 - 30, 84, 60, 16).fill(LANG_COLOR[this.lang]);
    this.tag.position.set(66 - this.tag.width / 2, this.h / 2 - this.tag.height / 2);
    const maxW = W - 136 - (spoken ? 110 : 30);
    this.word.text = text;
    fitWidth(this.word, this.lang === 'en' ? 50 : 76, maxW, 30);
    this.pron.visible = !!pron;
    if (pron) {
      this.pron.text = `≈ ${pron}`;
      fitWidth(this.pron, 36, maxW, 22);
      const total = this.word.height + this.pron.height - 4;
      this.word.position.set(132, (this.h - total) / 2);
      this.pron.position.set(134, this.word.y + this.word.height - 4);
    } else {
      this.word.position.set(132, (this.h - this.word.height) / 2);
    }
  }

  /** active: 0..1 highlight; heard: repetitions started; pulse: 0..1 within the active clip. */
  draw(active: number, heard: number, pulse: number | undefined) {
    const dark = this.lang !== 'en' && active > 0.001;
    this.bg.clear().roundRect(0, 0, W, this.h, 26).fill(dark ? { color: PANEL_DARK, alpha: 0.9 } : { color: 0xffffff, alpha: 0.92 });
    if (dark) this.bg.roundRect(0, 0, 12, this.h, 6).fill(LANG_COLOR[this.lang as Lang]);
    else this.bg.roundRect(0, 0, W, this.h, 26).stroke({ color: INK, alpha: 0.12, width: 3 });
    this.word.style.fill = dark ? 0xffffff : this.lang === 'en' ? 0x6b5a4e : INK;
    this.pron.style.fill = dark ? 0xffd98a : 0xa0703e;
    this.scale.set(1 + 0.035 * active);

    this.dots.clear();
    if (this.lang === 'en') return;
    for (let k = 0; k < 2; k++) {
      const x = W - 80 + k * 40;
      const y = this.h / 2;
      const on = k < heard;
      const color = dark ? 0xffffff : INK;
      this.dots.circle(x, y, 11).fill(on ? { color: LANG_COLOR[this.lang as Lang] } : { color, alpha: 0.18 });
      if (on && pulse !== undefined && k === heard - 1) {
        this.dots.circle(x, y, 11 + 9 * pulse).stroke({ color: LANG_COLOR[this.lang as Lang], alpha: 1 - pulse, width: 4 });
      }
    }
  }
}

export class VocabScene {
  readonly app = new Application();
  private textures: (Texture | undefined)[] = [];

  private header = new Container();
  private chipBg = new Graphics();
  private chipText = new Text({ text: 'VOCABULARIO · 단어', style: style(40, '900', 0xffffff) });
  private counter = new Text({ text: '', style: style(38, '900', INK) });
  private topicText = new Text({ text: '', style: style(38, '700', INK, W) });
  private progress = new Graphics();

  private view = new Container();
  private photoCard = new Container();
  private cardShadow = new Graphics();
  private cardBg = new Graphics();
  private photo = new Sprite();
  private placeholder = new Graphics();
  private placeholderText = new Text({ text: '', style: style(84, '900', 0xffffff, PHOTO - 80, 'center') });
  private credit = new Text({ text: '', style: style(22, '500', 0x8a7a6c) });
  private rows = { es: new Row('es', ROW_H.es), ko: new Row('ko', ROW_H.ko), en: new Row('en', ROW_H.en) };

  private card = new Container();
  private cardPanel = new Graphics();
  private cardTitle = new Text({ text: '', style: style(76, '900', INK, W - 100, 'center') });
  private cardSub = new Text({ text: '', style: style(42, '700', 0x8b5a3c, W - 100, 'center') });
  private cardLangs = new Text({ text: 'Español  ·  한국어  ·  English', style: style(34, '700', 0x6b5a4e, W - 100, 'center') });

  private currentWord: VocabTimelineWord | undefined;
  private currentCard: TimelineCard | undefined;

  constructor(readonly timeline: VocabTimeline) {}

  /** Every string the scene may draw, so fonts can be preloaded before rendering. */
  static allStrings(tl: VocabTimeline): string[] {
    const s = ['VOCABULARIO · 단어', 'ES KO EN', tl.topic, 'Español 한국어 English', `0123456789 / ${tl.words.length}`];
    for (const w of tl.words) s.push(w.esMX, w.ko, `≈ ${w.koPronunciation}`, w.en, w.credit ?? '');
    for (const c of tl.cards) s.push(c.title, c.subtitle);
    return s.filter(Boolean);
  }

  async init(opts: { renderer?: 'webgl' | 'canvas'; baseUrl: string }) {
    const { width, height } = this.timeline;
    await this.app.init({
      width,
      height,
      resolution: 1,
      antialias: true,
      background: 0xfdf3e3,
      preference: opts.renderer ? [opts.renderer] : ['webgl', 'canvas'],
      preserveDrawingBuffer: true,
      autoStart: false,
      sharedTicker: false,
    });
    this.app.ticker.stop();
    this.textures = await Promise.all(
      this.timeline.words.map((w) => (w.image ? Assets.load<Texture>(new URL(w.image, opts.baseUrl).href) : Promise.resolve(undefined))),
    );

    const stage = this.app.stage;
    stage.addChild(this.buildBackground(width, height));

    this.header.addChild(this.chipBg, this.chipText, this.counter, this.topicText, this.progress);
    this.header.position.set(SAFE.left, 230);
    this.chipBg.roundRect(0, 0, this.chipText.width + 44, 66, 18).fill(0xd9572b);
    this.chipText.position.set(22, 8);
    this.topicText.text = this.timeline.topic;
    fitHeight(this.topicText, 38, 50, 24);
    this.topicText.position.set(4, 80);
    stage.addChild(this.header);

    this.photoCard.addChild(this.cardShadow, this.cardBg, this.placeholder, this.placeholderText, this.photo, this.credit);
    this.cardShadow.roundRect(8, 14, CARD_W, CARD_H, 30).fill({ color: INK, alpha: 0.16 });
    this.cardBg.roundRect(0, 0, CARD_W, CARD_H, 30).fill(0xffffff);
    this.photo.position.set(CARD_PAD, CARD_PAD);
    this.photoCard.pivot.set(CARD_W / 2, CARD_H / 2);
    this.photoCard.position.set(CX, CARD_Y + CARD_H / 2);
    this.view.addChild(this.photoCard);

    let y = ROWS_Y;
    for (const lang of ['es', 'ko', 'en'] as const) {
      const r = this.rows[lang];
      r.position.set(CX, y + r.h / 2);
      y += r.h + ROW_GAP;
      this.view.addChild(r);
    }
    stage.addChild(this.view);

    this.card.addChild(this.cardPanel, this.cardTitle, this.cardSub, this.cardLangs);
    stage.addChild(this.card);
    this.update(0);
  }

  get rendererName(): string {
    return this.app.renderer.name;
  }

  private buildBackground(width: number, height: number) {
    const g = new Graphics();
    g.rect(0, 0, width, height).fill(0xfdf3e3);
    // Soft, static confetti circles (deterministic from the timeline seed).
    let s = this.timeline.seed || 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 14; i++) {
      g.circle(rnd() * width, rnd() * height, 40 + rnd() * 120).fill({ color: ACCENTS[i % ACCENTS.length], alpha: 0.13 });
    }
    return g;
  }

  private layoutWord(w: VocabTimelineWord) {
    const accent = ACCENTS[w.index % ACCENTS.length];
    const tex = this.textures[w.index];
    this.photo.visible = !!tex;
    this.placeholder.visible = this.placeholderText.visible = !tex;
    if (tex) {
      this.photo.texture = tex;
      this.photo.width = PHOTO;
      this.photo.height = PHOTO;
    } else {
      this.placeholder.clear().roundRect(CARD_PAD, CARD_PAD, PHOTO, PHOTO, 18).fill(accent);
      this.placeholderText.text = w.en;
      fitWidth(this.placeholderText, 96, PHOTO - 80, 40);
      this.placeholderText.position.set(CARD_PAD + (PHOTO - this.placeholderText.width) / 2, CARD_PAD + (PHOTO - this.placeholderText.height) / 2);
    }
    this.cardBg.clear().roundRect(0, 0, CARD_W, CARD_H, 30).fill(0xffffff).stroke({ color: accent, width: 6 });
    this.credit.visible = !!w.credit;
    this.credit.text = w.credit ?? '';
    fitWidth(this.credit, 22, PHOTO, 14);
    this.credit.position.set(CARD_PAD, CARD_PAD + PHOTO + (CARD_H - CARD_PAD - PHOTO - this.credit.height) / 2);

    this.rows.es.layout(w.esMX);
    this.rows.ko.layout(w.ko, w.koPronunciation);
    this.rows.en.layout(w.en);
    this.counter.text = `${w.index + 1} / ${this.timeline.words.length}`;
  }

  private layoutCard(c: TimelineCard) {
    this.cardTitle.text = c.title;
    fitHeight(this.cardTitle, 76, 200, 40);
    this.cardSub.text = c.subtitle;
    fitHeight(this.cardSub, 42, 110, 28);
    this.cardLangs.visible = c.kind === 'intro';
    fitWidth(this.cardLangs, 34, W - 100, 24);
    let y = 56;
    this.cardTitle.position.set((W - this.cardTitle.width) / 2, y);
    y += this.cardTitle.height + 18;
    this.cardSub.position.set((W - this.cardSub.width) / 2, y);
    y += this.cardSub.height;
    if (this.cardLangs.visible) {
      y += 22;
      this.cardLangs.position.set((W - this.cardLangs.width) / 2, y);
      y += this.cardLangs.height;
    }
    const h = y + 56;
    this.cardPanel.clear().roundRect(0, 0, W, h, 36).fill({ color: 0xfff8ee, alpha: 0.98 }).stroke({ color: 0xd9572b, width: 6 });
    this.card.pivot.set(W / 2, h / 2);
    this.card.position.set(CX, 840);
  }

  /** Pose everything for time t (seconds) and draw one frame. */
  update(t: number) {
    const st = vocabStateAt(this.timeline, t);
    const tl = this.timeline;

    // Header counter and progress bar.
    const doneWords = tl.words.filter((w) => t >= w.start).length;
    const shown = st.word ? st.word.index + 1 : doneWords;
    this.counter.visible = shown > 0;
    if (!st.word) this.counter.text = `${shown} / ${tl.words.length}`;
    this.counter.position.set(this.chipBg.width + 24, 33 - this.counter.height / 2);
    const barX = this.chipBg.width + 24 + 175;
    const barW = Math.max(60, W - barX);
    const frac = st.word ? (st.word.index + clamp01((t - st.word.start) / (st.word.end - st.word.start))) / tl.words.length : doneWords / tl.words.length;
    this.progress.clear().roundRect(barX, 25, barW, 16, 8).fill({ color: INK, alpha: 0.15 });
    if (frac > 0) this.progress.roundRect(barX, 25, Math.max(16, barW * frac), 16, 8).fill(0xd9572b);

    // Word view.
    if (st.word !== this.currentWord) {
      this.currentWord = st.word;
      if (st.word) this.layoutWord(st.word);
    }
    this.view.visible = !!st.word && st.wordAlpha > 0.001;
    this.view.alpha = st.wordAlpha;
    if (st.word) {
      this.photoCard.scale.set(0.86 + 0.14 * easeOutBack(st.enter));
      this.photoCard.rotation = (st.word.index % 2 ? 1 : -1) * 0.02 * (1 - easeOut(st.enter));
      (['es', 'ko', 'en'] as const).forEach((lang, i) => {
        const r = this.rows[lang];
        const k = easeOut((st.enter - 0.15 * i) / 0.7);
        r.alpha = k;
        r.x = CX + 60 * (1 - k);
        const speaking = st.clip && st.clip.lang === lang;
        const active = lang !== 'en' && st.focus === lang ? (speaking ? 1 : 0.6) : 0;
        r.draw(active, lang === 'en' ? 0 : st.heard[lang], speaking ? st.clipProgress : undefined);
      });
    }

    // Intro / outro card.
    if (st.card !== this.currentCard) {
      this.currentCard = st.card;
      if (st.card) this.layoutCard(st.card);
    }
    this.card.visible = !!st.card && st.cardAlpha > 0.001;
    this.card.alpha = st.cardAlpha;
    this.card.scale.set(0.94 + 0.06 * st.cardAlpha);

    this.app.renderer.render(this.app.stage);
  }
}
