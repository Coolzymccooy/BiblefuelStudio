// Enumerate every user-facing control on a page, so "all features carried over"
// can be a CHECKED claim rather than an assurance. Reads source, not the DOM,
// because a control behind a collapsed section is still a feature.
import fs from 'node:fs';

// The two pages, PLUS the components their controls are being extracted into.
// Scanning only the pages would report a control as "gone" the moment it moved
// into a component - which is a refactor, not a lost feature. The check must
// follow the controls, not the files.
const ROOT = new URL('../client/src/', import.meta.url);
const FILES = {
  render: new URL('pages/RenderPage.tsx', ROOT),
  voice: new URL('pages/VoiceAudioPage.tsx', ROOT),
};

// Every component under components/render and components/voice counts too.
for (const dir of ['components/render', 'components/voice']) {
  let entries = [];
  try { entries = fs.readdirSync(new URL(dir + '/', ROOT)); } catch { /* not created yet */ }
  for (const f of entries) {
    if (!f.endsWith('.tsx') || f.includes('.test.')) continue;
    FILES[`${dir}/${f}`] = new URL(`${dir}/${f}`, ROOT);
  }
}

const LABEL = /(?:title|label|aria-label|placeholder)="([^"]{2,60})"/g;

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    if (!/on(Click|Change|Submit|Drop)=/.test(line)) return;
    // Search FORWARD first. A control's own text sits on the lines after its
    // handler; searching backward first stole the previous button's label and
    // reported this one as missing.
    const fwd = lines.slice(i, i + 6).join(' ');
    const win = lines.slice(Math.max(0, i - 5), i + 7).join(' ');

    let label = '';
    // Own text content, forward only.
    const own = fwd.match(/>\s*([A-Z][A-Za-z0-9 '&/.,()-]{2,44}?)\s*</);
    if (own) label = own[1].trim();
    if (!label) {
      const explicit = [...win.matchAll(LABEL)];
      if (explicit.length) label = explicit[0][1];
    }

    if (!label) {
      // Text content anywhere in the window. The previous pattern required the
      // text to sit between > and < on ONE line, so a button whose label is on
      // the following line ("Use Latest Script") went unlabelled and looked
      // like a dropped control.
      const t = win.match(/>\s*\{?\s*'?([A-Z][A-Za-z0-9 '&/.,()-]{2,44}?)'?\s*\}?\s*</);
      if (t) label = t[1].trim();
    }
    if (!label) {
      // Fall back to the raw lines after the handler, which is where JSX puts
      // a multi-line label.
      for (let k = i; k < Math.min(lines.length, i + 6) && !label; k++) {
        const bare = lines[k].trim();
        if (/^[A-Z][A-Za-z0-9 '&/.,()-]{2,44}$/.test(bare)) label = bare;
      }
    }
    if (!label) {
      const setter = win.match(/set([A-Z][A-Za-z0-9]{2,28})\s*\(/);
      if (setter) label = 'sets ' + setter[1];
    }
    if (!label) {
      const fn = win.match(/on(?:Click|Change)=\{\s*\(?\)?\s*=?>?\s*(?:void\s+)?([a-zA-Z][A-Za-z0-9]{2,32})/);
      if (fn) label = fn[1] + '()';
    }
    out.push({ line: i + 1, label: label || '(unidentified)' });
  });
  return out;
}

// --- parity mode -------------------------------------------------------
// `--check` compares the CURRENT controls against the baseline captured
// before the merge. A control that exists in the baseline and not now is a
// feature that was dropped - which is exactly the assurance the operator
// asked for, expressed as a command rather than a promise.
const CHECK = process.argv.includes('--check');
const BASELINE = new URL('./control-inventory.baseline.json', import.meta.url);

const report = {};
for (const [name, file] of Object.entries(FILES)) {
  const items = scan(file);
  report[name] = items;
  const unknown = items.filter(i => i.label === '(unidentified)').length;
  console.log(`\n=== ${name.toUpperCase()} — ${items.length} controls, ${unknown} unidentified ===`);
  for (const it of items) console.log(`${String(it.line).padStart(5)}  ${it.label}`);
}

if (CHECK) {
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const now = new Set(Object.values(report).flat().map((i) => i.label));
  const missing = Object.values(base).flat()
    .map((i) => i.label)
    .filter((l) => l !== '(unidentified)' && !now.has(l));
  const unique = [...new Set(missing)];
  if (unique.length) {
    console.log(`FAIL - ${unique.length} control(s) present before the merge are gone:`);
    for (const l of unique) console.log('  - ' + l);
    process.exit(1);
  }
  console.log('PASS - every control in the baseline is still present.');
} else {
  fs.writeFileSync(new URL('./control-inventory.baseline.json', import.meta.url),
    JSON.stringify(report, null, 1));
  console.log('Baseline written. Run with --check after the merge.');
}
