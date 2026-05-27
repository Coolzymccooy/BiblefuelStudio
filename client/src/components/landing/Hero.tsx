import { motion } from 'framer-motion';
import { useEditorialMotion } from './motion';
import { KineticVerse } from './KineticVerse';

export function Hero() {
  const m = useEditorialMotion();

  // Headline split: ["A", "quiet", "studio", "for", "*louder*", "witness."]
  // Stars wrap an italic-gold word.
  const headlineWords = ['A', 'quiet', 'studio', 'for', '*louder*', 'witness.'];

  return (
    <section className="bg-gradient-to-b from-editorial-paper to-editorial-parchment px-5 py-16 sm:px-8 sm:py-20 md:px-10 md:py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 sm:gap-12 md:grid-cols-[1.1fr_1fr]">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={m.staggerChildren}
        >
          <motion.div
            variants={m.fadeUpFast}
            className="mb-3 font-sans text-[10px] uppercase tracking-[2.2px] text-editorial-gold sm:mb-4 sm:tracking-[2.5px]"
          >
            — For those who carry the Word
          </motion.div>

          <motion.h1
            variants={m.wordStagger}
            className="font-displaySerif text-[36px] leading-[1.02] tracking-[-0.8px] text-editorial-ink sm:text-[44px] sm:leading-[0.98] sm:tracking-[-1.2px] md:text-[62px]"
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
            className="mt-5 font-bodyserif text-[15px] leading-[1.55] text-editorial-body sm:mt-6 sm:max-w-[90%] sm:text-[16px]"
          >
            For ministries, teachers, and faithful makers — write, voice, and publish stories worthy of the gospel.
          </motion.p>

          <motion.div variants={m.fadeUp} className="mt-7 flex flex-wrap items-center gap-4 sm:mt-8">
            <a
              href="#access"
              className="inline-block rounded-sm bg-editorial-ink px-5 py-3 font-sans text-[11px] font-medium uppercase tracking-[1.6px] text-editorial-paper sm:px-6 sm:py-3.5 sm:tracking-[1.8px]"
            >
              Request access →
            </a>
            <a
              href="/app"
              className="font-sans text-[12px] text-editorial-muted underline underline-offset-4 hover:text-editorial-ink transition-colors"
            >
              Already have an account? Sign in
            </a>
          </motion.div>
        </motion.div>

        <KineticVerse />
      </div>
    </section>
  );
}
