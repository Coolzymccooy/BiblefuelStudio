import { motion } from 'framer-motion';
import { EDITORIAL_EASE } from './motion';

export function Header() {
  return (
    <header className="border-b border-editorial-hairline bg-editorial-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-10 py-5">
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: EDITORIAL_EASE }}
          className="font-displaySerif text-[22px] italic tracking-tight text-editorial-dark"
        >
          Biblefuel
        </motion.span>
        <nav className="flex gap-6 font-sans text-[11px] uppercase tracking-[1.5px] text-editorial-muted">
          <a href="#studio">Studio</a>
          <a href="#who">Who it's for</a>
          <a href="#access" className="text-editorial-ink hover:underline">Request access</a>
        </nav>
      </div>
    </header>
  );
}
