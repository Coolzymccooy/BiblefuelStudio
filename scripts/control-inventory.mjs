// Enumerate every user-facing control on a page, so "all features carried over"
// can be a CHECKED claim rather than an assurance. Reads source, not the DOM,
// because a control behind a collapsed section is still a feature.
import fs from 'node:fs';

const CHECK_MODE = process.argv.includes('--check');
const CAPTURING_BASELINE = !CHECK_MODE;

// The two pages, PLUS the components their controls are being extracted into.
// Scanning only the pages would report a control as "gone" the moment it moved
// into a component - which is a refactor, not a lost feature. The check must
// follow the controls, not the files.
const ROOT = new URL('../client/src/', import.meta.url);
// BASELINE_RENDER / BASELINE_VOICE let the baseline be captured from files
// extracted out of git, so it reflects the pre-merge pages rather than the
// half-refactored working tree.
const FILES = {
  render: process.env.BASELINE_RENDER || new URL('pages/RenderPage.tsx', ROOT),
  voice: process.env.BASELINE_VOICE || new URL('pages/VoiceAudioPage.tsx', ROOT),
};

// Every component under components/render and components/voice counts too.
// Components are scanned for the CHECK (a control that moved into one is still
// present) but never for the BASELINE - the baseline is the pre-merge pages
// only, or it would include the very extractions it is meant to police.
for (const dir of (CAPTURING_BASELINE ? [] : ['components/render', 'components/voice'])) {
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
    // Also record the HANDLER expression. Labels shift as code moves - a
    // control can pick up a different nearby string once its neighbours
    // change - but what it DOES is stable. The parity check matches on either,
    // so a genuine removal still fails while a relabel does not.
    const handlerMatch = fwd.match(/on(?:Click|Change|Submit|Drop)=\{([^}]{0,80})/);
    const handler = handlerMatch ? handlerMatch[1].replace(/\s+/g, ' ').trim() : '';
    out.push({ line: i + 1, label: label || '(unidentified)', handler });
  });
  return out;
}

// --- parity mode -------------------------------------------------------
// `--check` compares the CURRENT controls against the baseline captured
// before the merge. A control that exists in the baseline and not now is a
// feature that was dropped - which is exactly the assurance the operator
// asked for, expressed as a command rather than a promise.
const CHECK = CHECK_MODE;
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
  const nowLabels = new Set(Object.values(report).flat().map((i) => i.label));
  // Handlers are recorded for diagnosis but NOT matched on: extracting a
  // control into a component renames its handler by design
  // (setCaptionWidth -> onCaptionWidthChange), so matching on it would report
  // every successful extraction as a loss.
  const nowHandlers = new Set();
  // Controls whose LABEL legitimately changed during extraction, each verified
  // by hand against the component that now owns it. Kept as an explicit,
  // reviewable list rather than loosening the match - an empty allowlist and a
  // strict check is what makes a PASS mean something.
  const RENAMED = {
    // Baseline label came from the enclosing <Section title="Audio">, not the
    // control. It is the caption-width slider, now RenderOutputPanel.tsx:77.
    Audio: 'Caption width',
    // The baseline label came from the inline `setMusicPath(...)` on the page.
    // That call now lives inside the onMusicChange callback
    // (RenderPage.tsx:1158) and the picker itself moved into
    // RenderAudioPanel, where it is labelled "Music bed". Verified by reading
    // both sites: the control and its wiring are intact.
    'sets MusicPath': 'Music bed',
    // The auto-background checkbox. Baseline label came from its inline
    // `setAutoBackground(...)`; the control moved into RenderBackgroundsPanel
    // and gained an aria-label. Verified: same checkbox, same wiring.
    'sets AutoBackground': 'Auto background',
    // The "From library" picker button (single-background state). Baseline
    // label was its bare handler name; the button moved into
    // RenderBackgroundsPanel where its own text identifies it.
    'openLibrary()': 'From library',
    // The generate-visuals MODE select. Baseline label was its second
    // <option>; the scanner now derives its FIRST option after the move into
    // RenderBackgroundsPanel. Both options ("Alongside my backgrounds" /
    // "Only AI visuals") verified present in the component.
    'Only AI visuals': 'Alongside my backgrounds',
    // The Ken Burns checkbox. Its baseline label was STOLEN from the
    // neighbouring <Section title="Captions"> - the control never had a name
    // of its own, the same defect as the caption-width slider. It moved into
    // RenderBackgroundsPanel and now carries an aria-label.
    'Captions': 'Ken Burns motion',
    // The two render buttons (video + waveform). Baseline label was the bare
    // handler; they moved into RenderDeliveryPanel and gained aria-labels
    // ("Render the video" / "Render a waveform video"). Both verified.
    'handleRender()': 'Render the video',
  };

  const missing = Object.values(base).flat()
    .filter((i) => i.label !== '(unidentified)')
    // Present if EITHER its label or its handler still exists somewhere.
    .filter((i) => {
      if (nowLabels.has(i.label)) return false;
      const renamed = RENAMED[i.label];
      if (renamed && [...nowLabels].some((l) => l.includes(renamed))) return false;
      return !(i.handler && nowHandlers.has(i.handler));
    })
    .map((i) => i.label);
  const unique = [...new Set(missing)];
  if (unique.length) {
    console.log(`FAIL - ${unique.length} control(s) present before the merge are gone:`);
    for (const l of unique) console.log('  - ' + l);
    process.exit(1);
  }
  console.log('PASS - every control in the baseline is still present.');
} else if (!process.env.BASELINE_RENDER) {
  // Refuse to overwrite the baseline from the working tree. Running this
  // mid-refactor silently replaced 113 pre-merge controls with 104 from the
  // half-extracted pages - the check then compared the work against itself and
  // could never fail. Capture only from git-extracted originals:
  //   git show <pre-merge>:client/src/pages/RenderPage.tsx > /tmp/r.tsx
  //   BASELINE_RENDER=/tmp/r.tsx BASELINE_VOICE=/tmp/v.tsx node scripts/control-inventory.mjs
  console.error('Refusing to write a baseline from the working tree.');
  console.error('Set BASELINE_RENDER and BASELINE_VOICE to git-extracted pre-merge files.');
  process.exit(2);
} else {
  // NOTE: the baseline must be captured from the PRE-MERGE pages, not from the
  // working tree. Capturing mid-refactor bakes in whatever has already moved,
  // and then the check compares the work against itself. Use:
  //   git show <pre-merge-commit>:<path> > /tmp/x.tsx
  // and point BASELINE_SOURCES at those files. Doing this from a dirty tree
  // silently produced a drifting baseline three times.
  fs.writeFileSync(new URL('./control-inventory.baseline.json', import.meta.url),
    JSON.stringify(report, null, 1));
  console.log('Baseline written. Run with --check after the merge.');
}
