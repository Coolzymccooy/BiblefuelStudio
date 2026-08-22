// Enumerate every user-facing control on a page, so "all features carried over"
// can be a CHECKED claim rather than an assurance. Reads source, not the DOM,
// because a control behind a collapsed section is still a feature.
import fs from 'node:fs';

const FILES = {
  render: 'C:/Users/segun/source/repos/biblefuel-studio/client/src/pages/RenderPage.tsx',
  voice:  'C:/Users/segun/source/repos/biblefuel-studio/client/src/pages/VoiceAudioPage.tsx',
};

const LABEL = /(?:title|label|aria-label|placeholder)="([^"]{2,60})"/g;

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    if (!/on(Click|Change|Submit|Drop)=/.test(line)) return;
    const win = lines.slice(Math.max(0, i - 5), i + 7).join(' ');

    let label = '';
    const explicit = [...win.matchAll(LABEL)];
    if (explicit.length) label = explicit[0][1];

    if (!label) {
      const t = win.match(/>\s*\{?\s*'?([A-Z][A-Za-z0-9 '&/.,()-]{2,44})'?\s*\}?\s*</);
      if (t) label = t[1].trim();
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
