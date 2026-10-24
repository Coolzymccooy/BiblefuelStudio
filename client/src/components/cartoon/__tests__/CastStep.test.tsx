import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../lib/errors', () => ({ toastError: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn() } }));
vi.mock('../../../lib/cartoonApi', () => ({
  cartoonApi: {
    update: vi.fn(),
    portraits: vi.fn(),
    approvePortrait: vi.fn(),
    shelf: vi.fn(),
    shelve: vi.fn(),
    fromShelf: vi.fn(),
    removeFromShelf: vi.fn(),
  },
}));

import { cartoonApi } from '../../../lib/cartoonApi';
import type { CartoonCastEntry, CartoonProject } from '../../../lib/cartoonTypes';
import { CastStep } from '../CastStep';

const done = (name: string) => ({ status: 'done' as const, url: `/p/${name}.png`, error: null });
const member = (name: string, over: Partial<CartoonCastEntry> = {}): CartoonCastEntry => ({
  name, look: `${name}, a cartoon character`, voice: 'bright', portrait: null, approved: false, shelfId: null, ...over,
});

function project(cast: Record<string, CartoonCastEntry>, over: Partial<CartoonProject> = {}): CartoonProject {
  return {
    id: 'c1',
    mode: 'cartoon',
    meta: { title: 'The Lost Lamb', verse: { reference: 'Luke 15:4', text: '' }, aspect: 'portrait', style: 'family3d' },
    cast,
    scenes: [{ id: 'a', place: 'Hillside', note: '' }],
    shots: [
      { id: 'sh1', sceneId: 'a', speaker: 'Eli', line: 'Pip?', action: null, note: '', seconds: 4, firstFrame: 'fresh', clip: null },
      { id: 'sh2', sceneId: 'a', speaker: 'Pip', line: 'Here!', action: null, note: '', seconds: 4, firstFrame: 'chain', clip: null },
    ],
    shotListApproved: false,
    running: { pictures: false, film: false, render: false },
    ...over,
  } as unknown as CartoonProject;
}

function Harness({ initial, onNext = () => {} }: { initial: CartoonProject; onNext?: () => void }) {
  const [p, setP] = useState(initial);
  return <CastStep project={p} onSaved={setP} onNext={onNext} />;
}

const next = () => screen.getByRole('button', { name: /^next/i });

describe('CastStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cartoonApi.shelf).mockResolvedValue([]);
  });

  it('shows why the approved portrait matters', () => {
    render(<Harness initial={project({ Eli: member('Eli') })} />);
    expect(screen.getByText('The approved portrait is what keeps each face the same in every shot.')).toBeInTheDocument();
  });

  it('Next waits until every speaking character is approved', async () => {
    const onNext = vi.fn();
    const before = project({ Eli: member('Eli', { portrait: done('Eli'), approved: true }), Pip: member('Pip', { portrait: done('Pip') }) });
    vi.mocked(cartoonApi.approvePortrait).mockResolvedValue(
      project({ Eli: member('Eli', { portrait: done('Eli'), approved: true }), Pip: member('Pip', { portrait: done('Pip'), approved: true }) }),
    );
    render(<Harness initial={before} onNext={onNext} />);
    expect(next()).toBeDisabled();
    expect(screen.getByText(/Approve Pip's portrait to go on/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve Pip' }));
    await waitFor(() => expect(next()).toBeEnabled());
    expect(cartoonApi.approvePortrait).toHaveBeenCalledWith('c1', 'Pip');
    fireEvent.click(next());
    expect(onNext).toHaveBeenCalled();
  });

  it('a changed look is saved on blur and clears the shown portrait', async () => {
    const before = project({ Eli: member('Eli', { portrait: done('Eli'), approved: true }) });
    vi.mocked(cartoonApi.update).mockResolvedValue(project({ Eli: member('Eli', { look: 'Eli, a tall boy', portrait: null }) }));
    render(<Harness initial={before} />);
    expect(screen.getByRole('img', { name: 'Portrait of Eli' })).toBeInTheDocument();

    const look = screen.getByRole('textbox', { name: "Eli's look" });
    fireEvent.blur(look);
    expect(cartoonApi.update).not.toHaveBeenCalled();

    fireEvent.change(look, { target: { value: 'Eli, a tall boy' } });
    fireEvent.blur(look);
    await waitFor(() => expect(cartoonApi.update).toHaveBeenCalledWith('c1', { cast: { Eli: { look: 'Eli, a tall boy' } } }));
    await waitFor(() => expect(screen.queryByRole('img', { name: 'Portrait of Eli' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Make portrait of Eli' })).toBeEnabled();
  });

  it('a changed voice is saved on blur', async () => {
    vi.mocked(cartoonApi.update).mockResolvedValue(project({ Eli: member('Eli', { voice: 'deep, slow' }) }));
    render(<Harness initial={project({ Eli: member('Eli') })} />);
    const voice = screen.getByRole('textbox', { name: "Eli's voice" });
    fireEvent.change(voice, { target: { value: 'deep, slow' } });
    fireEvent.blur(voice);
    await waitFor(() => expect(cartoonApi.update).toHaveBeenCalledWith('c1', { cast: { Eli: { voice: 'deep, slow' } } }));
  });

  it('Make portrait is off with an empty look, and says why', () => {
    render(<Harness initial={project({ Eli: member('Eli', { look: '' }) })} />);
    expect(screen.getByRole('button', { name: 'Make portrait of Eli' })).toBeDisabled();
    expect(screen.getByText('Describe the look first.')).toBeInTheDocument();
  });

  it('Make portrait starts the picture for that one character', async () => {
    vi.mocked(cartoonApi.portraits).mockResolvedValue(
      project({ Eli: member('Eli', { portrait: { status: 'making', url: null, error: null } }) }, { running: { pictures: true, film: false, render: false } }),
    );
    render(<Harness initial={project({ Eli: member('Eli') })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make portrait of Eli' }));
    await waitFor(() => expect(cartoonApi.portraits).toHaveBeenCalledWith('c1', ['Eli']));
    expect(await screen.findByText('Drawing the portrait…')).toBeInTheDocument();
  });

  it('a portrait drawn in the old style hides Approve and says to make it again', () => {
    const old = { ...done('Eli'), style: 'clay' };
    render(<Harness initial={project({ Eli: member('Eli', { portrait: old }), Pip: member('Pip', { portrait: done('Pip'), approved: true }) })} />);
    expect(screen.queryByRole('button', { name: 'Approve Eli' })).not.toBeInTheDocument();
    expect(screen.getByText('Drawn in the old style. Make it again in the new style.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Make Eli's portrait again" })).toBeEnabled();
    expect(next()).toBeDisabled();
  });

  it('look and voice stop at the lengths the server keeps', () => {
    render(<Harness initial={project({ Eli: member('Eli') })} />);
    expect(screen.getByRole('textbox', { name: "Eli's look" })).toHaveAttribute('maxLength', '600');
    expect(screen.getByRole('textbox', { name: "Eli's voice" })).toHaveAttribute('maxLength', '200');
  });

  it('a portrait that failed shows its error on the card', () => {
    render(<Harness initial={project({ Eli: member('Eli', { portrait: { status: 'error', url: null, error: 'The picture could not be made. Try again.' } }) })} />);
    expect(screen.getByText('The picture could not be made. Try again.')).toBeInTheDocument();
  });

  it('a shelf character can be added for a cast member', async () => {
    vi.mocked(cartoonApi.shelf).mockResolvedValue([
      { id: 'k1', name: 'Pip', look: 'a lamb', voice: 'small', style: 'family3d', portraitUrl: '/s/k1.png', createdAt: 1 },
    ]);
    vi.mocked(cartoonApi.fromShelf).mockResolvedValue(project({ Eli: member('Eli'), Pip: member('Pip', { portrait: done('Pip'), approved: true, shelfId: 'k1' }) }));
    render(<Harness initial={project({ Eli: member('Eli'), Pip: member('Pip') })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add from shelf' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use Pip' }));
    await waitFor(() => expect(cartoonApi.fromShelf).toHaveBeenCalledWith('c1', 'k1', undefined));
  });
});
