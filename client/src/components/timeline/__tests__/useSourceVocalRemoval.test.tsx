import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MusicTrack } from '../../../lib/musicLibraryApi';

const saved: MusicTrack = { id: 's1', label: 'First John Two', mood: '', previewUrl: null, default: false, source: 'upload', licence: 'unknown', durationSec: 262, ref: 'mylib:s1' };
const lib = { caps: { vocalRemoval: true }, saveLoose: vi.fn(async () => saved), refresh: vi.fn() };
vi.mock('../../music/useLibraryActions', () => ({ useLibraryActions: () => lib }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
// The dialog's own behaviour is tested with it; here it only needs to hand back an instrumental.
vi.mock('../../InstrumentalDialog', () => ({
  InstrumentalDialog: ({ track, onUse }: { track: MusicTrack; onUse: (t: MusicTrack) => void }) => (
    <button type="button" onClick={() => onUse({ ...track, id: 'i1', ref: 'mylib:i1', derivedFrom: track.ref })}>Use {track.label}</button>
  ),
}));

import { useSourceVocalRemoval } from '../useSourceVocalRemoval';

function Harness({ onUse }: { onUse: (ref: string, replaces: string[]) => void }) {
  const v = useSourceVocalRemoval({ onUse });
  return (
    <>
      <span>{v.available ? 'available' : 'unavailable'}</span>
      <button type="button" onClick={() => v.start('/outputs/user-audio-1.m4a')}>start</button>
      {v.dialog}
    </>
  );
}

beforeEach(() => { lib.caps = { vocalRemoval: true }; lib.saveLoose.mockClear(); });

describe('useSourceVocalRemoval', () => {
  it('saves the loose song, opens the dialog, and swaps the instrumental in for both the path and its library ref', async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    render(<Harness onUse={onUse} />);
    await user.click(screen.getByRole('button', { name: 'start' }));
    expect(lib.saveLoose).toHaveBeenCalledWith('/outputs/user-audio-1.m4a');
    await user.click(await screen.findByRole('button', { name: /use first john two/i }));
    expect(onUse).toHaveBeenCalledWith('mylib:i1', ['mylib:s1', '/outputs/user-audio-1.m4a']);
    expect(screen.queryByRole('button', { name: /use first john two/i })).not.toBeInTheDocument();
  });

  it('does nothing where vocal removal is unavailable', async () => {
    lib.caps = { vocalRemoval: false };
    render(<Harness onUse={vi.fn()} />);
    expect(screen.getByText('unavailable')).toBeInTheDocument();
    await act(async () => { screen.getByRole('button', { name: 'start' }).click(); });
    expect(lib.saveLoose).not.toHaveBeenCalled();
  });
});
