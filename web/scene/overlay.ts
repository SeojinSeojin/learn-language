// Header, subtitles and section cards. Positioned inside the YouTube Shorts safe area:
// clear of the top bar (~0–200 px), the bottom title/description area (bottom ~480 px)
// and the right-hand action buttons (right ~170 px).
import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Timeline, TimelineCard, TimelineLine } from '../../shared/types';
import { CHARACTERS } from '../../shared/types';
import { overlayAt } from '../../shared/animation';

export const FONT = '"Noto Sans KR", sans-serif';
// Subtitle box: y 1150..≤1490, x 60..890 (Shorts title/description overlay starts lower; buttons are at x > 900).
export const SAFE = { left: 60, right: 1080 - 190, subtitleTop: 1150, subtitleMaxBottom: 1490 };
const SUB_W = SAFE.right - SAFE.left; // 830
const PAD = 28;


function style(size: number, weight: '500' | '700' | '900', fill: number, wrap = SUB_W - PAD * 2): TextStyle {
  return new TextStyle({
    fontFamily: FONT,
    fontSize: size,
    fontWeight: weight,
    fill,
    wordWrap: true,
    breakWords: true,
    wordWrapWidth: wrap,
    align: 'left',
    lineHeight: Math.round(size * 1.25),
  });
}

function setSize(t: Text, size: number) {
  t.style.fontSize = size;
  t.style.lineHeight = Math.round(size * 1.22);
}

/** Shrinks a Text until it fits in maxHeight (keeps long lines inside the safe area). */
function fitText(t: Text, baseSize: number, maxHeight: number, minSize: number) {
  let size = baseSize;
  t.style.fontSize = size;
  t.style.lineHeight = Math.round(size * 1.25);
  while (t.height > maxHeight && size > minSize) {
    size -= 2;
    t.style.fontSize = size;
    t.style.lineHeight = Math.round(size * 1.25);
  }
}

export class Overlay extends Container {
  private header = new Container();
  private chipBg = new Graphics();
  private chipText = new Text({ text: '', style: style(40, '900', 0xffffff, 900) });
  private topicText = new Text({ text: '', style: style(38, '700', 0x3d2a20, SUB_W) });
  private dots = new Graphics();

  private sub = new Container();
  private subBg = new Graphics();
  private speakerChip = new Graphics();
  private speakerText = new Text({ text: '', style: style(32, '900', 0xffffff, 400) });
  private mainText = new Text({ text: '', style: style(64, '700', 0xffffff) });
  private pronText = new Text({ text: '', style: style(42, '500', 0xffd98a) });
  private pronLabel = new Text({ text: 'approx. pronunciation', style: style(24, '500', 0xc9c2b8, 400) });

  private card = new Container();
  private cardBg = new Graphics();
  private cardTitle = new Text({ text: '', style: style(66, '900', 0x3d2a20, SUB_W - 80) });
  private cardSub = new Text({ text: '', style: style(44, '700', 0x8b5a3c, SUB_W - 80) });

  private currentLine: TimelineLine | undefined;
  private currentCard: TimelineCard | undefined;
  private currentSection = '';

  constructor(private timeline: Timeline) {
    super();
    this.header.addChild(this.chipBg, this.chipText, this.topicText, this.dots);
    this.header.position.set(SAFE.left, 230);
    this.addChild(this.header);

    this.sub.addChild(this.subBg, this.speakerChip, this.speakerText, this.mainText, this.pronText, this.pronLabel);
    this.addChild(this.sub);

    this.card.addChild(this.cardBg, this.cardTitle, this.cardSub);
    this.addChild(this.card);
  }

  /** Every string the overlay may draw, so fonts can be preloaded before rendering. */
  static allStrings(timeline: Timeline): string[] {
    const s = ['approx. pronunciation', timeline.topic];
    for (const c of Object.values(CHARACTERS)) s.push(c.es, c.ko);
    for (const l of timeline.lines) s.push(l.text, l.pronunciation ? `≈ ${l.pronunciation}` : '');
    for (const c of timeline.cards) s.push(c.title, c.subtitle);
    for (const sec of timeline.sections) s.push(sec.label);
    return s.filter(Boolean);
  }

  private layoutHeader(label: string, lang: string) {
    this.chipText.text = label;
    this.chipBg.clear().roundRect(0, 0, this.chipText.width + 44, 66, 18).fill(lang === 'ko' ? 0x2f6f9c : 0x2f8a4e);
    this.chipText.position.set(22, 8);
    this.topicText.text = this.timeline.topic;
    fitText(this.topicText, 38, 100, 26);
    this.topicText.position.set(4, 82);
  }

  private layoutLine(line: TimelineLine) {
    const isKo = line.lang === 'ko';
    // Speaker label (display only; never part of the audio).
    const who = CHARACTERS[line.speaker];
    this.speakerText.text = isKo ? who.ko : who.es;
    this.speakerChip.clear().roundRect(0, 0, this.speakerText.width + 32, 48, 13).fill(who.color);
    this.speakerChip.position.set(PAD, PAD);
    this.speakerText.position.set(PAD + 16, PAD + 24 - this.speakerText.height / 2);
    // "approx. pronunciation" sits on the label row to keep the box short.
    this.pronLabel.visible = isKo;
    this.pronLabel.position.set(PAD + this.speakerText.width + 32 + 18, PAD + 24 - this.pronLabel.height / 2);
    this.pronText.visible = isKo;
    this.mainText.text = line.text;
    if (isKo) this.pronText.text = `≈ ${line.pronunciation ?? ''}`;

    // Shrink text together until the whole box fits the safe-area height budget.
    const maxH = SAFE.subtitleMaxBottom - SAFE.subtitleTop;
    let h = 0;
    for (let scale = 1; scale >= 0.6; scale -= 0.04) {
      setSize(this.mainText, Math.round((isKo ? 66 : 60) * scale));
      let y = PAD + 48 + 12;
      this.mainText.position.set(PAD, y);
      y += this.mainText.height;
      if (isKo) {
        setSize(this.pronText, Math.round(38 * scale));
        this.pronText.position.set(PAD, y + 4);
        y += 4 + this.pronText.height;
      }
      h = y + PAD - 4;
      if (h <= maxH) break;
    }
    this.subBg.clear().roundRect(0, 0, SUB_W, h, 28).fill({ color: 0x1d1714, alpha: 0.86 });
    this.subBg.roundRect(0, 0, 12, h, 6).fill(who.color);
    this.sub.position.set(SAFE.left, SAFE.subtitleTop);
  }


  private layoutCard(card: TimelineCard) {
    this.cardTitle.text = card.title;
    fitText(this.cardTitle, 66, 180, 40);
    this.cardSub.text = card.subtitle;
    fitText(this.cardSub, 44, 120, 30);
    const h = 50 + this.cardTitle.height + 16 + this.cardSub.height + 50;
    this.cardBg.clear().roundRect(0, 0, SUB_W, h, 34).fill({ color: 0xfff8ee, alpha: 0.97 }).stroke({ color: 0x8b5a3c, width: 6 });
    this.cardTitle.position.set(40, 50);
    this.cardSub.position.set(40, 50 + this.cardTitle.height + 16);
    this.card.position.set(SAFE.left, SAFE.subtitleTop);
  }

  update(t: number) {
    const o = overlayAt(this.timeline, t);
    const section = o.section ?? this.timeline.sections[t < this.timeline.duration / 2 ? 0 : 1];
    const sectionKey = section.lang;
    if (sectionKey !== this.currentSection) {
      this.currentSection = sectionKey;
      this.layoutHeader(section.label, section.lang);
    }
    // Progress dots: which of the six lines in this section we are on.
    this.dots.clear();
    const lineNo = o.line && o.line.lang === section.lang ? o.line.lineNo : 0;
    for (let i = 1; i <= 6; i++) {
      const done = i <= lineNo;
      this.dots.roundRect(this.chipBg.width + 26 + (i - 1) * 34, 22, 22, 22, 6).fill(done ? 0x3d2a20 : { color: 0x3d2a20, alpha: 0.22 });
    }

    if (o.line !== this.currentLine) {
      this.currentLine = o.line;
      if (o.line) this.layoutLine(o.line);
    }
    this.sub.visible = !!o.line && o.lineAlpha > 0.001;
    this.sub.alpha = o.lineAlpha;

    if (o.card !== this.currentCard) {
      this.currentCard = o.card;
      if (o.card) this.layoutCard(o.card);
    }
    this.card.visible = !!o.card && o.cardAlpha > 0.001;
    this.card.alpha = o.cardAlpha;
  }
}
