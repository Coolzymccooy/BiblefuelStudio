import { describe, it, expect } from 'vitest';
import { IMPORT_LICENCES, planImport, trackLabelFromFilename } from '../musicImport';

const file = (name: string) => new File(['x'], name, { type: 'audio/mpeg' });

describe('trackLabelFromFilename', () => {
  it('reads "Title - Artist.mp3" as a tidy label', () => {
    expect(trackLabelFromFilename('Pastoral - Asher Fulero.mp3')).toBe('Pastoral — Asher Fulero');
  });

  it('keeps a plain name, and only the last extension goes', () => {
    expect(trackLabelFromFilename('calm bed.v2.m4a')).toBe('calm bed.v2');
    expect(trackLabelFromFilename('  Somnia I  .mp3')).toBe('Somnia I');
  });
});

describe('planImport', () => {
  it('adds what is new and skips what the library already has, by label', () => {
    const plan = planImport(
      [file('Pastoral - Asher Fulero.mp3'), file('Night Snow - Asher Fulero.mp3')],
      [{ label: 'Pastoral — Asher Fulero' }],
    );
    expect(plan.toAdd.map((a) => a.label)).toEqual(['Night Snow — Asher Fulero']);
    expect(plan.skipped).toEqual(['Pastoral — Asher Fulero']);
  });

  it('the same file picked twice is added once', () => {
    const plan = planImport([file('A - B.mp3'), file('A - B.mp3')], []);
    expect(plan.toAdd).toHaveLength(1);
    expect(plan.skipped).toEqual(['A — B']);
  });

  it('matching ignores case and spacing, so a re-run after a failure never duplicates', () => {
    const plan = planImport([file('pastoral -  asher fulero.mp3')], [{ label: 'Pastoral — Asher Fulero' }]);
    expect(plan.toAdd).toHaveLength(0);
  });
});

describe('IMPORT_LICENCES', () => {
  it('offers the YouTube Audio Library as cleared, and "not recorded" stays the server default', () => {
    const yt = IMPORT_LICENCES.find((l) => /youtube audio library/i.test(l.label));
    expect(yt?.value).toBe('youtube-audio-library');
    expect(IMPORT_LICENCES.find((l) => l.value === 'unknown')).toBeTruthy();
  });
});
