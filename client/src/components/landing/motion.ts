// Shared animation tokens for the landing page. One easing curve, one set
// of variants. Every landing component imports from here so the page has
// a unified rhythm.

import { useReducedMotion } from 'framer-motion';
import type { Variants, Transition } from 'framer-motion';

export const EDITORIAL_EASE: Transition['ease'] = [0.2, 0.7, 0.2, 1];

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: EDITORIAL_EASE } },
};

export const fadeUpFast: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EDITORIAL_EASE } },
};

export const staggerChildren: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.15 } },
};

export const staggerSlow: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.25 } },
};

export const wordReveal: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.7, ease: EDITORIAL_EASE } },
};

export const wordStagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

// Hook returning variants that collapse to instant when prefers-reduced-motion.
export function useEditorialMotion() {
  const reduce = useReducedMotion();
  if (!reduce) {
    return { fadeUp, fadeUpFast, staggerChildren, staggerSlow, wordReveal, wordStagger };
  }
  const instant: Variants = { hidden: { opacity: 1 }, visible: { opacity: 1 } };
  const noStagger: Variants = { hidden: {}, visible: {} };
  return {
    fadeUp: instant,
    fadeUpFast: instant,
    staggerChildren: noStagger,
    staggerSlow: noStagger,
    wordReveal: instant,
    wordStagger: noStagger,
  };
}
