import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { EDITORIAL_EASE } from './motion';
import { DEFAULT_VERSES } from './KineticVerse';

/**
 * Scripture stage for the login page's left panel. Cycles through the same
 * verses used on the marketing page so the brand voice carries through to
 * sign-in. Confident — no longer hiding behind the form card. The right
 * panel hosts the form; this side just breathes the message of the product.
 *
 * Respects prefers-reduced-motion.
 */
export function LoginBackdrop() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const verse = DEFAULT_VERSES[i % DEFAULT_VERSES.length];

  const wordCount = useMemo(
    () => verse.lines.reduce((n, line) => n + line.length, 0),
    [verse],
  );
  const wordDurationMs = 850;
  const staggerMs = 240;
  const revealMs = wordCount * staggerMs + wordDurationMs;
  const holdMs = 5500;

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
      className="relative flex h-full w-full flex-col justify-between overflow-hidden p-8 sm:p-12 lg:p-16"
      aria-label="Scripture from the studio"
    >
      {/* Ambient depth — warm halos, no competing structure. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(212,175,110,0.12),transparent_55%),radial-gradient(circle_at_85%_85%,rgba(107,79,31,0.18),transparent_55%)]" />
      <div className="pointer-events-none absolute -left-32 top-1/3 h-[480px] w-[480px] rounded-full bg-editorial-goldLite/8 blur-[140px]" />

      {/* Kicker — top-left. Also the way back to the public landing page. */}
      <Link
        to="/"
        className="relative z-10 inline-flex w-fit items-center gap-2 font-sans text-[10px] uppercase tracking-[3px] text-editorial-gold/80 hover:text-editorial-goldLite transition-colors"
        title="Back to home"
      >
        <span aria-hidden="true">←</span>
        <span className="hidden sm:inline">Biblefuel · </span>
        Rendered live
      </Link>

      {/* Scripture body — vertically centred, word-by-word reveal. */}
      <div className="relative z-10 flex flex-1 items-center py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={verse.ref}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.7, ease: EDITORIAL_EASE }}
            className="w-full"
          >
            {verse.lines.map((line, lineIdx) => (
              <div
                key={lineIdx}
                className="font-displaySerif leading-[1.1] tracking-[-0.4px] text-editorial-cream text-[34px] sm:text-[44px] md:text-[52px] lg:text-[60px] xl:text-[68px]"
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
                          ? 'mr-[0.22em] inline-block italic text-editorial-goldLite'
                          : 'mr-[0.22em] inline-block'
                      }
                      initial={
                        reduce
                          ? { opacity: 1 }
                          : { opacity: 0, y: 12, filter: 'blur(8px)' }
                      }
                      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
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
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Verse reference + progress dots — bottom-left. */}
      <div className="relative z-10 flex items-center justify-between font-sans text-[10px] tracking-[2.5px] text-editorial-gold/70 sm:text-[11px]">
        <span>{verse.ref}</span>
        <div className="flex gap-1.5" aria-hidden="true">
          {DEFAULT_VERSES.map((_, idx) => (
            <span
              key={idx}
              className={`h-[2px] w-5 transition-colors ${
                idx === i % DEFAULT_VERSES.length
                  ? 'bg-editorial-goldLite'
                  : 'bg-editorial-gold/25'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
