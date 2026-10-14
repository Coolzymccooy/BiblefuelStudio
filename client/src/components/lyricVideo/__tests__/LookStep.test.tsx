import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../../../lib/lyricVideoApi', () => ({
  lyricVideoApi: { setLook: vi.fn(), setBackground: vi.fn(), uploadBackground: vi.fn() },
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
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const project = {
  projectId: 'lv_1', song: { file: 'x', durationSec: 30, coverStill: 'cover.jpg' }, lines: [], timing: { status: 'done' },
  look: { id: 'studio-lagos-night', energy: 'lively', seed: 1 }, background: null,
} as unknown as LyricProject;
const withBg = { ...project, background: { file: '/o/bg.jpg', kind: 'image', fit: 'auto' } } as unknown as LyricProject;

describe('LookStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the looks and energies from the server and offers no shuffle', async () => {
    render(<LookStep project={project} onChange={vi.fn()} />);
    expect(await screen.findByRole('option', { name: 'Gold Rush' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Wild' })).toBeTruthy();
    expect(screen.queryByText(/shuffle/i)).toBeNull();
    expect((screen.getByLabelText(/energy/i) as HTMLSelectElement).value).toBe('lively');
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
    fireEvent.change(screen.getByLabelText(/energy/i), { target: { value: 'wild' } });
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
});
