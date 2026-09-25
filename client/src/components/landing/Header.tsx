import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { EDITORIAL_EASE } from './motion';

function hasSession(): boolean {
  if (typeof window === 'undefined') return false;
  const t = window.localStorage.getItem('BF_TOKEN');
  return Boolean(t && t !== 'null' && t !== 'undefined');
}

export function Header() {
  const authed = hasSession();

  return (
    <header className="border-b border-editorial-hairline bg-editorial-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-8 sm:py-5 md:px-10">
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: EDITORIAL_EASE }}
          className="font-displaySerif text-[20px] italic tracking-tight text-editorial-dark sm:text-[22px]"
        >
          Biblefuel
        </motion.span>
        {/* Mobile keeps just the primary CTA. Studio / Who it's for return
            at sm: where there's room — anchor links are nice-to-have, not
            essential to the journey. */}
        <nav className="flex items-center gap-4 font-sans text-[11px] uppercase tracking-[1.5px] text-editorial-muted sm:gap-6">
          <a href="#studio" className="hidden sm:inline">Studio</a>
          <a href="#who" className="hidden sm:inline">Who it's for</a>
          {authed ? (
            <Link
              to="/app"
              className="flex items-center gap-1.5 rounded-full bg-editorial-ink px-3 py-2 text-[10px] font-semibold tracking-[1.6px] text-editorial-paper hover:bg-editorial-dark transition-colors sm:px-4 sm:text-[10.5px] sm:tracking-[1.8px]"
            >
              <span className="whitespace-nowrap">Resume in Studio</span>
              <ArrowRight size={12} />
            </Link>
          ) : (
            <a href="#access" className="whitespace-nowrap text-editorial-ink hover:underline">
              Request access
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}
