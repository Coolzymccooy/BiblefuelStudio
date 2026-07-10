# Voice & Audio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `client/src/pages/VoiceAudioPage.tsx` into a create-first hero + sticky player + calm reveal sections (two-pane on desktop), with zero behaviour change.

**Architecture:** Behaviour-preserving layout refactor. The page keeps ALL existing state, effects, and handlers. We (1) add one new reusable `RevealSection` collapsible, (2) make the existing `VoicePlayer` sticky, (3) replace the secondary sections' `<Card title>` wrappers with `<RevealSection>` and drop the `activeTab` gating, (4) compose the TTS/provider/settings block into a `CreateVoiceHero` with record/upload inline, (5) surface Recent Audio as a desktop right-rail via a CSS grid — collapsing to a single column on mobile. Each task is independently testable and committable.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind (existing `bf-*` gold/cream tokens), vitest + @testing-library/react + jsdom (run: `npm run test` in `client/`).

## Global Constraints

- Palette/tokens unchanged — reuse existing `bf-gold` / `bf-cream` / `bf-card` / `rounded-bf`; **no new colours**; **no landing-page changes**.
- **Zero behaviour change** — every existing handler and API call stays: TTS generation + provider params, voice clone, voice presets, audio treatment, soundtrack library, record/upload, recent-audio "Use", caption animation, compare voices.
- Mobile-first; must also work at desktop (`lg`) widths.
- **Do NOT push/deploy.** All work stays on branch `feat/mobile-redesign`; the operator tests before any push.
- Commands run from `client/`. Type-check with `npx tsc -b`; unit tests with `npm run test`.
- Reuse existing components: `Card` (`../components/ui/Card`), `Button`, `VoicePlayer`. Follow the existing 4-space-indent, functional-component style.

---

### Task 1: `RevealSection` reusable collapsible

**Files:**
- Create: `client/src/components/voice-audio/RevealSection.tsx`
- Test: `client/src/components/voice-audio/RevealSection.test.tsx`

**Interfaces:**
- Consumes: nothing (leaf component).
- Produces:
  ```ts
  interface RevealSectionProps {
    title: string;
    /** Stable id used to persist open/closed state, e.g. "va.treatment". */
    storageKey: string;
    /** Open state on first ever render (before any user toggle). Default false. */
    defaultOpen?: boolean;
    /** Optional leading icon (lucide component). */
    icon?: LucideIcon;
    /** Optional right-aligned status text (e.g. "3 saved"). */
    hint?: string;
    children: React.ReactNode;
  }
  export function RevealSection(props: RevealSectionProps): JSX.Element;
  ```
  Persistence: reads/writes `localStorage["bf.reveal." + storageKey]` = `"1" | "0"`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/voice-audio/RevealSection.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { RevealSection } from './RevealSection';

describe('RevealSection', () => {
  beforeEach(() => localStorage.clear());

  it('is collapsed by default and hides its content', () => {
    render(<RevealSection title="Audio treatment" storageKey="treatment"><p>BODY</p></RevealSection>);
    expect(screen.getByRole('button', { name: /audio treatment/i })).toBeInTheDocument();
    expect(screen.queryByText('BODY')).not.toBeInTheDocument();
  });

  it('toggles open on click and persists the open state', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <RevealSection title="Audio treatment" storageKey="treatment"><p>BODY</p></RevealSection>,
    );
    await user.click(screen.getByRole('button', { name: /audio treatment/i }));
    expect(screen.getByText('BODY')).toBeInTheDocument();
    expect(localStorage.getItem('bf.reveal.treatment')).toBe('1');

    unmount();
    render(<RevealSection title="Audio treatment" storageKey="treatment"><p>BODY2</p></RevealSection>);
    expect(screen.getByText('BODY2')).toBeInTheDocument(); // remembered open
  });

  it('honours defaultOpen only when no stored value exists', () => {
    render(<RevealSection title="X" storageKey="x" defaultOpen><p>SHOWN</p></RevealSection>);
    expect(screen.getByText('SHOWN')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- RevealSection`
Expected: FAIL — `Failed to resolve import './RevealSection'`.

- [ ] **Step 3: Write the minimal implementation**

```tsx
// client/src/components/voice-audio/RevealSection.tsx
import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

interface RevealSectionProps {
  title: string;
  storageKey: string;
  defaultOpen?: boolean;
  icon?: LucideIcon;
  hint?: string;
  children: ReactNode;
}

function readOpen(storageKey: string, defaultOpen: boolean): boolean {
  try {
    const v = localStorage.getItem('bf.reveal.' + storageKey);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* ignore */ }
  return defaultOpen;
}

export function RevealSection({ title, storageKey, defaultOpen = false, icon: Icon, hint, children }: RevealSectionProps) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem('bf.reveal.' + storageKey, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <section className="rounded-bf border border-[rgba(216,184,120,0.12)] bg-bf-card">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        {Icon && <Icon size={18} className="shrink-0 text-bf-gold" />}
        <span className="flex-1 font-semibold text-[14px] text-bf-cream">{title}</span>
        {hint && <span className="text-help">{hint}</span>}
        <ChevronDown size={18} className={`shrink-0 text-bf-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- RevealSection`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc -b`
Expected: exit 0.

```bash
git add client/src/components/voice-audio/RevealSection.tsx client/src/components/voice-audio/RevealSection.test.tsx
git commit -m "feat(voice-audio): reusable RevealSection collapsible with remembered state"
```

---

### Task 2: Sticky waveform player

**Files:**
- Modify: `client/src/pages/VoiceAudioPage.tsx` (the `{currentAudioUrl && (<VoicePlayer …/>)}` block near line 1032–1035)

**Interfaces:**
- Consumes: existing `VoicePlayer` and the existing vars `currentAudioUrl`, `currentTrackLabel`, `currentTrackKind`.
- Produces: no new exports — the player is wrapped in a sticky container so it stays visible while scrolling.

- [ ] **Step 1: Wrap the existing player in a sticky container**

Replace the block currently at ~1032–1035:
```tsx
{/* Now-playing player for the current track (gold + animated waveform). */}
{currentAudioUrl && (
    <VoicePlayer src={currentAudioUrl} label={currentTrackLabel} kindLabel={currentTrackKind} />
)}
```
with:
```tsx
{/* Sticky now-playing player — pins under the app header (above the mobile
    nav) so preview + "Use in Render" stay reachable while scrolling. z-20
    keeps it under the app shell header/nav (z-30+) but over page content. */}
{currentAudioUrl && (
    <div className="sticky top-2 z-20 -mx-1 px-1">
        <VoicePlayer src={currentAudioUrl} label={currentTrackLabel} kindLabel={currentTrackKind} />
    </div>
)}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 3: Verify in the running app (manual/Playwright)**

Start the app (server on 5174 serving the dev client, or `npm run dev`). Open `/app/voice-audio` with a generated/selected clip so `currentAudioUrl` is set. Scroll the page: the player stays pinned near the top and does not scroll away. Confirm no overlap with the app header or bottom nav (adjust `top-2` if needed).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/VoiceAudioPage.tsx
git commit -m "feat(voice-audio): pin the now-playing player while scrolling"
```

---

### Task 3: Convert secondary sections to `RevealSection` and drop tab gating

**Files:**
- Modify: `client/src/pages/VoiceAudioPage.tsx` — the sections currently wrapped in `{(activeTab === …) && (<Card title="…">…</Card>)}`:
  - Voice Clone (~1362), Voice Presets (~1527), Record / Upload (~1615), Audio Treatment (~1675), Current Audio (~1931), Recent Audio (~1976), Soundtrack Library (~2072).

**Interfaces:**
- Consumes: `RevealSection` from Task 1.
- Produces: same rendered controls, now inside collapsibles; `activeTab` state becomes unused for these (removed in Task 5).

- [ ] **Step 1: Import RevealSection**

Add near the other component imports at the top of `VoiceAudioPage.tsx`:
```tsx
import { RevealSection } from '../components/voice-audio/RevealSection';
```

- [ ] **Step 2: Replace each secondary section's wrapper**

For EACH of the sections listed above, replace the outer
`{(activeTab === 'all' || activeTab === '<x>') && (` … `<Card title="<TITLE>">` … `</Card>` … `)}`
with a `RevealSection`, keeping the inner children **verbatim**. Pattern (example for Audio Treatment):

Before:
```tsx
{(activeTab === 'all' || activeTab === 'treatment') && (
    <Card title="Audio Treatment">
        {/* …existing children unchanged… */}
    </Card>
)}
```
After:
```tsx
<RevealSection title="Audio treatment" storageKey="va.treatment">
    {/* …existing children unchanged… */}
</RevealSection>
```

Apply with these `title` / `storageKey` values:
| Section | title | storageKey |
|---------|-------|-----------|
| Audio Treatment | `Audio treatment` | `va.treatment` |
| Soundtrack Library | `Soundtrack library` | `va.soundtrack` |
| Recent Audio | `Recent audio` | `va.recent` |
| Voice Clone | `Voice clone` | `va.clone` |
| Voice Presets | `Voice presets` | `va.presets` |
| Record / Upload | (leave for Task 4 — folds into hero) | — |
| Current Audio | (keep as a small always-visible `<Card>` for now; the sticky player covers "current") | — |

Note: leave **TTS (voice generation)** (~1037) as-is for now — Task 4 turns it into the hero. Leave **Record / Upload** as-is for now — Task 4 moves it inline into the hero.

- [ ] **Step 3: Type-check**

Run: `npx tsc -b`
Expected: exit 0. (`activeTab`/`setActiveTab` may now warn as unused for the converted sections — that's fine; the tab bar and state are removed in Task 5.)

- [ ] **Step 4: Verify in the running app**

Open `/app/voice-audio`. The converted sections now appear as collapsed rows; clicking a row expands it and the controls inside still work (generate a preset, run a treatment, use a recent clip). Reload the page — a section left open stays open.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/VoiceAudioPage.tsx
git commit -m "refactor(voice-audio): secondary sections become collapsible reveal panels"
```

---

### Task 4: `CreateVoiceHero` — hero with inline record/upload

**Files:**
- Create: `client/src/components/voice-audio/CreateVoiceHero.tsx`
- Test: `client/src/components/voice-audio/CreateVoiceHero.test.tsx`
- Modify: `client/src/pages/VoiceAudioPage.tsx` (replace the TTS `<Card title="1. TTS (voice generation)">` block ~1037 and fold the Record/Upload block ~1615 in as an inline expander)

**Interfaces:**
- Consumes: page state/handlers passed as props (no logic moves — the page still owns state):
  ```ts
  interface CreateVoiceHeroProps {
    // text
    ttsText: string;
    onTtsTextChange: (v: string) => void;
    onUseLatestScript: () => void;
    onFormatForVoice: () => void;
    onInsertTemplate: () => void;
    // provider + settings (rendered by the page and passed as nodes to avoid
    // threading ~15 props; keeps this component presentational)
    providerControls: React.ReactNode;   // provider chips + voice id/stability/similarity + Generate
    // record/upload
    recordUploadPanel: React.ReactNode;   // the existing Record/Upload controls
  }
  export function CreateVoiceHero(props: CreateVoiceHeroProps): JSX.Element;
  ```
  Rationale: passing `providerControls` and `recordUploadPanel` as nodes (composed by the page from existing JSX) preserves all behaviour with zero prop-threading risk, while giving the hero control of layout, hierarchy, and the "or record / upload" inline expander.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/components/voice-audio/CreateVoiceHero.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateVoiceHero } from './CreateVoiceHero';

const base = {
  ttsText: 'hello',
  onTtsTextChange: vi.fn(),
  onUseLatestScript: vi.fn(),
  onFormatForVoice: vi.fn(),
  onInsertTemplate: vi.fn(),
  providerControls: <div>PROVIDER_CONTROLS</div>,
  recordUploadPanel: <div>RECORD_PANEL</div>,
};

describe('CreateVoiceHero', () => {
  it('shows the text, helpers and provider controls; hides record/upload until expanded', async () => {
    const user = userEvent.setup();
    render(<CreateVoiceHero {...base} />);
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
    expect(screen.getByText('PROVIDER_CONTROLS')).toBeInTheDocument();
    expect(screen.queryByText('RECORD_PANEL')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /record .*upload/i }));
    expect(screen.getByText('RECORD_PANEL')).toBeInTheDocument();
  });

  it('fires the text helpers', async () => {
    const user = userEvent.setup();
    render(<CreateVoiceHero {...base} />);
    await user.click(screen.getByRole('button', { name: /use latest script/i }));
    expect(base.onUseLatestScript).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- CreateVoiceHero`
Expected: FAIL — cannot resolve `./CreateVoiceHero`.

- [ ] **Step 3: Implement `CreateVoiceHero`**

```tsx
// client/src/components/voice-audio/CreateVoiceHero.tsx
import { useState, type ReactNode } from 'react';
import { Wand2, Clipboard, Mic } from 'lucide-react';
import { Textarea } from '../ui/Textarea';
import { Button } from '../ui/Button';

interface CreateVoiceHeroProps {
  ttsText: string;
  onTtsTextChange: (v: string) => void;
  onUseLatestScript: () => void;
  onFormatForVoice: () => void;
  onInsertTemplate: () => void;
  providerControls: ReactNode;
  recordUploadPanel: ReactNode;
}

export function CreateVoiceHero({
  ttsText, onTtsTextChange, onUseLatestScript, onFormatForVoice, onInsertTemplate,
  providerControls, recordUploadPanel,
}: CreateVoiceHeroProps) {
  const [showRecord, setShowRecord] = useState(false);
  return (
    <section className="rounded-bf border border-[rgba(216,184,120,0.28)] bg-bf-card p-4 sm:p-5">
      <h2 className="font-serif text-xl text-bf-cream">Create a voice</h2>
      <p className="text-help mt-0.5">Paste a hook, verse, reflection or prayer — then generate, or record your own.</p>

      <div className="mt-4">
        <Textarea
          value={ttsText}
          onChange={(e) => onTtsTextChange(e.target.value)}
          placeholder="Paste hook + verse + reflection"
          className="min-h-[160px]"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button onClick={onUseLatestScript} variant="secondary" className="text-xs h-8"><Wand2 size={14} className="mr-2" />Use Latest Script</Button>
          <Button onClick={onFormatForVoice} variant="secondary" className="text-xs h-8">Format for Voice</Button>
          <Button onClick={onInsertTemplate} variant="secondary" className="text-xs h-8"><Clipboard size={14} className="mr-2" />Insert Template</Button>
        </div>
      </div>

      <div className="mt-4">{providerControls}</div>

      <button
        type="button"
        onClick={() => setShowRecord((v) => !v)}
        className="mt-4 inline-flex items-center gap-1.5 text-xs text-bf-goldDeep hover:text-bf-gold"
        aria-expanded={showRecord}
      >
        <Mic size={13} /> or record / upload
      </button>
      {showRecord && <div className="mt-3">{recordUploadPanel}</div>}
    </section>
  );
}
```

Note: confirm the import paths/casing for `Textarea` and `Button` match the existing files in `client/src/components/ui/` (adjust if the project uses different names).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- CreateVoiceHero`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the hero into the page**

In `VoiceAudioPage.tsx`:
1. Import: `import { CreateVoiceHero } from '../components/voice-audio/CreateVoiceHero';`
2. Extract the current TTS text `<Field>` children helpers into the three handler props (`handleUseLatestScript`, the inline Format-for-Voice closure → wrap as `handleFormatForVoice`, `handleInsertTemplate`).
3. Move the **provider chips + Voice ID + Stability + Similarity + Load/Generate** JSX (currently inside the TTS Card, roughly the remainder of the `1037` block after the text `<Field>`) into a local `const providerControls = (<> … </>);` just before the return, referencing the same state/handlers unchanged.
4. Move the existing **Record / Upload** section children (~1615 block, inner content only) into `const recordUploadPanel = (<> … </>);`.
5. Replace the TTS `<Card>` block and the standalone Record/Upload block with:
   ```tsx
   <CreateVoiceHero
       ttsText={ttsText}
       onTtsTextChange={setTtsText}
       onUseLatestScript={handleUseLatestScript}
       onFormatForVoice={handleFormatForVoice}
       onInsertTemplate={handleInsertTemplate}
       providerControls={providerControls}
       recordUploadPanel={recordUploadPanel}
   />
   ```
   Add `const handleFormatForVoice = () => { const next = cleanSpeakableText(ttsText); setTtsText(next); toast.success('Formatted for voice'); };` near the other handlers (mirrors the current inline onClick at ~1055).

- [ ] **Step 6: Type-check and verify in app**

Run: `npx tsc -b` → exit 0.
Open `/app/voice-audio`: the hero is the first card; text + helpers + provider chips + Generate all work; "or record / upload" expands the recorder inline and recording/upload still function.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/voice-audio/CreateVoiceHero.tsx client/src/components/voice-audio/CreateVoiceHero.test.tsx client/src/pages/VoiceAudioPage.tsx
git commit -m "feat(voice-audio): create-first hero with inline record/upload"
```

---

### Task 5: Remove the tab bar + two-pane desktop layout (Recent-audio rail)

**Files:**
- Modify: `client/src/pages/VoiceAudioPage.tsx` (tab row ~1013–1030; `activeTab` state ~191; page container ~1012; Recent-audio placement)

**Interfaces:**
- Consumes: `RevealSection` (Task 1), `CreateVoiceHero` (Task 4), sticky player (Task 2).
- Produces: final assembled layout. No new exports.

- [ ] **Step 1: Delete the tab bar and `activeTab` state**

- Remove the tab-button row block (lines ~1013–1030).
- Remove `const [activeTab, setActiveTab] = useState<…>('all');` (~191) and any remaining `activeTab` references (all section gates were removed in Tasks 3–4).

- [ ] **Step 2: Two-pane grid on desktop**

Wrap the post-hero content so Recent audio becomes a right rail at `lg`. Structure the content region as:
```tsx
<div className="space-y-6">
    {/* sticky player (Task 2) stays here, full width, above the grid */}
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
        <div className="space-y-4 min-w-0">
            {/* CreateVoiceHero */}
            {/* RevealSection: Audio treatment */}
            {/* RevealSection: Soundtrack library */}
            {/* RevealSection: Voice clone */}
            {/* RevealSection: Voice presets */}
            {/* (Compare voices / Caption animation reveal sections if present) */}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            {/* RevealSection: Recent audio (defaultOpen on desktop) */}
        </aside>
    </div>
</div>
```
Move the **Recent audio** `RevealSection` into the `<aside>`. Keep all other reveal sections in the left column. On mobile (`grid-cols-1`) the aside stacks naturally below the left column, preserving the single-column order.

- [ ] **Step 3: Type-check**

Run: `npx tsc -b`
Expected: exit 0, no unused-`activeTab` warnings.

- [ ] **Step 4: Full behaviour + layout verification in the running app**

Mobile viewport (430px): single column — sticky player, hero, then collapsed reveal sections; footer nav unobstructed. Desktop (≥1024px): hero + reveal sections on the left, Recent-audio rail on the right (sticky), player spanning the top. Exercise each feature end-to-end: generate (each available provider), clone, apply a preset, run an audio treatment, add a soundtrack, record + upload, click "Use" on a recent clip → it becomes current audio and the sticky player updates. Confirm the palette is unchanged.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/VoiceAudioPage.tsx
git commit -m "feat(voice-audio): drop tab bar; two-pane desktop with recent-audio rail"
```

---

## Self-Review

**Spec coverage:**
- Create-first hero → Task 4. Sticky player → Task 2. Reveal sections + remembered state → Tasks 1 & 3. Tab bar removed → Task 5. Record/upload inline in hero → Task 4. Two-pane desktop + Recent-audio rail → Task 5. Component decomposition (`RevealSection`, `CreateVoiceHero`, sticky player, recent-audio rail-via-grid) → Tasks 1,2,4,5. Behaviour preserved → children moved verbatim; page keeps state; verified per task. Palette/landing untouched → Global Constraints + no colour edits. ✓ All spec items mapped.
- Note: the spec named `StickyAudioPlayer` and `RecentAudioRail` as components. This plan achieves both via a sticky wrapper around the existing `VoicePlayer` (Task 2) and a grid `<aside>` hosting the Recent-audio `RevealSection` (Task 5) — same UX, less churn, matching the codebase's preference for not over-fragmenting. If a dedicated `RecentAudioRail` component is later warranted, it can wrap the same children.

**Placeholder scan:** No TBD/TODO. JSX-move steps reference exact source blocks by title + approximate line and say "children unchanged"; new components have complete code.

**Type consistency:** `RevealSection` props (`title`, `storageKey`, `defaultOpen`, `icon`, `hint`) consistent across Tasks 1/3/5. `CreateVoiceHero` prop names consistent between Task 4 definition, test, and page wiring. `storageKey` prefix `bf.reveal.` consistent between component and test.

**Risk notes for the implementer:** This is a refactor of a 2,127-line file — after each task, `npx tsc -b` must be clean and the app must still run. Move JSX children verbatim; do not "improve" logic. If a section's children reference a handler defined below the return, keep the handler where it is (only JSX moves).
