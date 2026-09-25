import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { EDITORIAL_EASE } from './motion';
import '../../styles/landing.css';

export type KineticVerseData = {
  ref: string;
  // Each inner array is a line; each token is a word. Prefix with '*' for italic gold.
  lines: string[][];
};

export const DEFAULT_VERSES: KineticVerseData[] = [
  {
    ref: 'JOHN 1:1',
    lines: [
      ['In', 'the', 'beginning', '*was', '*the', '*Word,'],
      ['and', 'the', 'Word', 'was', '*with', '*God.'],
    ],
  },
  {
    ref: 'PSALM 119:105',
    lines: [
      ['Your', 'word', 'is', 'a', '*lamp', 'to', 'my', 'feet'],
      ['and', 'a', '*light', 'to', 'my', 'path.'],
    ],
  },
  {
    ref: 'ISAIAH 40:8',
    lines: [
      ['The', 'grass', 'withers,', 'the', 'flower', 'fades,'],
      ['but', 'the', 'word', 'of', 'our', 'God', '*stands', '*forever.'],
    ],
  },
  {
    ref: 'HEBREWS 4:12',
    lines: [
      ['The', 'word', 'of', 'God', 'is', '*living', 'and', '*active,'],
      ['sharper', 'than', 'any', 'two-edged', '*sword.'],
    ],
  },
];

export interface KineticVerseProps {
  verses?: KineticVerseData[];
  cycle?: boolean;
  holdMs?: number;
  staggerMs?: number;
  wordDurationMs?: number;
  className?: string;
}

export function KineticVerse({
  verses = DEFAULT_VERSES,
  cycle = true,
  holdMs = 4500,
  staggerMs = 200,
  wordDurationMs = 700,
  className = '',
}: KineticVerseProps) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const verse = verses[i % verses.length];

  // Estimate total reveal time so the hold starts after the last word lands.
  const wordCount = useMemo(
    () => verse.lines.reduce((n, line) => n + line.length, 0),
    [verse],
  );
  const revealMs = wordCount * staggerMs + wordDurationMs;

  useEffect(() => {
    if (!cycle || reduce || verses.length < 2) return;
    const t = setTimeout(() => setI((p) => (p + 1) % verses.length), revealMs + holdMs);
    return () => clearTimeout(t);
  }, [cycle, reduce, verses.length, revealMs, holdMs, i]);

  return (
    <div className={`bf-kinetic ${className}`} role="img" aria-label={`Verse: ${verse.ref}`}>
      <div className="bf-kinetic__grain" aria-hidden="true" />
      <div className="bf-kinetic__kicker">RENDERED LIVE · NO INSTALLS</div>
      <div className="bf-kinetic__vbox">
        <AnimatePresence mode="wait">
          <motion.div
            key={verse.ref}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.6, ease: EDITORIAL_EASE }}
          >
            {verse.lines.map((line, lineIdx) => (
              <div className="bf-kinetic__line" key={lineIdx}>
                {line.map((tok, wordIdx) => {
                  const em = tok.startsWith('*');
                  const text = em ? tok.slice(1) : tok;
                  const order = verse.lines
                    .slice(0, lineIdx)
                    .reduce((n, l) => n + l.length, 0) + wordIdx;
                  return (
                    <motion.span
                      key={`${verse.ref}-${lineIdx}-${wordIdx}`}
                      className={em ? 'bf-kinetic__word bf-kinetic__word--em' : 'bf-kinetic__word'}
                      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{
                        duration: reduce ? 0 : wordDurationMs / 1000,
                        delay: reduce ? 0 : (order * staggerMs) / 1000,
                        ease: EDITORIAL_EASE,
                      }}
                    >
                      {text}{' '}
                    </motion.span>
                  );
                })}
              </div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="bf-kinetic__ref">
        <span>{verse.ref}</span>
        <div className="bf-kinetic__progress" aria-hidden="true">
          {verses.map((_, idx) => (
            <span key={idx} className={idx === i % verses.length ? 'is-active' : ''} />
          ))}
        </div>
      </div>
    </div>
  );
}
