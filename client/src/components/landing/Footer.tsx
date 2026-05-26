// client/src/components/landing/Footer.tsx
export function Footer() {
  return (
    <footer className="border-t border-editorial-hairline bg-editorial-paper px-10 py-9">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 font-sans text-[11px] uppercase tracking-[1px] text-editorial-muted md:flex-row">
        <span>© Biblefuel · A studio by Tiwaton</span>
        <div className="flex gap-5">
          <a href="mailto:hello@tiwaton.co.uk">Privacy</a>
          <a href="mailto:hello@tiwaton.co.uk">Terms</a>
          <a href="mailto:hello@tiwaton.co.uk">Contact</a>
        </div>
      </div>
    </footer>
  );
}
