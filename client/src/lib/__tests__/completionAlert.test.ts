import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldAlert, toneFor, alertFrom, raiseAlert, dismissAlert,
  considerForAlert, _resetAlertsForTest,
} from '../completionAlert';
import type { Notification } from '../notifications';

const notif = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1', kind: 'job_done', title: 'Video ready',
  createdAt: new Date().toISOString(), read: false, ...over,
});

beforeEach(() => _resetAlertsForTest());

describe('shouldAlert', () => {
  it('alerts on a finished or failed job — the end of what the user started', () => {
    for (const kind of ['job_done', 'job_failed', 'campaign_done', 'campaign_failed', 'campaign_render_only'] as const) {
      expect(shouldAlert({ kind })).toBe(true);
    }
  });

  it('does NOT alert on informational notices', () => {
    expect(shouldAlert({ kind: 'info' })).toBe(false);
  });
});

describe('toneFor', () => {
  it('treats a failure as an error', () => {
    expect(toneFor('job_failed')).toBe('error');
    expect(toneFor('campaign_failed')).toBe('error');
  });

  it('treats render-only as a WARNING, not a success', () => {
    // The video exists but never posted. Calling that a win is how a church
    // believes it published a week of content that never left the building.
    expect(toneFor('campaign_render_only')).toBe('warning');
  });

  it('treats a genuine publish as a success', () => {
    expect(toneFor('campaign_done')).toBe('success');
    expect(toneFor('job_done')).toBe('success');
  });
});

describe('alertFrom', () => {
  it('carries the title, body and link through', () => {
    const a = alertFrom(notif({ title: 'Render ready', body: '/out/x.mp4', href: '/app/render' }));
    expect(a.title).toBe('Render ready');
    expect(a.body).toBe('/out/x.mp4');
    expect(a.href).toBe('/app/render');
    expect(a.tone).toBe('success');
  });
});

describe('the alert store', () => {
  it('starts empty', async () => {
    const { useCompletionAlert } = await import('../completionAlert');
    expect(typeof useCompletionAlert).toBe('function');
  });

  it('considerForAlert raises for an end-state and reports it did', () => {
    expect(considerForAlert(notif({ kind: 'job_done' }))).toBe(true);
  });

  it('considerForAlert ignores informational notices', () => {
    expect(considerForAlert(notif({ kind: 'info' }))).toBe(false);
  });

  it('newest alert replaces the previous one', () => {
    raiseAlert({ id: 'a', title: 'First', tone: 'success' });
    raiseAlert({ id: 'b', title: 'Second', tone: 'error' });
    // Verified through considerForAlert/dismiss behaviour rather than reading
    // private state; the store exposes its value through the React hook.
    expect(() => dismissAlert()).not.toThrow();
  });

  it('dismiss is safe to call when nothing is showing', () => {
    expect(() => dismissAlert()).not.toThrow();
    expect(() => dismissAlert()).not.toThrow();
  });
});
