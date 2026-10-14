# JASSUB spike — 2026-10-13

**Decision: JASSUB_OK = yes** (one licence item to rule on, see "Licence").

- Version: jassub 1.8.8, pinned exactly in `client/package.json`.
- Method: a throwaway standalone page (separate Vite entry, not behind sign-in, not committed) served by the Vite dev server, driven headlessly with Playwright (Chromium). Test video: 720x1280 H.264, 180 s. Fonts copied from `server/assets/fonts`.

## Imports that work in this Vite app

The brief's guesses were right; the files exist under `client/node_modules/jassub/dist/`.

```ts
import JASSUB from 'jassub';
import workerUrl from 'jassub/dist/jassub-worker.js?url';
import wasmUrl from 'jassub/dist/jassub-worker.wasm?url';

const r = new JASSUB({
  video,                       // the <video> element; JASSUB overlays its own <canvas>
  subContent: assText,
  workerUrl,
  wasmUrl,
  availableFonts: {            // keys are the font family lower-cased
    'permanent marker': '/caption-fonts/PermanentMarker.ttf',
    caveat: '/caption-fonts/Caveat-Bold.ttf',
    'dejavu sans': '/caption-fonts/DejaVuSans.ttf',
    knewave: '/caption-fonts/Knewave-Regular.ttf',
  },
  fallbackFont: 'dejavu sans',
});
r.setTrack(newAssText);        // swaps captions in place
r.destroy();
```

- Dev: `workerUrl` resolves to `/node_modules/jassub/dist/jassub-worker.js`, `wasmUrl` to `.../jassub-worker.wasm`.
- Production build emits `assets/jassub-worker-<hash>.js` (31 kB) and `assets/jassub-worker-<hash>.wasm` (1.97 MB, 836 kB gzip), plus the wrapper in the page chunk (about 17 kB, 6 kB gzip). The wasm is large: load JASSUB lazily (dynamic `import()`), only when the timing step opens.
- The real engine's fonts are DejaVu Sans, Knewave and Permanent Marker (from `buildAss` output), so the font map needs all three, plus Caveat if used. `availableFonts` is fetched lazily by the worker, only for fonts a track actually uses.
- Fonts are fetched by the worker with `fetch`, so they must be same-origin or CORS-enabled. The `/caption-fonts` static route lands in Task 11.
- ASS tags must reach JASSUB with single backslashes. In a TS template literal, use `String.raw` (or `\\`) — a plain `\a` or `\p` would be mangled. Note for Task 14.

## Checks

1. **Draws over the video: PASS.** At 1 s "MY TIME" is drawn in Permanent Marker at the `\pos` (screenshot-confirmed). At 3 s the Yoruba line is drawn in Caveat with its marks: Ọ, ọ, ú, and the dot under ẹ. Real engine output (`studio-lagos-night`, `wild`) also renders correctly at 63.6 s (white lines, gold emphasised word with underline stroke, Permanent Marker). One quirk: the acute on the final ẹ́ is drawn detached, to the right of the letter, rather than stacked above the dot. That is libass shaping with Caveat's glyph set. The burned-in video uses the same libass, so preview and render will match (WYSIWYG), but if the Yoruba line matters, pick a font with proper mark stacking or use precomposed characters.
2. **CSP: PASS on reading; live check deferred to Task 16.** The Vite dev server does not apply the app's CSP, and the dev console was clean (only a favicon 404). From `server/index.js` (helmet):
   - `scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"]` — `'unsafe-eval'` covers WebAssembly compilation (JASSUB's wasm).
   - `workerSrc: ["'self'", "blob:"]` — the worker is a same-origin `/assets/jassub-worker-*.js`; blob: is also allowed.
   - `connectSrc: ["'self'", "https:"]` — the worker's `fetch` of the wasm and the font files is same-origin.
   - `defaultSrc: ["'self'"]` as the fallback.
   Nothing JASSUB needs is blocked, assuming the worker script response carries the same helmet header (it does when served by the same Express app).
3. **`setTrack` swaps without reload: PASS.** With a marker on `window` (same page load) and `setTrack(other ASS)` plus a seek to 2.5 s, the screenshot showed "SECOND TRACK" in place of "MY TIME"; the page was not reloaded.
4. **200-event ASS stays smooth: PASS.** Generated with `buildAss` from `my-time-no-late/expected-lines.json` (352 words) at 720x1280, `studio-lagos-night`, `wild`: **327 Dialogue events**, 173.5 s. Loaded with `setTrack`, played at 1x for 5 s from 60 s (dense lyrics), headless Chromium on the dev laptop:
   | | rAF frames | avg frame | p95 | p99 | max | >33 ms | dropped video frames |
   |---|---|---|---|---|---|---|---|
   | no throttle | 299 | 16.71 ms | 16.9 | 17.3 | 17.4 | 0 | 0 / 150 |
   | CPU 4x (CDP `Emulation.setCPUThrottlingRate`) | 300 | 16.71 ms | 16.8 | 17.5 | 17.6 | 0 | 0 / 150 |
   The throttle was confirmed active (a 30M-iteration loop went 31 ms to 237 ms). Caveat: CDP throttling slows the page main thread; whether it also slows the JASSUB worker is not established, and this is a headless desktop Chromium, not a real phone. It is a reasonable proxy, not proof for low-end Android. Re-check on a real phone in Task 16.
5. **Production build bundles the worker and wasm: PASS.** `vite build` with a temporary config whose only input was the spike page emitted the worker `.js` and `.wasm` as assets (sizes above). Serving that build (`vite preview`) and seeking to 3 s drew both captions, so the built assets work, not just the dev server. The normal `npm run build` in `client/` (built to a temp outDir so the committed `server/public` bundle was not touched) still succeeds after adding the dependency.

## Licence

- libass itself is ISC. The LGPL part of the wasm is **fribidi** (LGPL-2.1+); the wasm also contains FreeType (FTL), harfbuzz, fontconfig, expat and brotli. It ships unmodified as a separate wasm asset, loaded by a worker (dynamic use), which LGPL permits. JASSUB's own `package.json` licence is `LGPL-2.1-or-later AND (FTL OR GPL-2.0-or-later) AND MIT AND ...`. (Corrected 2026-10-13: an earlier draft said libass was LGPL-2.1.)
- The notices travel with the app as `client/public/third-party-notices.txt` (made by `client/scripts/third-party-notices.mjs` from `node_modules/jassub/dist/COPYRIGHT`, plus the FreeType credit line), linked from the Lyric video page as "Open-source credits".
- **Decision needed: `rvfc-polyfill` (a hard dependency of jassub, added to the lockfile as 1.0.8) is `GPL-3.0`.** `jassub/src/jassub.js` starts with `import 'rvfc-polyfill'`, so it is bundled into the client JS. It only polyfills `requestVideoFrameCallback` for browsers that lack it. If the client bundle is shipped as proprietary, GPL-3.0 code inside it is a problem. Options for the operator: (a) accept it, (b) alias `rvfc-polyfill` to an empty stub in `vite.config.ts` (`resolve.alias`) since the target browsers (current Chrome, Safari 15.4+, Firefox 132+) all support `requestVideoFrameCallback`, or (c) not use JASSUB. Not done here; flagged for a ruling before Task 14 ships.
