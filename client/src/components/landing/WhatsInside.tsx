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
    <section id="studio" className="bg-editorial-paper px-10 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 text-center font-sans text-[12px] tracking-[12px] text-editorial-gold">
          ✦  ✦  ✦
        </div>

        <motion.h2
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          variants={m.fadeUp}
          className="font-displaySerif text-[40px] leading-[1.05] tracking-[-0.6px] text-editorial-ink"
        >
          What's inside the studio.
        </motion.h2>

        <motion.p
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.4 }}
          variants={m.fadeUp}
          className="mb-12 max-w-[600px] font-bodyserif text-[15px] leading-[1.55] text-editorial-muted"
        >
          Three crafts, one tab. No agencies, no installs — just the tools the work actually needs.
        </motion.p>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={m.staggerChildren}
          className="grid grid-cols-1 gap-9 md:grid-cols-3"
        >
          {features.map((f) => (
            <motion.div key={f.title} variants={m.fadeUp}>
              <div className="font-displaySerif text-[26px] italic text-editorial-gold">{f.numeral}</div>
              <h3 className="mt-3 font-displaySerif text-[22px] text-editorial-ink">{f.title}</h3>
              <p className="mt-2 font-bodyserif text-[14px] leading-[1.6] text-editorial-muted">{f.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
