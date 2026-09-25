import type { AmbientPublished, AmbientStatus } from './ambientTypes';
import { relativeTime, type StatusTone } from './storyWizard';

/** Pill label + tone for an ambient session, in the words the page uses. */
const STATUS_META: Record<AmbientStatus, { label: string; tone: StatusTone }> = {
  draft: { label: 'Draft', tone: 'idle' },
  voicing: { label: 'Voicing verses', tone: 'busy' },
  assembling: { label: 'Building music', tone: 'busy' },
  generating_images: { label: 'Making pictures', tone: 'busy' },
  ready_to_render: { label: 'Ready to render', tone: 'idle' },
  rendering: { label: 'Rendering', tone: 'busy' },
  done: { label: 'Finished', tone: 'done' },
  error: { label: 'Needs attention', tone: 'error' },
};

export function ambientStatusMeta(status: AmbientStatus): { label: string; tone: StatusTone } {
  return STATUS_META[status] ?? { label: String(status || 'Draft'), tone: 'idle' };
}

const PRIVACY_LABEL: Record<AmbientPublished['privacyStatus'], string> = {
  private: 'Private',
  unlisted: 'Unlisted',
  public: 'Public',
};

/**
 * e.g. "Private · 2d ago", or "Scheduled for 1 Oct" while a scheduled upload
 * is still waiting to go public.
 */
export function publishedLabel(entry: AmbientPublished, nowMs: number): string {
  const at = entry.publishAt ? Date.parse(entry.publishAt) : NaN;
  if (Number.isFinite(at) && at > nowMs) {
    const when = new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `Scheduled for ${when}`;
  }
  return `${PRIVACY_LABEL[entry.privacyStatus] ?? 'Private'} · ${relativeTime(entry.at, nowMs)}`;
}
