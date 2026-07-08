// client/src/pages/LandingPage.tsx
// Dark "quiet studio" landing — matches the mobile redesign handoff: a cinematic
// hero, a scripture "verse of the moment" card, the pipeline feature grid, and
// the (dark) request-access form.
import { Link } from 'react-router-dom';
import { Flame, ArrowRight, FileText, AudioLines, Clapperboard, Send, type LucideIcon } from 'lucide-react';
import { AccessForm } from '../components/landing/AccessForm';
import '../styles/landing.css'; // provides the .bf-honeypot rule the access form relies on

interface Feature {
  icon: LucideIcon;
  title: string;
  desc: string;
}

const features: Feature[] = [
  { icon: FileText, title: 'Scripts', desc: 'Hook, verse, reflection, CTA — generated or written.' },
  { icon: AudioLines, title: 'Voice', desc: 'Lifelike narration, recorded or synthesized.' },
  { icon: Clapperboard, title: 'Story Video', desc: 'Scripture into cinematic, captioned scenes.' },
  { icon: Send, title: 'Publish', desc: 'Render and auto-post to TikTok & YouTube.' },
];

export function LandingPage() {
  const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('BF_TOKEN');

  return (
    <div className="min-h-screen text-bf-cream antialiased" style={{ background: 'linear-gradient(180deg,#0b0906,#080604)' }}>
      {/* ── Hero ── */}
      <div className="relative overflow-hidden px-6 pt-8 pb-9" style={{ background: 'linear-gradient(180deg,#171009 0%,#0d0906 100%)' }}>
        <div className="pointer-events-none absolute -top-10 -right-8 h-52 w-52 rounded-full" style={{ background: 'radial-gradient(circle,rgba(216,184,120,0.14),transparent 70%)' }} />
        <div className="relative mx-auto max-w-[460px]">
          <div className="mb-9 flex items-center gap-2.5">
            <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px]" style={{ background: 'linear-gradient(150deg,#e6c98a,#b0894f)', boxShadow: '0 6px 16px rgba(216,184,120,0.3)' }}>
              <Flame size={17} className="text-[#231803]" />
            </div>
            <div className="font-displaySerif text-xl font-semibold text-bf-cream">Biblefuel<span className="font-normal italic text-bf-goldDeep"> Studio</span></div>
          </div>

          <div className="bf-eyebrow">— For those who carry the Word</div>
          <h1 className="mt-4 font-displaySerif text-[46px] font-medium leading-[1.0] tracking-[-0.5px] text-[#f6efe1]">
            A quiet studio for <em className="font-medium italic text-[#dbb877]">louder</em> witness.
          </h1>
          <p className="mt-4 max-w-[94%] font-displaySerif text-[16px] leading-relaxed text-bf-sub">
            For ministries, teachers, and faithful makers — write, voice, and publish stories worthy of the gospel.
          </p>

          <div className="mt-7 flex flex-col gap-3">
            <a href="#access" className="btn btn-primary h-[52px] gap-2 rounded-[15px] text-[14px]">Request access <ArrowRight size={18} /></a>
            <Link to="/app" className="btn btn-secondary h-[44px] rounded-[15px] text-[13px]">
              {hasToken ? 'Resume in Studio' : 'Already have an account? Sign in'}
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[460px] px-[18px]">
        {/* ── Verse of the moment ── */}
        <div className="my-5 overflow-hidden rounded-bf-lg p-[26px]" style={{ border: '1px solid rgba(216,184,120,0.14)', background: 'linear-gradient(165deg,#1a130b,#0e0a06)' }}>
          <div className="bf-eyebrow">Verse of the moment</div>
          <div className="mt-3.5 font-displaySerif text-[26px] italic leading-[1.3] text-[#f0e6d4]">
            &ldquo;The grass withers, the flower fades, but the word of our God will stand forever.&rdquo;
          </div>
          <div className="mt-4 font-mono text-[11px] tracking-wider text-bf-muted">— ISAIAH 40:8</div>
        </div>

        {/* ── Feature grid ── */}
        <div className="px-1 pb-8">
          <div className="bf-eyebrow mb-3.5 mt-2" style={{ color: '#7d7259' }}>The whole pipeline, one studio</div>
          <div className="grid grid-cols-2 gap-2.5">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-bf p-4" style={{ border: '1px solid rgba(216,184,120,0.10)', background: '#140f09' }}>
                <Icon size={22} className="text-[#dbb877]" />
                <div className="mt-2.5 font-semibold text-[13px] text-[#eadfca]">{title}</div>
                <div className="mt-1 text-[11px] leading-snug text-[#8f8571]">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

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
