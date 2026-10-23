// Kinetic captions from the line model: narration lands word by word in the
// lower third, emphasis lines pop in large gold capitals, scripture is serif
// italic with who said it, references get a card, chants sit centre.
import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Line, RenderData } from "./types";
import { SANS, SERIF, SERIF_ITALIC } from "./fonts";

export const GOLD = "#F2C46D";
const SHADOW = "0 4px 24px rgba(0,0,0,0.85), 0 2px 6px rgba(0,0,0,0.9)";

function useScale() {
  const { width, height } = useVideoConfig();
  return { s: Math.min(width, height) / 1080, width, height };
}

function Words({ line, t, style, activeColor, upper = false }: {
  line: Line; t: number; style: React.CSSProperties; activeColor: string; upper?: boolean;
}) {
  const { fps } = useVideoConfig();
  const local = t - line.start;
  const words = line.words.length ? line.words : [{ text: line.text, start: 0, end: line.dur }];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: "0.28em", rowGap: "0.05em", ...style }}>
      {words.map((w, i) => {
        const appear = spring({ frame: Math.round((local - w.start + 0.06) * fps), fps, config: { damping: 18, stiffness: 180 } });
        const active = local >= w.start && local < w.end + 0.08;
        return (
          <span key={i} style={{
            opacity: appear,
            transform: `translateY(${(1 - appear) * 22}px) scale(${0.92 + appear * 0.08})`,
            color: active ? activeColor : (style.color as string),
            display: "inline-block",
          }}>
            {upper ? w.text.toUpperCase() : w.text}
          </span>
        );
      })}
    </div>
  );
}

function lineWindow(line: Line, t: number) {
  const hold = Math.min(Math.max(line.gap - 0.1, 0.25), 0.9);
  const from = line.start - 0.05;
  const to = line.start + line.dur + hold;
  if (t < from || t > to + 0.3) return 0;
  return interpolate(t, [from, from + 0.12, to, to + 0.3], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

function ReferenceCard({ t, line }: { t: number; line: Line }) {
  const { s, height } = useScale();
  const o = lineWindow({ ...line, gap: 3.4 }, t);
  if (o <= 0) return null;
  const grow = interpolate(t - line.start, [0, 0.8], [0, 1], { extrapolateRight: "clamp" });
  const text = (line.reference || line.text).toUpperCase();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: o, top: height * 0.27 }}>
      <div style={{ width: 360 * s * grow, height: 2 * s, background: GOLD, marginBottom: 26 * s }} />
      <div style={{ fontFamily: SERIF, fontVariantNumeric: "lining-nums", fontWeight: 600, fontSize: 64 * s, letterSpacing: "0.14em", color: "#fff", textShadow: SHADOW, textAlign: "center" }}>
        {text}
      </div>
      <div style={{ width: 360 * s * grow, height: 2 * s, background: GOLD, marginTop: 26 * s }} />
    </AbsoluteFill>
  );
}

function CaptionLine({ line, t }: { line: Line; t: number }) {
  const { fps } = useVideoConfig();
  const { s, width, height } = useScale();
  const pad = `0 ${width * 0.074}px`;
  if (line.kind === "reference") return <ReferenceCard t={t} line={line} />;
  const o = lineWindow(line, t);
  if (o <= 0) return null;
  if (line.kind === "scripture") {
    return (
      <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: height * 0.156, opacity: o }}>
        {line.label ? (
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 30 * s, letterSpacing: "0.3em", color: GOLD, marginBottom: 28 * s, textShadow: SHADOW }}>
            {line.label}
          </div>
        ) : null}
        <Words line={line} t={t} activeColor={GOLD}
          style={{ fontFamily: SERIF_ITALIC, fontStyle: "italic", fontWeight: 600, fontSize: 76 * s, lineHeight: 1.12, color: "#fff", textAlign: "center", padding: pad, textShadow: SHADOW }} />
      </AbsoluteFill>
    );
  }
  if (line.kind === "chant") {
    return (
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o * 0.95 }}>
        <div style={{ fontFamily: SERIF_ITALIC, fontStyle: "italic", fontWeight: 500, fontSize: 70 * s, color: "#fff", textShadow: SHADOW, textAlign: "center", padding: pad }}>
          {line.text}
        </div>
      </AbsoluteFill>
    );
  }
  if (line.emphasis) {
    const pop = spring({ frame: Math.round((t - line.start) * fps), fps, config: { damping: 12, stiffness: 160 } });
    return (
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o, transform: `scale(${0.9 + pop * 0.1})` }}>
        <Words line={line} t={t} activeColor="#ffffff" upper
          style={{ fontFamily: SANS, fontWeight: 800, fontSize: 104 * s, lineHeight: 1.05, color: GOLD, textAlign: "center", padding: pad, textShadow: SHADOW }} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.245, opacity: o }}>
      <Words line={line} t={t} activeColor={GOLD}
        style={{ fontFamily: SANS, fontWeight: 800, fontSize: 66 * s, lineHeight: 1.15, color: "#fff", textAlign: "center", padding: pad, textShadow: SHADOW }} />
    </AbsoluteFill>
  );
}

export const Captions: React.FC<{ data: RenderData }> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  if (!data.captions) return null;
  if (data.endCard && t >= data.endCard.at - 0.2) return null;
  return (
    <AbsoluteFill>
      {data.lines.map((line) => <CaptionLine key={line.id} line={line} t={t} />)}
    </AbsoluteFill>
  );
};

export const EndCard: React.FC<{ data: RenderData }> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { s, height } = useScale();
  if (!data.endCard) return null;
  const t = frame / fps - data.endCard.at;
  if (t < -0.2) return null;
  const a = interpolate(t, [0, 1.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const b = interpolate(t, [0.8, 2.0], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const c = interpolate(t, [1.6, 2.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,${0.62 * a}) 60%, rgba(0,0,0,${0.75 * a}) 100%)` }}>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.2 }}>
        {data.endCard.reference ? (
          <div style={{ opacity: b, fontFamily: SANS, fontWeight: 600, fontSize: 34 * s, letterSpacing: "0.32em", color: GOLD, textShadow: SHADOW }}>
            {data.endCard.reference.toUpperCase()}
          </div>
        ) : null}
        <div style={{ opacity: a, transform: `translateY(${(1 - a) * 20}px)`, fontFamily: SERIF, fontVariantNumeric: "lining-nums", fontWeight: 600, fontSize: 80 * s, lineHeight: 1.08, color: "#fff", textAlign: "center", marginTop: 28 * s, padding: `0 ${80 * s}px`, textShadow: SHADOW, letterSpacing: "0.04em", textWrap: "balance" }}>
          {data.endCard.text}
        </div>
        <div style={{ opacity: c * 0.85, fontFamily: SANS, fontWeight: 600, fontSize: 28 * s, letterSpacing: "0.24em", color: "#fff", marginTop: 120 * s }}>
          {data.brand.toUpperCase()}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const OpeningTitle: React.FC<{ data: RenderData }> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { s, height } = useScale();
  const t = frame / fps;
  const o = interpolate(t, [0.1, 0.6, 1.3, 1.8], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (o <= 0 || !data.title) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: height * 0.135, opacity: o }}>
      <div style={{ fontFamily: SERIF, fontVariantNumeric: "lining-nums", fontWeight: 600, fontSize: 70 * s, letterSpacing: "0.22em", color: "#fff", textShadow: SHADOW, textAlign: "center" }}>
        {data.title.toUpperCase()}
      </div>
      {data.reference ? (
        <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: 28 * s, letterSpacing: "0.3em", color: GOLD, marginTop: 16 * s, textShadow: SHADOW }}>
          {data.reference.toUpperCase()}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
