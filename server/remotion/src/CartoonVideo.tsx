// The finished cartoon (spec section 7.7): a verse card over the first
// clip's opening frame, the clips in order with their own sound (hard cuts,
// a short dissolve where the scene changes), kinetic dialogue captions with
// the speaker's name the first time they speak, a music bed that ducks under
// speech, and Scene script's end card over the last frame, softly blurred.
import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio, Video } from "@remotion/media";
import { bedVolume, captionPages } from "../../src/lib/cartoon/filmCurves.js";
import type { CartoonCaption, CartoonRenderData, CartoonShot, CartoonWord } from "./cartoonTypes";
import { EndCard, GOLD, SHADOW } from "./Captions";
import { SANS, SERIF_ITALIC, useFonts } from "./fonts";

const DISSOLVE_FRAMES = 6;
// A held frame is a sliver of the clip played so slowly it does not visibly move.
const HOLD_SPAN_SEC = 0.04;
const HOLD_END_GUARD_SEC = 0.08;
// Each clip's sound eases in and out over two frames so a hard cut never clicks.
const EDGE_FADE_FRAMES = 2;
const OPENING_FADE_SEC = 0.6;
const VIDEO_STYLE: React.CSSProperties = { width: "100%", height: "100%" };
const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const VERSE_MAX_LINES = 4;
const CAPTION_LEAD_SEC = 0.1;
const CAPTION_LINGER_SEC = 0.6;
const CAPTION_FADE_SEC = 0.12;

function useScale() {
  const { width, height } = useVideoConfig();
  return { s: Math.min(width, height) / 1080, width, height };
}

function HeldFrame({ src, at, len }: { src: string; at: number; len: number }) {
  const { fps } = useVideoConfig();
  return (
    <Video src={src} muted objectFit="cover" style={VIDEO_STYLE}
      playbackRate={HOLD_SPAN_SEC / 2 / Math.max(len, 0.1)}
      trimBefore={Math.round(at * fps)} trimAfter={Math.round((at + HOLD_SPAN_SEC) * fps) + 1} />
  );
}

const lastFrameAt = (shot: CartoonShot) => Math.max(0, shot.trimTo - HOLD_END_GUARD_SEC);

/** Under the verse card: the first clip's opening frame, settling gently from a slight push-in. */
function OpeningHold({ shot }: { shot: CartoonShot }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = interpolate(frame / fps, [0, shot.from], [1.06, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ transform: `scale(${scale})` }}>
      <HeldFrame src={shot.src} at={0} len={shot.from} />
    </AbsoluteFill>
  );
}

/** One clip, from its first frame, at full volume with its own sound. */
function ShotClip({ shot }: { shot: CartoonShot }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lenFrames = Math.max(1, Math.round(shot.trimTo * fps));
  const opacity = shot.dissolve ? interpolate(frame, [0, DISSOLVE_FRAMES], [0, 1], CLAMP) : 1;
  const edge = Math.min(EDGE_FADE_FRAMES, Math.floor(lenFrames / 2));
  return (
    <AbsoluteFill style={{ opacity }}>
      <Video src={shot.src} objectFit="cover" style={VIDEO_STYLE} trimAfter={lenFrames}
        volume={(f: number) => (edge > 0 ? interpolate(f, [0, edge, lenFrames - edge, lenFrames], [0, 1, 1, 0], CLAMP) : 1)} />
    </AbsoluteFill>
  );
}

/** Under the end card: the last frame held, slowly blurring and darkening. */
function ClosingHold({ shot, len }: { shot: CartoonShot; len: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = interpolate(frame / fps, [0, Math.min(1.4, len)], [0, 1], { ...CLAMP, easing: Easing.inOut(Easing.quad) });
  return (
    <AbsoluteFill style={{ transform: `scale(${1 + 0.06 * k})`, filter: `blur(${8 * k}px) brightness(${1 - 0.4 * k})` }}>
      <HeldFrame src={shot.src} at={lastFrameAt(shot)} len={len} />
    </AbsoluteFill>
  );
}

function Grade() {
  return <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.36) 100%)" }} />;
}

let measureContext: CanvasRenderingContext2D | null | undefined;
function measurer() {
  if (measureContext === undefined) {
    try {
      measureContext = document.createElement("canvas").getContext("2d");
    } catch {
      measureContext = null;
    }
  }
  return measureContext;
}

/** How many lines the text wraps to at this font and width, or null when it cannot be measured. */
function lineCount(text: string, font: string, maxWidth: number): number | null {
  const ctx = measurer();
  if (!ctx) return null;
  ctx.font = font;
  let lines = 1;
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || ctx.measureText(next).width <= maxWidth) line = next;
    else {
      lines += 1;
      line = word;
    }
  }
  return lines;
}

/** The largest verse size that wraps to at most four lines (measured with the loaded serif). */
function fitVerseSize(text: string, maxWidth: number, s: number) {
  const max = 72 * s;
  const min = 44 * s;
  for (let size = max; size >= min; size -= 2 * s) {
    const lines = lineCount(text, `italic 600 ${size}px "${SERIF_ITALIC}"`, maxWidth);
    if (lines === null) return Math.max(min, Math.min(max, (maxWidth * VERSE_MAX_LINES) / (text.length * 0.46)));
    if (lines <= VERSE_MAX_LINES) return size;
  }
  return min;
}

function VerseCard({ verse }: { verse: CartoonRenderData["verse"] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { s, width, height } = useScale();
  const t = frame / fps;
  const main = verse.text ? `“${verse.text}”` : verse.reference;
  if (!main || t > verse.to) return null;
  const end = verse.to;
  const scrim = interpolate(t, [0, 0.35, end - 0.45, end], [0, 1, 1, 0], { ...CLAMP, easing: Easing.inOut(Easing.quad) });
  const enter = spring({ frame: frame - Math.round(0.15 * fps), fps, config: { damping: 200 }, durationInFrames: Math.round(0.7 * fps) });
  const leave = interpolate(t, [end - 0.4, end - 0.05], [1, 0], { ...CLAMP, easing: Easing.inOut(Easing.quad) });
  const rule = interpolate(t, [0.45, 1.05], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const refIn = interpolate(t, [0.6, 1.05], [0, 1], CLAMP);
  const padX = 88 * s;
  const size = verse.text ? fitVerseSize(main, width - 2 * padX, s) : 76 * s;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: scrim, background: "linear-gradient(180deg, rgba(10,7,4,0) 40%, rgba(10,7,4,0.5) 64%, rgba(10,7,4,0.8) 100%)" }} />
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.14, opacity: leave }}>
        <div style={{
          opacity: enter, transform: `translateY(${(1 - enter) * 18 * s}px)`,
          fontFamily: SERIF_ITALIC, fontStyle: "italic", fontWeight: 600, fontSize: size, lineHeight: 1.2,
          color: "#FFF8EC", textAlign: "center", padding: `0 ${padX}px`, textShadow: SHADOW, textWrap: "balance",
        }}>
          {main}
        </div>
        {verse.text && verse.reference ? (
          <>
            <div style={{ width: 96 * s * rule, height: 2 * s, background: GOLD, marginTop: 30 * s, opacity: 0.9 }} />
            <div style={{
              opacity: refIn, marginTop: 20 * s, fontFamily: SANS, fontWeight: 600, fontSize: 30 * s,
              letterSpacing: "0.22em", color: GOLD, textShadow: SHADOW, fontVariantNumeric: "lining-nums",
            }}>
              {verse.reference.toUpperCase()}
            </div>
          </>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function CaptionWords({ words, t }: { words: CartoonWord[]; t: number }) {
  const { fps } = useVideoConfig();
  const { s, width } = useScale();
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: "0.28em", rowGap: "0.05em",
      fontFamily: SANS, fontWeight: 800, fontSize: 62 * s, lineHeight: 1.15, color: "#fff", textAlign: "center",
      padding: `0 ${width * 0.074}px`, textShadow: SHADOW,
    }}>
      {words.map((w, i) => {
        const appear = spring({ frame: Math.round((t - w.start + 0.06) * fps), fps, config: { damping: 18, stiffness: 180 } });
        const active = t >= w.start && t < w.end + 0.08;
        return (
          <span key={i} style={{
            display: "inline-block", opacity: appear, color: active ? GOLD : "#fff",
            transform: `translateY(${(1 - appear) * 22}px) scale(${0.92 + appear * 0.08})`,
          }}>
            {w.text}
          </span>
        );
      })}
    </div>
  );
}

/** One spoken shot's caption: its words a phrase at a time, the speaker's name above the first time. */
function CaptionView({ caption, t }: { caption: CartoonCaption; t: number }) {
  const { s, height } = useScale();
  const pages = captionPages(caption.words);
  let index = -1;
  pages.forEach((p, i) => { if (t >= p[0].start - CAPTION_LEAD_SEC) index = i; });
  if (index < 0) return null;
  const page = pages[index];
  const next = pages[index + 1];
  const showFrom = page[0].start - CAPTION_LEAD_SEC;
  const nextFrom = next ? next[0].start - CAPTION_LEAD_SEC : Infinity;
  const lingerTo = Math.min(page[page.length - 1].end + CAPTION_LINGER_SEC, caption.to);
  const showTo = Math.min(nextFrom, lingerTo);
  if (t > showTo) return null;
  // A phrase that hands straight over to the next one swaps without fading out.
  const fadeOut = nextFrom <= lingerTo ? 1 : interpolate(t, [showTo - CAPTION_FADE_SEC, showTo], [1, 0], CLAMP);
  const opacity = Math.min(interpolate(t, [showFrom, showFrom + CAPTION_FADE_SEC], [0, 1], CLAMP), fadeOut);
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.2, opacity }}>
      {caption.showName && caption.speaker ? (
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 34 * s, letterSpacing: "0.02em", color: GOLD, marginBottom: 12 * s, textShadow: SHADOW }}>
          {caption.speaker}
        </div>
      ) : null}
      <CaptionWords words={page} t={t} />
    </AbsoluteFill>
  );
}

function CartoonCaptions({ data }: { data: CartoonRenderData }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (!data.captionsOn || t < data.verse.to || t >= data.endCard.from - 0.05) return null;
  const caption = data.captions.find((c) => t >= c.from && t < c.to);
  return caption ? <CaptionView caption={caption} t={t} /> : null;
}

function FadeFromBlack() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = interpolate(frame / fps, [0, OPENING_FADE_SEC], [1, 0], { ...CLAMP, easing: Easing.out(Easing.quad) });
  return o > 0 ? <AbsoluteFill style={{ background: "#000", opacity: o }} /> : null;
}

export const CartoonVideo: React.FC<CartoonRenderData> = (data) => {
  useFonts(data.fonts);
  const { fps } = useVideoConfig();
  const f = (sec: number) => Math.max(0, Math.round(sec * fps));
  const first = data.shots[0];
  const last = data.shots[data.shots.length - 1];
  const bed = data.bed;
  const span = { inTo: data.verse.to, outFrom: data.endCard.from, total: data.total };

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {first && f(first.from) > 0 ? (
        <Sequence from={0} durationInFrames={f(first.from)} name="opening frame">
          <OpeningHold shot={first} />
        </Sequence>
      ) : null}
      {data.shots.map((shot, i) => {
        const next = data.shots[i + 1];
        return (
          <React.Fragment key={shot.id}>
            <Sequence from={f(shot.from)} durationInFrames={Math.max(1, f(shot.to) - f(shot.from))} name={`shot ${shot.id}`}>
              <ShotClip shot={shot} />
            </Sequence>
            {next?.dissolve ? (
              <Sequence from={f(shot.to)} durationInFrames={DISSOLVE_FRAMES + 1} name={`shot ${shot.id} dissolving`}>
                <HeldFrame src={shot.src} at={lastFrameAt(shot)} len={(DISSOLVE_FRAMES + 1) / fps} />
              </Sequence>
            ) : null}
          </React.Fragment>
        );
      })}
      {last && f(data.total) > f(last.to) ? (
        <Sequence from={f(last.to)} durationInFrames={f(data.total) - f(last.to)} name="closing frame">
          <ClosingHold shot={last} len={data.total - last.to} />
        </Sequence>
      ) : null}
      <Grade />
      <VerseCard verse={data.verse} />
      <CartoonCaptions data={data} />
      <EndCard data={{ endCard: { reference: data.endCard.reference, text: data.endCard.text, at: data.endCard.from }, brand: data.endCard.brand }} />
      <FadeFromBlack />

      {bed ? (
        <Sequence from={0} durationInFrames={Math.max(1, f(data.total))} name="music bed">
          <Audio src={bed.src} volume={(fr: number) => bedVolume(bed, fr / fps, span)} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
