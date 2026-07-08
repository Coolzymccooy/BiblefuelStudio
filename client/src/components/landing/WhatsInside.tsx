// client/src/components/landing/WhatsInside.tsx
import { motion } from 'framer-motion';
import { useEditorialMotion } from './motion';

type Feature = { numeral: string; title: string; body: string };

const features: Feature[] = [
  {
    numeral: 'i.',
    title: 'Scripts',
    body: 'Generate sermon clips, devotionals, and series outlines from Scripture. Edit them like a writer would, not a chatbot.',
  },
  {
    numeral: 'ii.',
    title: 'Voice',
    body: 'Turn any script into spoken word — your voice (cloned with consent) or a chosen library voice. Clean, warm, ready to publish.',
  },
  {
    numeral: 'iii.',
    title: 'Kinetic Video',
    body: 'Render captioned, kinetic-typography videos of any verse — the same engine you saw above. Post to TikTok, YouTube, Instagram.',
  },
];

export function WhatsInside() {
  const m = useEditorialMotion();

  return (
    <section id="studio" className="bg-[#0b0906] px-5 py-14 sm:px-8 sm:py-20 md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 text-center font-sans text-[11px] tracking-[8px] text-bf-goldDeep sm:mb-8 sm:text-[12px] sm:tracking-[12px]">
          ✦  ✦  ✦
        </div>

        <motion.h2
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          variants={m.fadeUp}
          className="font-displaySerif text-[32px] leading-[1.05] tracking-[-0.4px] text-bf-cream sm:text-[40px] sm:tracking-[-0.6px]"
        >
          What's inside the studio.
        </motion.h2>

        <motion.p
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          variants={m.fadeUp}
          className="mb-10 mt-3 max-w-[600px] font-bodyserif text-[14px] leading-[1.55] text-bf-sub sm:mb-12 sm:text-[15px]"
        >
          Three crafts, one tab. No agencies, no installs — just the tools the work actually needs.
        </motion.p>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={m.staggerChildren}
          className="grid grid-cols-1 gap-7 sm:gap-9 md:grid-cols-3"
        >
          {features.map((f) => (
            <motion.div key={f.title} variants={m.fadeUp} className="rounded-bf border border-[rgba(216,184,120,0.10)] bg-bf-card p-5 sm:p-6">
              <div className="font-displaySerif text-[24px] italic text-bf-gold sm:text-[26px]">{f.numeral}</div>
              <h3 className="mt-2 font-displaySerif text-[20px] text-bf-cream sm:mt-3 sm:text-[22px]">{f.title}</h3>
              <p className="mt-2 font-bodyserif text-[14px] leading-[1.6] text-bf-sub">{f.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
