import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
vi.mock('../../../lib/lyricVideoApi', () => ({
  lyricVideoApi: { setLook: vi.fn(), setBackground: vi.fn(), uploadBackground: vi.fn(), patchLine: vi.fn(), effects: vi.fn() },
}));
vi.mock('../../../lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      ok: true, status: 200,
      data: {
        studioLooks: [{ id: 'studio-lagos-night', label: 'Lagos Night' }, { id: 'studio-gold-rush', label: 'Gold Rush' }],
        energies: [{ id: 'calm', label: 'Calm' }, { id: 'lively', label: 'Lively' }, { id: 'wild', label: 'Wild' }],
        libass: true,
      },
    }),
    mediaUrl: (f: string) => `/outputs/${f}`,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../LivePreview', () => ({
  LivePreview: ({ assVersion }: { assVersion: number }) => <div data-testid="lyric-preview" data-ass-version={assVersion} />,
}));
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { LookStep } from '../LookStep';
import { nextSeed } from '../ShuffleButton';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const project = {
  projectId: 'lv_1', song: { file: 'x', durationSec: 30, coverStill: 'cover.jpg' }, lines: [], timing: { status: 'done' },
  look: { id: 'studio-lagos-night', energy: 'lively', seed: 1 }, background: null,
} as unknown as LyricProject;
const timed = {
  ...project,
  lines: [{ id: 'l1', sectionId: 's1', kind: 'lead', text: 'Who talk say', effect: 'auto', words: [{ text: 'Who', start: 1, end: 2 }], start: 1, end: 2 }],
} as unknown as LyricProject;
const withBg = { ...project, background: { file: '/o/bg.jpg', kind: 'image', fit: 'auto' } } as unknown as LyricProject;

describe('LookStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the looks and energies from the server', async () => {
    render(<LookStep project={project} onChange={vi.fn()} />);
    expect(await screen.findByRole('option', { name: 'Gold Rush' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Wild' })).toBeTruthy();
    expect((screen.getByLabelText(/^energy$/i) as HTMLSelectElement).value).toBe('lively');
    expect(await screen.findByTestId('lyric-preview')).toBeTruthy();
  });

  it('saves a new look and refreshes the preview', async () => {
    const next = { ...project, look: { ...project.look, id: 'studio-gold-rush' } } as LyricProject;
    vi.mocked(lyricVideoApi.setLook).mockResolvedValue(next);
    const onChange = vi.fn();
    render(<LookStep project={project} onChange={onChange} />);
    await screen.findByRole('option', { name: 'Gold Rush' });
    fireEvent.change(screen.getByLabelText(/^look/i), { target: { value: 'studio-gold-rush' } });
    await waitFor(() => expect(lyricVideoApi.setLook).toHaveBeenCalledWith('lv_1', { id: 'studio-gold-rush' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(next));
    await waitFor(() => expect(screen.getByTestId('lyric-preview').getAttribute('data-ass-version')).toBe('2'));
  });

  it('saves a new energy', async () => {
    vi.mocked(lyricVideoApi.setLook).mockResolvedValue(project);
    render(<LookStep project={project} onChange={vi.fn()} />);
    await screen.findByRole('option', { name: 'Wild' });
    fireEvent.change(screen.getByLabelText(/^energy$/i), { target: { value: 'wild' } });
    await waitFor(() => expect(lyricVideoApi.setLook).toHaveBeenCalledWith('lv_1', { energy: 'wild' }));
  });

  it('uploads a background picture or video', async () => {
    vi.mocked(lyricVideoApi.uploadBackground).mockResolvedValue(withBg);
    const onChange = vi.fn();
    const { container } = render(<LookStep project={project} onChange={onChange} />);
    const file = new File(['x'], 'bg.jpg', { type: 'image/jpeg' });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    await waitFor(() => expect(lyricVideoApi.uploadBackground).toHaveBeenCalledWith('lv_1', file, expect.any(Function)));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(withBg));
  });

  it("goes back to the song's picture, saying what happens when it has none (R45)", async () => {
    vi.mocked(lyricVideoApi.setBackground).mockResolvedValue(project);
    render(<LookStep project={withBg} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: "Use the song's picture (or a plain dark background if it has none)" }));
    await waitFor(() => expect(lyricVideoApi.setBackground).toHaveBeenCalledWith('lv_1', null));
  });

  it('says what sits behind the words when no background was chosen (R45)', () => {
    const { rerender } = render(<LookStep project={project} onChange={vi.fn()} />);
    expect(screen.getByText("Right now the song's picture sits behind the words.")).toBeTruthy();
    const noPicture = { ...project, song: { ...project.song, coverStill: null } } as unknown as LyricProject;
    rerender(<LookStep project={noPicture} onChange={vi.fn()} />);
    expect(screen.getByText('Right now a plain dark background sits behind the words.')).toBeTruthy();
    expect(screen.queryByText(/song's picture sits/)).toBeNull();
  });

  it('sets how the background fills the frame, only when there is a background', async () => {
    vi.mocked(lyricVideoApi.setBackground).mockResolvedValue(withBg);
    const { rerender } = render(<LookStep project={project} onChange={vi.fn()} />);
    expect((screen.getByLabelText(/fit/i) as HTMLSelectElement).disabled).toBe(true);
    rerender(<LookStep project={withBg} onChange={vi.fn()} />);
    const fit = screen.getByLabelText(/fit/i) as HTMLSelectElement;
    expect(fit.disabled).toBe(false);
    expect(screen.getByRole('option', { name: 'Fill the frame' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Show it whole' })).toBeTruthy();
    fireEvent.change(fit, { target: { value: 'contain' } });
    await waitFor(() => expect(lyricVideoApi.setBackground).toHaveBeenCalledWith('lv_1', '/o/bg.jpg', 'contain'));
  });

  it('shuffles the Auto effects and redraws the preview right away', async () => {
    const shuffled = { ...project, look: { ...project.look, seed: nextSeed(1) } } as LyricProject;
    vi.mocked(lyricVideoApi.setLook).mockResolvedValue(shuffled);
    const onChange = vi.fn();
    render(<LookStep project={project} onChange={onChange} />);
    expect(screen.getByText('Changes the effects on lines set to Auto. Your own choices stay.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /shuffle effects/i }));
    await waitFor(() => expect(lyricVideoApi.setLook).toHaveBeenCalledWith('lv_1', { seed: nextSeed(1) }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(shuffled));
    await waitFor(() => expect(screen.getByTestId('lyric-preview').getAttribute('data-ass-version')).toBe('2'));
  });

  it('chooses an effect for one line and redraws the preview right away', async () => {
    vi.mocked(lyricVideoApi.effects).mockResolvedValue({ l1: 'slam' });
    vi.mocked(lyricVideoApi.patchLine).mockResolvedValue(timed);
    render(<LookStep project={timed} onChange={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/Effect for “Who talk say”/), { target: { value: 'quote' } });
    await waitFor(() => expect(lyricVideoApi.patchLine).toHaveBeenCalledWith('lv_1', 'l1', { effect: 'quote' }));
    await waitFor(() => expect(screen.getByTestId('lyric-preview').getAttribute('data-ass-version')).toBe('2'));
  });

  it('has no line list before any line is timed', () => {
    render(<LookStep project={project} onChange={vi.fn()} />);
    expect(screen.queryByText('Effect for each line')).toBeNull();
  });
});

/** Two timed lines, and the step wired to its own project as the page does. */
const two = {
  ...project,
  lines: [
    { id: 'l1', sectionId: 's1', kind: 'lead', text: 'Who talk say', effect: 'auto', words: [{ text: 'Who', start: 1, end: 2 }], start: 1, end: 2 },
    { id: 'l2', sectionId: 's1', kind: 'lead', text: 'My time no late', effect: 'auto', words: [{ text: 'My', start: 84.2, end: 85 }], start: 84.2, end: 85 },
  ],
} as unknown as LyricProject;
const withEffect = (p: LyricProject, id: string, effect: string) =>
  ({ ...p, lines: p.lines.map((l) => (l.id === id ? { ...l, effect } : l)) }) as LyricProject;
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
function Live({ initial }: { initial: LyricProject }) {
  const [p, setP] = useState(initial);
  return <LookStep project={p} onChange={setP} />;
}
const selectFor = (text: RegExp) => screen.getByLabelText(text) as HTMLSelectElement;
const saving = () => document.querySelectorAll('[aria-busy="true"]').length;

describe('LookStep saves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lyricVideoApi.effects).mockResolvedValue({});
  });

  it('keeps keyboard focus on a line while its choice saves, and shows the row is saving', async () => {
    let release: () => void = () => undefined;
    vi.mocked(lyricVideoApi.patchLine).mockImplementation(() => new Promise((r) => { release = () => r(withEffect(two, 'l1', 'quote')); }));
    render(<Live initial={two} />);
    await screen.findByText('Effect for each line');
    const select = selectFor(/Who talk say/);
    select.focus();
    fireEvent.change(select, { target: { value: 'quote' } });
    await waitFor(() => expect(lyricVideoApi.patchLine).toHaveBeenCalledTimes(1));
    expect(select.disabled).toBe(false);
    expect(document.activeElement).toBe(select);
    expect(select.closest('li')?.getAttribute('aria-busy')).toBe('true');
    expect(selectFor(/My time no late/).closest('li')?.getAttribute('aria-busy')).toBeNull();
    const list = screen.getByRole('region', { name: 'Effect for each line' });
    expect(within(list).getByRole('status').textContent).toBe('Saving…');
    release();
    await waitFor(() => expect(saving()).toBe(0));
    expect(document.activeElement).toBe(select);
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('quote');
    expect(within(list).getByRole('status').textContent).toBe('');
  });

  it('two quick changes on different lines are both saved, and the latest project is shown', async () => {
    let server = two;
    // A server that reads the project, works on it, then writes it back whole: two writes at once would lose one.
    vi.mocked(lyricVideoApi.patchLine).mockImplementation(async (_id, lineId, patch) => {
      const read = server;
      await tick(20);
      server = withEffect(read, lineId, patch.effect as string);
      return server;
    });
    render(<Live initial={two} />);
    await screen.findByText('Effect for each line');
    fireEvent.change(selectFor(/Who talk say/), { target: { value: 'curve' } });
    fireEvent.change(selectFor(/My time no late/), { target: { value: 'pop' } });
    await waitFor(() => expect(lyricVideoApi.patchLine).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(saving()).toBe(0));
    await tick(50);
    expect(server.lines.map((l) => l.effect)).toEqual(['curve', 'pop']);
    expect(selectFor(/Who talk say/).value).toBe('curve');
    expect(selectFor(/My time no late/).value).toBe('pop');
  });

  it('an older reply arriving last does not overwrite a newer one', async () => {
    const afterFirst = withEffect(two, 'l1', 'curve');
    const afterBoth = withEffect(afterFirst, 'l2', 'pop');
    vi.mocked(lyricVideoApi.patchLine)
      .mockImplementationOnce(async () => { await tick(40); return afterFirst; })
      .mockImplementationOnce(async () => afterBoth);
    render(<Live initial={two} />);
    await screen.findByText('Effect for each line');
    fireEvent.change(selectFor(/Who talk say/), { target: { value: 'curve' } });
    fireEvent.change(selectFor(/My time no late/), { target: { value: 'pop' } });
    await waitFor(() => expect(lyricVideoApi.patchLine).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(saving()).toBe(0));
    await tick(80);
    expect(selectFor(/Who talk say/).value).toBe('curve');
    expect(selectFor(/My time no late/).value).toBe('pop');
  });

  it('two quick choices on one line show the newest until it is saved', async () => {
    const releases: Array<() => void> = [];
    vi.mocked(lyricVideoApi.patchLine).mockImplementation((_id, lineId, patch) =>
      new Promise((r) => { releases.push(() => r(withEffect(two, lineId, patch.effect as string))); }));
    render(<Live initial={two} />);
    await screen.findByText('Effect for each line');
    const select = selectFor(/Who talk say/);
    fireEvent.change(select, { target: { value: 'curve' } });
    fireEvent.change(select, { target: { value: 'pop' } });
    await waitFor(() => expect(releases).toHaveLength(1));
    releases[0](); // the first reply (curve) comes back while pop is still waiting
    await waitFor(() => expect(releases).toHaveLength(2));
    expect(select.value).toBe('pop');
    expect(select.closest('li')?.getAttribute('aria-busy')).toBe('true');
    releases[1]();
    await waitFor(() => expect(saving()).toBe(0));
    expect(select.value).toBe('pop');
  });

  it('a shuffle and a line choice made together are saved one after the other', async () => {
    const shuffled = { ...two, look: { ...two.look, seed: nextSeed(1) } } as LyricProject;
    let release: () => void = () => undefined;
    vi.mocked(lyricVideoApi.setLook).mockImplementation(() => new Promise((r) => { release = () => r(shuffled); }));
    vi.mocked(lyricVideoApi.patchLine).mockResolvedValue(withEffect(shuffled, 'l1', 'curve'));
    render(<Live initial={two} />);
    await screen.findByText('Effect for each line');
    fireEvent.click(screen.getByRole('button', { name: /shuffle effects/i }));
    fireEvent.change(selectFor(/Who talk say/), { target: { value: 'curve' } });
    await tick(20);
    expect(lyricVideoApi.patchLine).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(lyricVideoApi.patchLine).toHaveBeenCalledWith('lv_1', 'l1', { effect: 'curve' }));
    await waitFor(() => expect(saving()).toBe(0));
    expect(selectFor(/Who talk say/).value).toBe('curve');
  });
});
