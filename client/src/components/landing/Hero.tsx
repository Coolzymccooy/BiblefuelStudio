import { motion } from 'framer-motion';
import { useEditorialMotion } from './motion';
import { KineticVerse } from './KineticVerse';

export function Hero() {
  const m = useEditorialMotion();

  // Headline split: ["A", "quiet", "studio", "for", "*louder*", "witness."]
  // Stars wrap an italic-gold word.
  const headlineWords = ['A', 'quiet', 'studio', 'for', '*louder*', 'witness.'];

  return (
    <section className="bg-gradient-to-b from-editorial-paper to-editorial-parchment px-10 py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 md:grid-cols-[1.1fr_1fr]">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={m.staggerChildren}
        >
          <motion.div
            variants={m.fadeUpFast}
            className="mb-4 font-sans text-[10px] uppercase tracking-[2.5px] text-editorial-gold"
          >
            — For those who carry the Word
          </motion.div>

          <motion.h1
            variants={m.wordStagger}
            className="font-displaySerif text-[44px] leading-[0.98] tracking-[-1.2px] text-editorial-ink md:text-[62px]"
          >
            {headlineWords.map((w, i) => {
              const em = w.startsWith('*') && w.endsWith('*');
              const text = em ? w.slice(1, -1) : w;
              return (
                <motion.span
                  key={i}
                  variants={m.wordReveal}
                  className={
                    em
                      ? 'mr-[0.25em] inline-block italic text-editorial-goldDeep'
                      : 'mr-[0.25em] inline-block'
                  }
                >
                  {text}
                </motion.span>
              );
            })}
          </motion.h1>

          <motion.p
            variants={m.fadeUp}
            className="mt-6 max-w-[90%] font-bodyserif text-[16px] leading-[1.55] text-editorial-body"
          >
            For ministries, teachers, and faithful makers — write, voice, and publish stories worthy of the gospel.
          </motion.p>

          <motion.div variants={m.fadeUp} className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="#access"
              className="inline-block rounded-sm bg-editorial-ink px-6 py-3.5 font-sans text-[11px] font-medium uppercase tracking-[1.8px] text-editorial-paper"
            >
              Request access →
            </a>
            <a
              href="/app"
              target="_blank"
              rel="noopener"
              className="font-sans text-[12px] text-editorial-muted underline underline-offset-4"
            >
              See the studio
            </a>
          </motion.div>
        </motion.div>

        <KineticVerse />
      </div>
    </section>
  );
}
