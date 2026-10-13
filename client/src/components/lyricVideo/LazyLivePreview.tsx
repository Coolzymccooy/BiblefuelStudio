import { Suspense, lazy } from 'react';
import type { LyricProject } from '../../lib/lyricVideoTypes';

interface Props { project: LyricProject; assVersion: number; onTime?: (t: number) => void }

/** The same box the live preview draws in, so the page does not jump when it arrives. */
const BOX_CLS = 'mx-auto flex w-full max-w-[360px] items-center justify-center rounded-xl bg-[#101820] px-4 text-center text-sm text-bf-sub';
const BOX_STYLE = { aspectRatio: '360 / 640' } as const;

function PreviewUnavailable() {
  return (
    <div className={BOX_CLS} style={BOX_STYLE} role="status">
      The preview could not load. You can still time your lyrics and make the video.
    </div>
  );
}

/**
 * The live preview pulls in the caption renderer (a large script and a worker), so it is
 * fetched on its own the first time a step needs it. This is the ONLY place it is imported
 * from, and only through import(): a static import anywhere would put it back in the main bundle.
 */
const LivePreview = lazy(() =>
  import('./LivePreview')
    .then((m) => ({ default: m.LivePreview }))
    // A failed download (offline, a stale tab after an update) should not blank the page.
    .catch(() => ({ default: PreviewUnavailable })),
);

/** The live preview, loaded on demand, labelled as the tall frame it always draws. */
export function LazyLivePreview(props: Props) {
  return (
    <figure className="space-y-1.5">
      <Suspense
        fallback={(
          <div className={BOX_CLS} style={BOX_STYLE} role="status">Loading preview…</div>
        )}
      >
        <LivePreview {...props} />
      </Suspense>
      <figcaption className="text-center text-xs text-content-tertiary">Preview (tall frame)</figcaption>
    </figure>
  );
}
