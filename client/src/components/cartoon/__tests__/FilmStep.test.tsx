import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../../lib/errors', () => ({ toastError: vi.fn() }));
vi.mock('../../../lib/cartoonApi', () => ({
  cartoonApi: { film: vi.fn(), cancelFilm: vi.fn(), estimate: vi.fn() },
}));

import { cartoonApi } from '../../../lib/cartoonApi';
import { ApiError } from '../../../lib/apiError';
import type { CartoonClip, CartoonEstimate, CartoonMonth, CartoonProject, CartoonShot } from '../../../lib/cartoonTypes';
import { FilmStep } from '../FilmStep';

const estimate = (over: Partial<CartoonEstimate> = {}): CartoonEstimate => ({
  clips: 3, seconds: 14, usd: 1.4, images: 0, imageUsd: 0, spentUsd: 0, totalUsd: 1.4, benchmarkUsd: 10, overBenchmark: false, shotIds: ['sh1', 'sh2', 'sh3'], ...over,
});

const doneClip = (over: Partial<CartoonClip> = {}): CartoonClip => ({
  status: 'done', url: '/outputs/clip.mp4', posterUrl: '/outputs/clip.jpg', costUsd: 0.4, durationSec: 4, speech: { ok: true, heard: 'ok', score: 1 }, ...over,
});

const shot = (id: string, n: number, over: Partial<CartoonShot> = {}): CartoonShot => ({
  id, sceneId: 'a', speaker: 'Eli', line: `Line ${n}`, action: null, note: '', seconds: 4, firstFrame: n === 1 ? 'fresh' : 'chain', clip: null, ...over,
});

const baseShots = [shot('sh1', 1), shot('sh2', 2, { seconds: 6 }), shot('sh3', 3)];

function project(over: Partial<CartoonProject> = {}): CartoonProject {
  return {
    id: 'c1',
    mode: 'cartoon',
    meta: { title: 'The Lost Lamb', verse: { reference: 'Luke 15:4', text: '' }, aspect: 'portrait', style: 'family3d' },
    cast: {},
    scenes: [{ id: 'a', place: 'Hillside', note: '' }],
    shots: baseShots,
    shotListApproved: true,
    spentUsd: 0,
    estimate: estimate(),
    running: { pictures: false, film: false, render: false },
    blockers: [],
    render: { status: 'idle' },
    renderBlockers: [],
    renderWarnings: [],
    ...over,
  } as unknown as CartoonProject;
}

const month: CartoonMonth = { spentUsd: 40, capUsd: 50 };

function Harness({ initial, onSaved = () => {} }: { initial: CartoonProject; onSaved?: (p: CartoonProject) => void }) {
  const [p, setP] = useState(initial);
  return <FilmStep project={p} month={month} seedance onSaved={(next) => { onSaved(next); setP(next); }} onNext={() => {}} />;
}

const card = (n: number) => screen.getByRole('listitem', { name: `Shot ${n}` });

describe('FilmStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cartoonApi.estimate).mockResolvedValue({ estimate: estimate({ seconds: 14, usd: 1.4 }), month });
  });

  it('shows the estimate line with what is left this month', () => {
    render(<Harness initial={project()} />);
    expect(screen.getByText('3 clips · 14 s · about $1.40 · $10.00 left this month')).toBeInTheDocument();
  });

  it('over the benchmark asks again naming the amount', async () => {
    const over = estimate({ spentUsd: 9.6, totalUsd: 11, overBenchmark: true });
    vi.mocked(cartoonApi.film)
      .mockRejectedValueOnce(new ApiError('This cartoon would cost about $11.00, above the $10 benchmark. Confirm to go ahead.', 'OVER_BENCHMARK', { estimate: over }, 409))
      .mockResolvedValueOnce(project({ running: { pictures: false, film: true, render: false } }));
    render(<Harness initial={project()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make the film' }));
    expect(await screen.findByText(/brings this cartoon to about \$11\.00, above the \$10\.00 benchmark/)).toBeInTheDocument();
    expect(cartoonApi.film).toHaveBeenCalledTimes(1);
    expect(cartoonApi.film).toHaveBeenLastCalledWith('c1', {});
    fireEvent.click(screen.getByRole('button', { name: 'Yes, order for about $1.40' }));
    await waitFor(() => expect(cartoonApi.film).toHaveBeenLastCalledWith('c1', { confirmOverBenchmark: true }));
  });

  it('a mismatched clip shows what was heard', () => {
    const shots = [shot('sh1', 1, { clip: doneClip({ speech: { ok: false, heard: 'Pip, where were you', score: 0.55 } }) }), ...baseShots.slice(1)];
    render(<Harness initial={project({ shots })} />);
    expect(within(card(1)).getByText('Speech doesn\'t match')).toBeInTheDocument();
    expect(within(card(1)).getByText('Heard: “Pip, where were you”')).toBeInTheDocument();
  });

  it('a stale shot says it is out of date', () => {
    const shots = [shot('sh1', 1, { clip: doneClip() }), shot('sh2', 2, { clip: doneClip({ stale: true }) }), baseShots[2]];
    render(<Harness initial={project({ shots })} />);
    expect(within(card(2)).getByText('Out of date: starts from the old frame')).toBeInTheDocument();
    expect(within(card(1)).queryByText('Out of date: starts from the old frame')).not.toBeInTheDocument();
  });

  it('BUDGET shows the server sentence and orders nothing', async () => {
    const onSaved = vi.fn();
    const sentence = 'This would bring the month to $51.40, over the $50 AI video cap. You are $1.40 short.';
    vi.mocked(cartoonApi.film).mockRejectedValue(new ApiError(sentence, 'BUDGET', {}, 409));
    render(<Harness initial={project()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make the film' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(sentence);
    expect(cartoonApi.film).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Yes, order/ })).not.toBeInTheDocument();
  });

  it('Stop calls cancelFilm', async () => {
    vi.mocked(cartoonApi.cancelFilm).mockResolvedValue({ stopping: true });
    const shots = [shot('sh1', 1, { clip: { status: 'generating' } }), ...baseShots.slice(1)];
    render(<Harness initial={project({ shots, running: { pictures: false, film: true, render: false } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(cartoonApi.cancelFilm).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText(/Stopping\./)).toBeInTheDocument();
  });

  it('Retry sends only failed and refused shots, and the shots waiting on them', async () => {
    vi.mocked(cartoonApi.film).mockResolvedValue(project({ running: { pictures: false, film: true, render: false } }));
    const shots = [
      shot('sh1', 1, { clip: doneClip() }),
      shot('sh2', 2, { clip: { status: 'error', error: 'Something went wrong making this clip. Try again.' } }),
      shot('sh3', 3, { clip: { status: 'waiting', error: 'Waiting for shot 2' } }),
      shot('sh4', 4, { firstFrame: 'fresh', clip: { status: 'refused', error: 'BytePlus declined this shot.' } }),
    ];
    render(<Harness initial={project({ shots })} />);
    fireEvent.click(screen.getByRole('button', { name: /^Retry 3 shots/ }));
    await waitFor(() => expect(cartoonApi.film).toHaveBeenCalledWith('c1', { only: ['sh2', 'sh3', 'sh4'] }));
  });

  it('Re-make shows its price', async () => {
    vi.mocked(cartoonApi.film).mockResolvedValue(project({ running: { pictures: false, film: true, render: false } }));
    const shots = baseShots.map((s) => ({ ...s, clip: doneClip() }));
    render(<Harness initial={project({ shots, estimate: estimate({ clips: 0, seconds: 0, usd: 0, shotIds: [] }) })} />);
    const remake = await within(card(2)).findByRole('button', { name: 'Re-make shot 2, about $0.60' });
    expect(within(card(2)).getByText('about $0.60')).toBeInTheDocument();
    expect(cartoonApi.estimate).toHaveBeenCalledWith('c1', ['sh1', 'sh2', 'sh3']);
    fireEvent.click(remake);
    await waitFor(() => expect(cartoonApi.film).toHaveBeenCalledWith('c1', { only: ['sh2'] }));
  });

  it('a re-make that did not work says the earlier clip was kept, and why', () => {
    const shots = [shot('sh1', 1, { clip: doneClip({ remakeError: 'BytePlus declined this shot. Change its note or action and try again.' }) }), ...baseShots.slice(1)];
    render(<Harness initial={project({ shots })} />);
    const notice = within(card(1)).getByRole('status');
    expect(notice).toHaveTextContent("The re-make didn't work; kept the earlier clip.");
    expect(notice).toHaveTextContent('BytePlus declined this shot. Change its note or action and try again.');
    expect(within(card(1)).getByText('Done')).toBeInTheDocument();
  });

  it('Re-make is off, and says why, while its price is unknown', async () => {
    vi.mocked(cartoonApi.estimate).mockRejectedValue(new Error('offline'));
    const shots = baseShots.map((s) => ({ ...s, clip: doneClip() }));
    render(<Harness initial={project({ shots, estimate: estimate({ clips: 0, seconds: 0, usd: 0, shotIds: [] }) })} />);
    const remake = within(card(1)).getByRole('button', { name: 'Re-make shot 1' });
    expect(remake).toBeDisabled();
    expect(within(card(1)).getByText("The price of a re-make can't be worked out yet.")).toBeInTheDocument();
    fireEvent.click(remake);
    expect(cartoonApi.film).not.toHaveBeenCalled();
  });

  it('a paid clip that can be fetched again is offered at no charge', async () => {
    vi.mocked(cartoonApi.film).mockResolvedValue(project({ running: { pictures: false, film: true, render: false } }));
    const paid = { status: 'error' as const, error: 'The clip was made and paid for but could not be downloaded.', taskId: 't1', chargedTaskId: 't1', startedAt: Date.now() };
    const shots = [shot('sh1', 1, { clip: paid }), shot('sh2', 2, { clip: doneClip() }), shot('sh3', 3, { clip: doneClip() })];
    render(<Harness initial={project({ shots, estimate: estimate({ clips: 0, refetch: 1, seconds: 0, usd: 0, shotIds: ['sh1'] }) })} />);
    expect(screen.getByText('1 paid clip to fetch again · no charge')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry 1 shot, no charge' }));
    await waitFor(() => expect(cartoonApi.film).toHaveBeenCalledWith('c1', { only: ['sh1'] }));
  });

  it('a waiting clip names the shot it waits for', () => {
    const shots = [
      shot('sh1', 1, { clip: { status: 'error', error: 'Something went wrong making this clip. Try again.' } }),
      shot('sh2', 2, { clip: { status: 'waiting', error: 'Waiting for shot 1' } }),
      shot('sh3', 3, { clip: { status: 'waiting', error: 'Waiting for shot 2' } }),
    ];
    render(<Harness initial={project({ shots })} />);
    expect(within(card(2)).getByText('Waiting for shot 1')).toBeInTheDocument();
    expect(within(card(3)).getByText('Waiting for shot 2')).toBeInTheDocument();
    expect(within(card(1)).getByText('Failed')).toBeInTheDocument();
  });
});
