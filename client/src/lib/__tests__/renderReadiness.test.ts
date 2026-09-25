import { describe, it, expect } from 'vitest';
import { checkRenderReadiness, type RenderInputs } from '../renderReadiness';

function inputs(over: Partial<RenderInputs> = {}): RenderInputs {
  return {
    mode: 'video',
    lines: 'For God so loved the world',
    audioPath: '',
    backgroundPath: '',
    backgroundItemCount: 1,
    autoBackground: false,
    ...over,
  };
}

describe('checkRenderReadiness', () => {
  it('is ready when a background and lines are present', () => {
    const r = checkRenderReadiness(inputs({ backgroundPath: '/bg/a.jpg' }));
    expect(r.ready).toBe(true);
    expect(r.blockers).toHaveLength(0);
  });

  describe('background', () => {
    it('blocks with no background and no auto', () => {
      const r = checkRenderReadiness(inputs({ backgroundItemCount: 0 }));
      expect(r.ready).toBe(false);
      expect(r.blockers.some((b) => b.field === 'background')).toBe(true);
    });

    it('auto satisfies it for VIDEO mode', () => {
      const r = checkRenderReadiness(inputs({ backgroundItemCount: 0, autoBackground: true }));
      expect(r.blockers.some((b) => b.field === 'background')).toBe(false);
    });

    it('auto does NOT satisfy it for waveform mode', () => {
      // Waveform still needs an explicit background - matching the existing rule.
      const r = checkRenderReadiness(inputs({
        mode: 'waveform', backgroundItemCount: 0, autoBackground: true, audioPath: '/a.mp3',
      }));
      expect(r.blockers.some((b) => b.field === 'background')).toBe(true);
    });

    it('multiple selected backgrounds satisfy it', () => {
      const r = checkRenderReadiness(inputs({ backgroundItemCount: 3 }));
      expect(r.blockers.some((b) => b.field === 'background')).toBe(false);
    });
  });

  describe('caption lines', () => {
    it('blocks when there are none', () => {
      const r = checkRenderReadiness(inputs({ lines: '   \n  ', backgroundPath: '/b.jpg' }));
      expect(r.blockers.some((b) => b.field === 'lines')).toBe(true);
    });

    it('counts only non-empty lines', () => {
      const r = checkRenderReadiness(inputs({ lines: '\n\nOne\n\n', backgroundPath: '/b.jpg' }));
      expect(r.ready).toBe(true);
      expect(r.lineCount).toBe(1);
    });

    it('reports the count against the cap so the UI can show it', () => {
      const r = checkRenderReadiness(inputs({
        lines: 'a\nb\nc\nd\ne\nf\ng\nh', backgroundPath: '/b.jpg',
      }));
      expect(r.lineCount).toBe(8);
      expect(r.maxLines).toBe(6);
      // Over the cap is a WARNING, not a blocker: the renderer slices to 6.
      expect(r.ready).toBe(true);
      expect(r.warnings.some((w) => w.field === 'lines')).toBe(true);
    });
  });

  describe('waveform mode', () => {
    it('needs an audio path', () => {
      const r = checkRenderReadiness(inputs({ mode: 'waveform', backgroundPath: '/b.jpg' }));
      expect(r.blockers.some((b) => b.field === 'audioPath')).toBe(true);
    });

    it('accepts one background', () => {
      const r = checkRenderReadiness(inputs({
        mode: 'waveform', audioPath: '/a.mp3', backgroundPath: '/b.jpg', backgroundItemCount: 1,
      }));
      expect(r.ready).toBe(true);
    });

    it('refuses more than one background', () => {
      const r = checkRenderReadiness(inputs({
        mode: 'waveform', audioPath: '/a.mp3', backgroundPath: '/b.jpg', backgroundItemCount: 2,
      }));
      expect(r.blockers.some((b) => b.field === 'background')).toBe(true);
    });

    it('video mode does not need an audio path', () => {
      const r = checkRenderReadiness(inputs({ backgroundPath: '/b.jpg', audioPath: '' }));
      expect(r.blockers.some((b) => b.field === 'audioPath')).toBe(false);
    });
  });

  describe('messages', () => {
    it('every blocker names the field and says what to do', () => {
      const r = checkRenderReadiness(inputs({ backgroundItemCount: 0, lines: '' }));
      expect(r.blockers.length).toBeGreaterThan(1);
      for (const b of r.blockers) {
        expect(b.field).toBeTruthy();
        expect(b.message.length).toBeGreaterThan(10);
      }
    });

    it('reports EVERY blocker, not just the first', () => {
      // The old code returned on the first failure, so fixing one revealed the
      // next. All of them are known up front; show all of them.
      const r = checkRenderReadiness(inputs({
        mode: 'waveform', backgroundItemCount: 0, lines: '', audioPath: '',
      }));
      const fields = r.blockers.map((b) => b.field);
      expect(fields).toContain('background');
      expect(fields).toContain('lines');
      expect(fields).toContain('audioPath');
    });
  });
});
