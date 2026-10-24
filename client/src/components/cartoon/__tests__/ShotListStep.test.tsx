import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../../lib/errors', () => ({ toastError: vi.fn() }));
vi.mock('../../../lib/cartoonApi', () => ({
  cartoonApi: { update: vi.fn(), approveShots: vi.fn() },
}));

import { cartoonApi } from '../../../lib/cartoonApi';
import { ApiError } from '../../../lib/apiError';
import type { CartoonProject, CartoonShot } from '../../../lib/cartoonTypes';
import { ShotListStep } from '../ShotListStep';

const done = (name: string) => ({ status: 'done' as const, url: `/p/${name}.png`, error: null });
const member = (name: string) => ({ name, look: `${name} look`, voice: '', portrait: done(name), approved: true, shelfId: null });

const shots: CartoonShot[] = [
  { id: 'sh1', sceneId: 'a', speaker: 'Eli', line: 'Pip? Where are you?', action: 'Pip hides behind a rock', note: 'wide, dusk', seconds: 4, firstFrame: 'fresh', clip: null },
  { id: 'sh2', sceneId: 'a', speaker: 'Pip', line: 'Here!', action: null, note: '', seconds: 6, firstFrame: 'chain', clip: null },
];

function project(over: Partial<CartoonProject> = {}): CartoonProject {
  return {
    id: 'c1',
    mode: 'cartoon',
    meta: { title: 'The Lost Lamb', verse: { reference: 'Luke 15:4', text: '' }, aspect: 'portrait', style: 'family3d' },
    cast: { Eli: member('Eli'), Pip: member('Pip') },
    scenes: [{ id: 'a', place: 'Hillside', note: '' }],
    shots,
    shotListApproved: false,
    check: { storySec: 10, filmSec: 15.5, ok: true, overBySec: 0, trimScene: null, tooLong: [], tooMany: false },
    estimate: { clips: 2, seconds: 10, usd: 1, images: 0, imageUsd: 0, spentUsd: 0, totalUsd: 1, benchmarkUsd: 10, overBenchmark: false, shotIds: ['sh1', 'sh2'] },
    running: { pictures: false, film: false, render: false },
    ...over,
  } as unknown as CartoonProject;
}

function Harness({ initial, onNext = () => {}, onGoCast = () => {} }: { initial: CartoonProject; onNext?: () => void; onGoCast?: () => void }) {
  const [p, setP] = useState(initial);
  return <ShotListStep project={p} onSaved={setP} onNext={onNext} onGoCast={onGoCast} />;
}

const row = (n: number) => screen.getByRole('listitem', { name: `Shot ${n}` });

describe('ShotListStep', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows each shot\'s speaker, line, length, price and the film total', () => {
    render(<Harness initial={project()} />);
    const first = row(1);
    expect(within(first).getByText('Eli')).toBeInTheDocument();
    expect(within(first).getByText('“Pip? Where are you?”')).toBeInTheDocument();
    expect(within(first).getByText('4 s')).toBeInTheDocument();
    expect(within(first).getByText('about $0.40')).toBeInTheDocument();
    expect(within(row(2)).getByText('about $0.60')).toBeInTheDocument();
    expect(screen.getByText('15.5 s of 40')).toBeInTheDocument();
    expect(screen.getByText('about $1.00')).toBeInTheDocument();
  });

  it('a new angle row shows the portraits it will use, and a continuing row says where it starts', () => {
    render(<Harness initial={project()} />);
    const pictures = within(row(1)).getAllByRole('img');
    expect(pictures.map((p) => p.getAttribute('alt'))).toEqual(['Eli', 'Pip']);
    expect(within(row(2)).queryAllByRole('img')).toHaveLength(0);
    expect(within(row(2)).getByText('Starts from the last frame of shot 1')).toBeInTheDocument();
  });

  it('the first-frame toggle patches the shot', async () => {
    vi.mocked(cartoonApi.update).mockResolvedValue(project({ shots: [shots[0], { ...shots[1], firstFrame: 'fresh' }] }));
    render(<Harness initial={project()} />);
    fireEvent.click(within(row(2)).getByRole('radio', { name: 'New angle' }));
    await waitFor(() => expect(cartoonApi.update).toHaveBeenCalledWith('c1', { shots: [{ id: 'sh2', firstFrame: 'fresh' }] }));
    await waitFor(() => expect(within(row(2)).getByRole('radio', { name: 'New angle' })).toBeChecked());
  });

  it('the first shot cannot continue from a last shot, and says why', () => {
    render(<Harness initial={project()} />);
    const chain = within(row(1)).getByRole('radio', { name: 'Continue from last shot' });
    expect(chain).toBeDisabled();
    expect(within(row(1)).getByText('The first shot has no shot before it to continue.')).toBeInTheDocument();
    expect(within(row(2)).getByRole('radio', { name: 'Continue from last shot' })).toBeEnabled();
  });

  it('the director\'s note is saved on blur, only when changed', async () => {
    vi.mocked(cartoonApi.update).mockResolvedValue(project());
    render(<Harness initial={project()} />);
    const note = within(row(1)).getByRole('textbox', { name: 'Director\'s note for shot 1' });
    fireEvent.blur(note);
    expect(cartoonApi.update).not.toHaveBeenCalled();
    fireEvent.change(note, { target: { value: 'close-up, slow push-in' } });
    fireEvent.blur(note);
    await waitFor(() => expect(cartoonApi.update).toHaveBeenCalledWith('c1', { shots: [{ id: 'sh1', note: 'close-up, slow push-in' }] }));
  });

  it('approving the shot list calls approveShots', async () => {
    const onNext = vi.fn();
    vi.mocked(cartoonApi.approveShots).mockResolvedValue(project({ shotListApproved: true }));
    render(<Harness initial={project()} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve shot list' }));
    await waitFor(() => expect(cartoonApi.approveShots).toHaveBeenCalledWith('c1'));
    fireEvent.click(await screen.findByRole('button', { name: /^next/i }));
    expect(onNext).toHaveBeenCalled();
  });

  it('Approve shot list waits for a note that is still saving', async () => {
    let finish: (p: CartoonProject) => void = () => {};
    vi.mocked(cartoonApi.update).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(cartoonApi.approveShots).mockResolvedValue(project({ shotListApproved: true }));
    render(<Harness initial={project()} />);
    const note = within(row(1)).getByRole('textbox', { name: 'Director\'s note for shot 1' });
    fireEvent.change(note, { target: { value: 'close-up' } });
    fireEvent.blur(note);
    const approve = screen.getByRole('button', { name: 'Approve shot list' });
    await waitFor(() => expect(approve).toBeDisabled());
    expect(screen.getByText('Saving your change…')).toBeInTheDocument();
    finish(project({ shots: [{ ...shots[0], note: 'close-up' }, shots[1]] }));
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    await waitFor(() => expect(cartoonApi.approveShots).toHaveBeenCalledWith('c1'));
  });

  it('a film over 40 s says so clearly next to the total', () => {
    const over = { storySec: 37, filmSec: 42.5, ok: false, overBySec: 2.5, trimScene: { id: 'a', place: 'Hillside' }, tooLong: [], tooMany: false };
    render(<Harness initial={project({ check: over })} />);
    expect(screen.getByText('42.5 s of 40')).toBeInTheDocument();
    expect(screen.getByText('2.5 s over the 40 s limit. Trim the scene "Hillside" on the Script step.')).toBeInTheDocument();
  });

  it('a cast not ready names who is still waiting', async () => {
    const onGoCast = vi.fn();
    vi.mocked(cartoonApi.approveShots).mockRejectedValue(
      new ApiError('Approve the portraits of Eli and Pip first.', 'CAST_NOT_READY', { waiting: ['Eli', 'Pip'] }, 409),
    );
    render(<Harness initial={project()} onGoCast={onGoCast} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve shot list' }));
    expect(await screen.findByText('Still waiting for approved portraits of Eli and Pip.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go to cast' }));
    expect(onGoCast).toHaveBeenCalled();
  });
});
