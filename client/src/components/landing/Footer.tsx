// client/src/components/landing/Footer.tsx
export function Footer() {
  return (
    <footer className="border-t border-editorial-hairline bg-editorial-paper px-5 py-7 sm:px-8 sm:py-9 md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-center font-sans text-[10px] uppercase tracking-[1px] text-editorial-muted sm:text-[11px] md:flex-row md:text-left">
        <span>© Biblefuel · A studio by Tiwaton</span>
        <div className="flex gap-4 sm:gap-5">
          <a href="mailto:hello@tiwaton.co.uk">Privacy</a>
          <a href="mailto:hello@tiwaton.co.uk">Terms</a>
          <a href="mailto:hello@tiwaton.co.uk">Contact</a>
        </div>
      </div>
    </footer>
  );
}
