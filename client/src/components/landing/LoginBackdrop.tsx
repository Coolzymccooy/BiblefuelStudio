import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { EDITORIAL_EASE } from './motion';
import { DEFAULT_VERSES } from './KineticVerse';

/**
 * Animated scripture backdrop for the auth pane. Cycles through the same
 * verses used on the marketing page so the brand voice carries through to
 * sign-in. Sits behind the form card at low opacity — felt, not loud.
 *
 * Disabled gracefully under prefers-reduced-motion.
 */
export function LoginBackdrop() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const verse = DEFAULT_VERSES[i % DEFAULT_VERSES.length];

  const wordCount = useMemo(
    () => verse.lines.reduce((n, line) => n + line.length, 0),
    [verse],
  );
  const wordDurationMs = 900;
  const staggerMs = 260;
  const revealMs = wordCount * staggerMs + wordDurationMs;
  const holdMs = 6000;

  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(
      () => setI((p) => (p + 1) % DEFAULT_VERSES.length),
      revealMs + holdMs,
    );
    return () => clearTimeout(t);
  }, [reduce, revealMs, holdMs, i]);

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden select-none"
      aria-hidden="true"
    >
      {/* Underlying ambient glows. Two off-axis halos plus a vertical
          beam create depth without competing with the form card. */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_28%,rgba(212,175,110,0.10),transparent_55%),radial-gradient(circle_at_78%_82%,rgba(107,79,31,0.16),transparent_50%)]" />
      <div className="absolute left-1/2 top-0 h-full w-[640px] -translate-x-1/2 bg-[radial-gradient(ellipse_at_top,rgba(212,175,110,0.08),transparent_70%)]" />

      <AnimatePresence mode="wait">
        <motion.div
          key={verse.ref}
          className="relative max-w-6xl px-8 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.9, ease: EDITORIAL_EASE }}
        >
          {verse.lines.map((line, lineIdx) => (
            <div
              key={lineIdx}
              className="font-displaySerif text-[56px] sm:text-[84px] md:text-[112px] lg:text-[132px] leading-[1.04] tracking-[-0.015em]"
            >
              {line.map((tok, wordIdx) => {
                const em = tok.startsWith('*');
                const text = em ? tok.slice(1) : tok;
                const order =
                  verse.lines.slice(0, lineIdx).reduce((n, l) => n + l.length, 0) +
                  wordIdx;
                return (
                  <motion.span
                    key={`${verse.ref}-${lineIdx}-${wordIdx}`}
                    className={
                      em
                        ? 'inline-block italic text-editorial-goldLite/55 px-2'
                        : 'inline-block text-editorial-cream/30 px-2'
                    }
                    initial={
                      reduce
                        ? { opacity: 1 }
                        : { opacity: 0, y: 14, scale: 0.985, filter: 'blur(10px)' }
                    }
                    animate={{
                      opacity: 1,
                      y: 0,
                      scale: 1,
                      filter: 'blur(0px)',
                    }}
                    transition={{
                      duration: reduce ? 0 : wordDurationMs / 1000,
                      delay: reduce ? 0 : (order * staggerMs) / 1000,
                      ease: EDITORIAL_EASE,
                    }}
                  >
                    {text}
                  </motion.span>
                );
              })}
            </div>
          ))}
          <div className="mt-10 font-sans text-[11px] tracking-[3.4px] text-editorial-gold/70">
            {verse.ref}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Vignette so the verse text fades at the edges and the form card
          sits in the brightest patch of the page. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(10,7,4,0.45)_72%,rgba(10,7,4,0.85)_100%)]" />
    </div>
  );
}
