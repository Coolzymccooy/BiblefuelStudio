import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MusicTrack } from '../../../lib/musicLibraryApi';

const track = (id: string, label: string, over: Partial<MusicTrack> = {}): MusicTrack => ({
  id, label, mood: 'calm', previewUrl: `/music/${id}.mp3`, default: false, source: 'bundled', licence: 'pixabay-cleared',
  durationSec: 229, ref: `library:${id}`, credit: 'Music from Pixabay', ...over,
});
const tracks = [track('a', 'Peaceful Worship', { default: true }), track('b', 'Prayer Piano')];
const uploadFile = vi.hoisted(() => vi.fn());
const instrumentalState = vi.hoisted(() => ({ target: null as unknown }));

// The Remove vocals dialog is out of scope here: a stub that finishes at once.
vi.mock('../../InstrumentalModal', () => ({
  InstrumentalModal: ({ onUse }: { onUse: (t: unknown) => void }) => (
    <button type="button" onClick={() => onUse({ id: 'inst', ref: 'mylib:inst', label: 'Prayer Piano (instrumental)', durationSec: 229 })}>Use in this video</button>
  ),
}));

vi.mock('../useLibraryActions', () => ({
  useLibraryActions: () => ({
    tracks,
    isUploading: false,
    instrumentalFor: instrumentalState.target,
    setInstrumentalFor: vi.fn(),
    refresh: vi.fn(),
    uploadFile,
    trackForRef: (p: string) => tracks.find((t) => t.ref === p),
    trackLabel: (p: string) => tracks.find((t) => t.ref === p)?.label ?? p.split('/').pop(),
    manageControls: () => null,
  }),
}));

import { SongCard } from '../SongCard';

beforeEach(() => { localStorage.clear(); uploadFile.mockReset(); instrumentalState.target = null; });

const soundtrack = { label: 'Prayer Piano.mp3', name: 'Prayer Piano.mp3', trimmed: true, durationMs: 229_000 };
const noBed = { path: null, volume: 0.3 };
const WARNING = /this looks like your soundtrack/i;

// Pick "Prayer Piano" from the library drawer and press Use this song.
async function pickPrayerPiano(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /choose from library/i }));
  const drawer = screen.getByRole('dialog', { name: /music library/i });
  await user.click(within(drawer).getByRole('radio', { name: /prayer piano/i }));
  await user.click(within(drawer).getByRole('button', { name: /use this song/i }));
}

describe('SongCard with a source soundtrack', () => {
  it('shows the soundtrack above the bed, with trimmed and length, and says it plays under the story', () => {
    render(<SongCard value={noBed} onChange={vi.fn()} busy={false} soundtrack={soundtrack} />);
    expect(screen.getByText('Soundtrack: Prayer Piano.mp3 · trimmed · 3:49')).toBeInTheDocument();
    expect(screen.getByText('Plays under the whole story, in time with the captions. Music below is added on top.')).toBeInTheDocument();
  });

  it('omits trimmed and length when they are not known', () => {
    render(<SongCard value={noBed} onChange={vi.fn()} busy={false} soundtrack={{ label: 'your narration', trimmed: false, durationMs: 0 }} />);
    expect(screen.getByText('Soundtrack: your narration')).toBeInTheDocument();
  });

  it('with no bed: says the soundtrack plays on its own instead of the voice-alone copy', () => {
    render(<SongCard value={noBed} onChange={vi.fn()} busy={false} soundtrack={soundtrack} />);
    expect(screen.getByText('No extra music. Your soundtrack plays on its own — add a song only if you want one underneath it.')).toBeInTheDocument();
    expect(screen.queryByText(/voice alone/i)).not.toBeInTheDocument();
  });

  it('keeps the old copy and shows no soundtrack line when the project has no soundtrack', () => {
    render(<SongCard value={noBed} onChange={vi.fn()} busy={false} />);
    expect(screen.getByText(/no music yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Soundtrack:/)).not.toBeInTheDocument();
  });

  it('renders the file name as text, not markup', () => {
    render(<SongCard value={noBed} onChange={vi.fn()} busy={false} soundtrack={{ label: '<b>x</b>', name: '<b>x</b>', trimmed: false, durationMs: 0 }} />);
    expect(screen.getByText('Soundtrack: <b>x</b>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('warns before a library song that looks like the soundtrack; Keep it out changes nothing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SongCard value={noBed} onChange={onChange} busy={false} soundtrack={soundtrack} />);
    await pickPrayerPiano(user);
    const warning = screen.getByRole('alertdialog');
    expect(warning).toHaveTextContent(WARNING);
    expect(warning).toHaveTextContent('Adding it again plays the song twice, out of step. Add it anyway?');
    expect(within(warning).getByRole('button', { name: 'Keep it out' })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(within(warning).getByRole('button', { name: 'Keep it out' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Add anyway applies the song', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SongCard value={noBed} onChange={onChange} busy={false} soundtrack={soundtrack} />);
    await pickPrayerPiano(user);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Add anyway' }));
    expect(onChange).toHaveBeenCalledWith({ path: 'library:b', volume: 0.3, autoDuck: true });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('Escape keeps it out', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SongCard value={noBed} onChange={onChange} busy={false} soundtrack={soundtrack} />);
    await pickPrayerPiano(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not warn for a different song', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SongCard value={noBed} onChange={onChange} busy={false} soundtrack={soundtrack} />);
    await user.click(screen.getByRole('button', { name: /use the default \(peaceful worship\)/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith({ path: 'library:a', volume: 0.3, autoDuck: true });
  });

  it('warns before uploading the same file as music, and only uploads on Add anyway', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    uploadFile.mockResolvedValue('mylib:new');
    const { container } = render(<SongCard value={noBed} onChange={onChange} busy={false} soundtrack={soundtrack} />);
    await user.upload(container.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'prayer piano (1).MP3', { type: 'audio/mpeg' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(WARNING);
    expect(uploadFile).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add anyway' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ path: 'mylib:new', volume: 0.3, autoDuck: true }));
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it('uploads a different file without asking', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    uploadFile.mockResolvedValue('mylib:other');
    const { container } = render(<SongCard value={noBed} onChange={onChange} busy={false} soundtrack={soundtrack} />);
    await user.upload(container.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'Other Song.mp3', { type: 'audio/mpeg' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ path: 'mylib:other', volume: 0.3, autoDuck: true }));
  });

  it('never warns when there is no soundtrack', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SongCard value={noBed} onChange={onChange} busy={false} />);
    await pickPrayerPiano(user);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith({ path: 'library:b', volume: 0.3, autoDuck: true });
  });

  it('warns before an instrumental of the soundtrack song is used, and only applies it on Add anyway', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    instrumentalState.target = tracks[1];
    render(<SongCard value={noBed} onChange={onChange} busy={false} soundtrack={soundtrack} />);
    await user.click(screen.getByRole('button', { name: /use in this video/i }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(WARNING);
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add anyway' }));
    expect(onChange).toHaveBeenCalledWith({ path: 'mylib:inst', volume: 0.3, autoDuck: true });
  });

  it('uses an instrumental of a different song without asking', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    instrumentalState.target = tracks[0];
    render(<SongCard value={noBed} onChange={onChange} busy={false} soundtrack={{ ...soundtrack, name: 'Other.mp3', label: 'Other.mp3' }} />);
    await user.click(screen.getByRole('button', { name: /use in this video/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith({ path: 'mylib:inst', volume: 0.3, autoDuck: true });
  });
});
