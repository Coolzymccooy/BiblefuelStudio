/**
 * Browser-side approximation of the caption LOOK for the live stage.
 *
 * The real captions are baked by ffmpeg at render time (server
 * videoFilters.js presets); nothing previewed them in the browser, so picking
 * "Marker" changed nothing on the canvas until the render came back. This
 * mirrors each preset's defining traits - block, outline, case, scale,
 * placement - and the caption MOTION against the playhead: per-word reveal,
 * karaoke highlight. Approximate by design; the render is the source of truth.
 */
import type { CSSProperties } from 'react';

export interface CaptionStyle {
  /** Animation / typography preset id (videoFilters catalogue). */
  preset?: string;
  /** 'words' reveals word by word; anything else shows the whole line. */
  motion?: string;
  /** Karaoke-style highlight of the spoken word. */
  highlight?: boolean;
  /** Layout id from LAYOUT_OPTIONS ('center', 'top', 'bottom', ...). */
  layout?: string;
}

export interface CaptionPreviewProps {
  text: string;
  style?: CaptionStyle;
  /** 0..1 position within this line's time slot; drives reveal/highlight. */
  progress: number;
}

type Look = {
  wrap: CSSProperties;
  word: CSSProperties;
  activeWord?: CSSProperties;
  uppercase?: boolean;
  place?: 'top' | 'center' | 'bottom' | 'lower-left';
  scale: number;
  fade?: boolean;
};

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Inter, 'Segoe UI', Arial, sans-serif";
const SCRIPT = "'Segoe Script', 'Brush Script MT', 'Comic Sans MS', cursive";
const OUTLINE = '0 0 2px #000, 0 0 4px #000, 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000';

const LOOKS: Record<string, Look> = {
  'cinematic-worship': { wrap: { fontFamily: SERIF, color: '#fff', textShadow: '0 2px 12px rgba(0,0,0,.7)' }, word: {}, scale: 1.25, fade: true },
  'cinematic-reactive': { wrap: { fontFamily: SERIF, color: '#fff', textShadow: '0 0 18px rgba(230,201,138,.9), 0 2px 12px rgba(0,0,0,.7)' }, word: {}, scale: 1.25, fade: true },
  'scripture-reveal': { wrap: { fontFamily: SERIF, color: '#f3ead6', fontStyle: 'italic', textShadow: '0 2px 10px rgba(0,0,0,.7)' }, word: {}, scale: 1.05, fade: true },
  marker: { wrap: { fontFamily: SCRIPT, color: '#141210' }, word: { background: '#f5d90a', padding: '0 .35em', borderRadius: '.15em', boxDecorationBreak: 'clone' }, scale: 1.15 },
  'soft-glow': { wrap: { fontFamily: SANS, color: '#f7e7b3', fontWeight: 700, textShadow: OUTLINE }, word: {}, scale: 1.15 },
  headline: { wrap: { fontFamily: SANS, color: '#f3ead6', fontWeight: 800, letterSpacing: '.01em', textShadow: '0 2px 10px rgba(0,0,0,.6)' }, word: {}, scale: 1.7, place: 'top' },
  'word-boxes': { wrap: { fontFamily: SANS, color: '#fff', fontWeight: 800 }, word: { background: 'rgba(0,0,0,.75)', padding: '.1em .35em', borderRadius: '.12em' }, uppercase: true, scale: 1.2 },
  'hero-bold': { wrap: { fontFamily: SANS, color: '#fff', fontWeight: 900, textShadow: '0 3px 14px rgba(0,0,0,.7)' }, word: {}, uppercase: true, scale: 1.9, fade: true },
  'music-video': { wrap: { fontFamily: SANS, color: '#fff', fontWeight: 900, textShadow: '0 2px 8px rgba(0,0,0,.7)' }, word: {}, uppercase: true, scale: 1.4 },
  'karaoke-pop': { wrap: { fontFamily: SANS, color: '#fff', fontWeight: 900, textShadow: OUTLINE }, word: {}, activeWord: { color: '#ff2fb3' }, uppercase: true, scale: 1.35 },
  'minimal-lower-third': { wrap: { fontFamily: SANS, color: '#fff', fontWeight: 600, borderLeft: '3px solid #e6c98a', paddingLeft: '.5em', textShadow: '0 1px 6px rgba(0,0,0,.7)' }, word: {}, scale: 0.75, place: 'lower-left' },
};
// Browser-only picks degrade to their closest renderable look, as the server does.
const ALIAS: Record<string, string> = { 'tiled-repeat': 'hero-bold', 'glass-chrome': 'cinematic-worship', 'webgl-bloom': 'cinematic-reactive', 'video-text': 'hero-bold', 'cinematic-default': 'cinematic-worship', default: 'cinematic-worship' };

function placeFor(look: Look, layout?: string): NonNullable<Look['place']> {
  if (look.place) return look.place;
  const l = String(layout || 'center').toLowerCase();
  if (l.includes('top')) return 'top';
  if (l.includes('bottom') || l.includes('lower')) return 'bottom';
  return 'center';
}

const PLACE_CLASS: Record<NonNullable<Look['place']>, string> = {
  top: 'top-[8%] inset-x-0 text-center',
  center: 'top-1/2 -translate-y-1/2 inset-x-0 text-center',
  bottom: 'bottom-[8%] inset-x-0 text-center',
  'lower-left': 'bottom-[8%] left-[6%] text-left',
};

export function CaptionPreview({ text, style, progress }: CaptionPreviewProps) {
  const id = ALIAS[style?.preset || ''] || style?.preset || 'cinematic-worship';
  const look = LOOKS[id] || LOOKS['cinematic-worship'];
  const words = text.split(/\s+/).filter(Boolean);
  const p = Math.max(0, Math.min(1, progress));
  // Per-word reveal follows the playhead while scrubbing; at rest (playhead at
  // the line start) the whole line shows, so the look can be judged.
  const perWord = style?.motion === 'words' && p > 0;
  const visible = perWord ? Math.max(1, Math.ceil(p * words.length)) : words.length;
  const active = style?.highlight || id === 'karaoke-pop' ? Math.min(words.length - 1, Math.floor(p * words.length)) : -1;
  const place = placeFor(look, style?.layout);
  const opacity = look.fade ? Math.min(1, 0.35 + p * 2.5) : 1;

  return (
    <div
      className={`pointer-events-none absolute px-[6%] ${PLACE_CLASS[place]}`}
      data-testid="caption-preview"
      data-preset={id}
      style={{ fontSize: `calc(${look.scale} * (0.9vw + 7px))`, lineHeight: 1.25, opacity, ...look.wrap }}
    >
      {words.map((w, i) => (
        // A real space between words: innerText / copy / screen readers read a sentence, not one glued word.
        <span
          key={`${w}-${i}`}
          className="inline-block transition-opacity duration-150"
          style={{
            marginRight: '.28em',
            opacity: i < visible ? 1 : 0,
            ...look.word,
            ...(i === active ? look.activeWord : undefined),
          }}
        >
          {look.uppercase ? w.toUpperCase() : w}
        </span>
      )).flatMap((el, i) => (i === 0 ? [el] : [" ", el]))}
    </div>
  );
}
