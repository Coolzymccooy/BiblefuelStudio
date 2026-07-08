// client/src/pages/LandingPage.tsx
// Dark "quiet studio" landing. Responsive: a single mobile column that becomes a
// two-column hero on desktop (copy + kinetic verse side-by-side). Retains the
// production graphics + motion — the kinetic verse card (animated word reveals +
// cross-fades) and the "What's inside" / "How it works" sections.
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Flame, ArrowRight } from 'lucide-react';
import { AccessForm } from '../components/landing/AccessForm';
import { KineticVerse } from '../components/landing/KineticVerse';
import { WhatsInside } from '../components/landing/WhatsInside';
import { HowItWorks } from '../components/landing/HowItWorks';
import { useEditorialMotion } from '../components/landing/motion';
import '../styles/landing.css';

export function LandingPage() {
  const m = useEditorialMotion();
  const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('BF_TOKEN');

  return (
    <div className="min-h-screen text-bf-cream antialiased" style={{ background: 'linear-gradient(180deg,#0b0906,#080604)' }}>
      {/* ── Hero: one column on mobile, copy + verse side-by-side on desktop ── */}
      <section className="relative overflow-hidden px-6 pt-8 pb-10 lg:pb-16" style={{ background: 'linear-gradient(180deg,#171009 0%,#0d0906 100%)' }}>
        <div className="pointer-events-none absolute -top-16 right-[8%] h-72 w-72 rounded-full" style={{ background: 'radial-gradient(circle,rgba(216,184,120,0.14),transparent 70%)' }} />
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
          {/* Copy */}
          <motion.div initial="hidden" animate="visible" variants={m.staggerChildren} className="max-w-[540px]">
            <motion.div variants={m.fadeUpFast} className="mb-9 flex items-center gap-2.5">
              <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px]" style={{ background: 'linear-gradient(150deg,#e6c98a,#b0894f)', boxShadow: '0 6px 16px rgba(216,184,120,0.3)' }}>
                <Flame size={17} className="text-[#231803]" />
              </div>
              <div className="font-displaySerif text-xl font-semibold text-bf-cream">Biblefuel<span className="font-normal italic text-bf-goldDeep"> Studio</span></div>
            </motion.div>

            <motion.div variants={m.fadeUp} className="bf-eyebrow">— For those who carry the Word</motion.div>
            <motion.h1 variants={m.fadeUp} className="mt-4 font-displaySerif text-[44px] font-medium leading-[1.0] tracking-[-0.5px] text-[#f6efe1] sm:text-[54px] lg:text-[58px]">
              A quiet studio for <em className="font-medium italic text-[#dbb877]">louder</em> witness.
            </motion.h1>
            <motion.p variants={m.fadeUp} className="mt-5 max-w-[440px] font-displaySerif text-[16px] leading-relaxed text-bf-sub sm:text-[17px]">
              For ministries, teachers, and faithful makers — write, voice, and publish stories worthy of the gospel.
            </motion.p>

            <motion.div variants={m.fadeUp} className="mt-8 flex max-w-[440px] flex-col gap-3 sm:flex-row">
              <a href="#access" className="btn btn-primary h-[52px] flex-1 gap-2 rounded-[15px] text-[14px]">Request access <ArrowRight size={18} /></a>
              <Link to="/app" className="btn btn-secondary h-[52px] flex-1 rounded-[15px] text-[13px]">
                {hasToken ? 'Resume in Studio' : 'Sign in'}
              </Link>
            </motion.div>
          </motion.div>

          {/* Kinetic verse (production graphic: animated reveal + cross-fade) */}
          <motion.div initial="hidden" animate="visible" variants={m.fadeUp} className="mx-auto w-full max-w-[380px] lg:mx-0 lg:max-w-[440px]">
            <KineticVerse />
          </motion.div>
        </div>
      </section>

      {/* ── Production content sections (darkened, already responsive) ── */}
      <WhatsInside />
      <HowItWorks />

      <AccessForm />

      {/* ── Footer ── */}
      <footer className="border-t px-6 py-8 text-center" style={{ borderColor: 'rgba(216,184,120,0.08)' }}>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-bf-faint">© Biblefuel · A studio by Tiwaton</div>
        <div className="mt-2 flex items-center justify-center gap-4 text-[11px] text-bf-muted">
          <Link to="/privacy" className="hover:text-bf-gold">Privacy</Link>
          <a href="#access" className="hover:text-bf-gold">Contact</a>
        </div>
      </footer>
    </div>
  );
}
