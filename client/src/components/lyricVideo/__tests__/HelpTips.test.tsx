import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
vi.mock('../../../lib/lyricVideoApi', () => ({
  lyricVideoApi: { setSheet: vi.fn(), align: vi.fn(), patchLine: vi.fn(), setLook: vi.fn(), setBackground: vi.fn(), uploadBackground: vi.fn(), effects: vi.fn() },
}));
vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }), mediaUrl: (f: string) => `/outputs/${f}` },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../LivePreview', () => ({ LivePreview: () => <div data-testid="lyric-preview" /> }));
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { LyricsStep } from '../LyricsStep';
import { TimingStep } from '../TimingStep';
import { LookStep } from '../LookStep';
import { LineEffects } from '../LineEffects';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const line = (id: string, start: number, flag: 'check' | null = null) =>
  ({ id, sectionId: 's1', kind: 'lead', text: `line ${id}`, effect: 'auto', start, end: start + 1, flag, words: [{ text: 'x', start, end: start + 1 }] });
const timed = {
  projectId: 'lv_1', song: { file: 'x', durationSec: 30, coverStill: null }, sheet: { raw: 'x', parsedAt: 't' },
  sections: [{ id: 's1', kind: 'verse', label: 'VERSE 1' }],
  lines: [line('l1', 1), line('l2', 5, 'check'), line('l3', 9, 'check')],
  timing: { status: 'done' }, look: { id: 'studio-lagos-night', energy: 'lively', seed: 1 }, background: null,
} as unknown as LyricProject;

/** Opens the tip by its accessible name and returns the text it shows. */
function openTip(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
  return screen.getByRole('tooltip').textContent;
}

describe('lyric video help tips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lyricVideoApi.effects).mockResolvedValue({});
  });

  it('Lyrics step explains sections and crowd replies', () => {
    render(<LyricsStep project={timed} onChange={vi.fn()} />);
    expect(openTip('About sections and crowd replies')).toBe(
      'Put section names in square brackets: [VERSE 1], [CHORUS], [BRIDGE]. Put a crowd reply in round brackets at the end of the line it answers, for example: If I only have a seed... (PLANT IT!). Bridge lines appear in a handwritten style.',
    );
  });

  it('keeps the lyrics box labelled "Lyrics"', () => {
    render(<LyricsStep project={timed} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Lyrics' })).toBeTruthy();
  });

  it('Timing step explains checking lines once, even with several lines flagged', async () => {
    render(<TimingStep project={timed} onChange={vi.fn()} />);
    expect(screen.getAllByText('Check this line')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'About checking lines' })).toHaveLength(1);
    expect(openTip('About checking lines')).toBe(
      "We couldn't hear this line clearly. Press Play from here to listen. Press Start here when the line begins, or nudge it earlier or later.",
    );
    expect(await screen.findByTestId('lyric-preview')).toBeTruthy();
  });

  it('Look step explains energy', async () => {
    render(<LookStep project={timed} onChange={vi.fn()} />);
    expect(openTip('About energy')).toBe('Calm keeps it gentle. Lively adds some big moments. Wild uses every effect.');
    expect(await screen.findByTestId('lyric-preview')).toBeTruthy();
  });

  it('keeps the energy select labelled "Energy"', async () => {
    render(<LookStep project={timed} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Energy' })).toBeTruthy();
    expect(await screen.findByTestId('lyric-preview')).toBeTruthy();
  });

  it('Look step explains line effects, beside the heading', async () => {
    render(<LookStep project={timed} onChange={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Effect for each line' })).toBeTruthy();
    expect(openTip('About line effects')).toBe(
      "Auto picks an effect to suit the song's sections. Choose one to fix it. Echo is made for crowd replies.",
    );
    expect(await screen.findByTestId('lyric-preview')).toBeTruthy();
  });

  it('Line effects tip is part of the effects list on its own', async () => {
    render(<LineEffects project={timed} save={async (w) => w()} onPreviewChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'About line effects' })).toBeTruthy();
    await screen.findAllByRole('combobox');
  });
});
