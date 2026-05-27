// client/src/components/landing/HowItWorks.tsx
import { motion } from 'framer-motion';
import { useEditorialMotion } from './motion';

type Step = { num: string; title: string; body: string };

const steps: Step[] = [
  { num: 'I · Write',   title: 'Begin with the Word.', body: 'Pick a passage or topic. The studio drafts a script in your voice. Refine until it sings.' },
  { num: 'II · Speak',  title: 'Give it a voice.',     body: 'Record yours or use a voice you trust. Clean the audio. Add music. Listen back.' },
  { num: 'III · Publish', title: 'Send it out.',       body: 'Render, caption, and schedule. The Word goes where the next generation already is.' },
];

export function HowItWorks() {
  const m = useEditorialMotion();

  return (
    <section id="who" className="bg-editorial-dark px-5 py-14 text-editorial-paper sm:px-8 sm:py-20 md:px-10">
      <div className="mx-auto max-w-6xl">
        <motion.h2
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          variants={m.fadeUp}
          className="font-displaySerif text-[30px] leading-[1.08] tracking-[-0.4px] sm:text-[40px] sm:leading-[1.05] sm:tracking-[-0.6px]"
        >
          From a verse to the world,<br className="hidden sm:inline" /> in three movements.
        </motion.h2>

        <motion.p
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          variants={m.fadeUp}
          className="mb-10 mt-3 max-w-[600px] font-bodyserif text-[14px] leading-[1.55] text-[#a8a098] sm:mb-12 sm:text-[15px]"
        >
          The studio was built around a simple liturgy of making.
        </motion.p>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={m.staggerSlow}
          className="grid grid-cols-1 gap-7 sm:gap-9 md:grid-cols-3"
        >
          {steps.map((s) => (
            <motion.div key={s.num} variants={m.fadeUp} className="border-t border-editorial-goldLite/20 pt-5 sm:pt-6">
              <div className="font-sans text-[11px] uppercase tracking-[2px] text-editorial-goldLite">{s.num}</div>
              <h3 className="mt-2 font-displaySerif text-[22px] sm:text-[26px]">{s.title}</h3>
              <p className="mt-3 font-bodyserif text-[14px] leading-[1.6] text-[#a8a098]">{s.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
