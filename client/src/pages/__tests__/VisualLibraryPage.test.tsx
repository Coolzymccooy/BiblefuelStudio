import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/sceneScriptApi', () => ({
  visualLibraryApi: {
    search: vi.fn(), leads: vi.fn(), update: vi.fn(), remove: vi.fn(), makePosters: vi.fn(), backfillStory: vi.fn(), importClip: vi.fn(),
    rerollPrice: vi.fn(), reroll: vi.fn(), rerolls: vi.fn(), refetchReroll: vi.fn(),
  },
}));
vi.mock('../../lib/errors', () => ({ toastError: vi.fn() }));
vi.mock('../../lib/mediaUpload', () => ({ uploadMedia: vi.fn() }));

import { visualLibraryApi } from '../../lib/sceneScriptApi';
import { ApiError } from '../../lib/apiError';
import { useAuth } from '../../hooks/useAuth';
import { VisualLibraryPage } from '../VisualLibraryPage';
import type { LibraryClip, RerollJob } from '../../lib/sceneScriptTypes';
import { REROLL_POLL_MS } from '../../components/visualLibrary/useRerolls';

const api = vi.mocked(visualLibraryApi);
const month = { month: '2026-10', spentUsd: 1, reservedUsd: 0, capUsd: 30 };
const job = (over: Partial<RerollJob> = {}): RerollJob => ({
  id: 'j1', fromClipId: 'c1', prompt: 'A shepherd boy at dawn', status: 'generating', error: null, clipId: null,
  estimateUsd: 0.64, costUsd: null, createdAt: Date.now(), ...over,
});

function clip(over: Partial<LibraryClip> = {}): LibraryClip {
  return {
    id: 'c1', prompt: 'A shepherd boy calls out at sunset', promptKnown: true, url: '/c1.mp4', posterUrl: '/c1.jpg',
    durationSec: 8, costUsd: 0.61, aspect: 'portrait', tags: ['lamb'], rating: null, createdAt: 1, ...over,
  };
}

function renderPage() {
  return render(<MemoryRouter><VisualLibraryPage /></MemoryRouter>);
}

describe('VisualLibraryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.setState({ isSuperAdmin: true });
    api.search.mockResolvedValue([clip(), clip({ id: 'c2', prompt: '', promptKnown: false, tags: [], posterUrl: '/c2.jpg', costUsd: 0 })]);
    api.leads.mockResolvedValue([{ lead: 'a shepherd boy', clips: 1 }]);
    api.makePosters.mockResolvedValue({ made: 0, failed: 0, remaining: 0 });
    api.rerolls.mockResolvedValue({ jobs: [], month });
    api.rerollPrice.mockResolvedValue({ price: { seconds: 8, usd: 0.64 }, month, seedance: true });
  });
  afterEach(() => useAuth.setState({ isSuperAdmin: false }));

  it('is for super admins only', () => {
    useAuth.setState({ isSuperAdmin: false });
    renderPage();
    expect(screen.getByText(/super admins only/)).toBeTruthy();
    expect(api.search).not.toHaveBeenCalled();
  });

  it('lists clips, saying when a prompt is unknown', async () => {
    renderPage();
    expect(await screen.findByText('A shepherd boy calls out at sunset')).toBeTruthy();
    expect(screen.getByText('Prompt unknown')).toBeTruthy();
    expect(api.makePosters).not.toHaveBeenCalled();
  });

  it('searches with the shape, lead character, tag and rating filters', async () => {
    renderPage();
    await screen.findByText('A shepherd boy calls out at sunset');
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }));
    fireEvent.change(screen.getByLabelText('Lead character'), { target: { value: 'a shepherd boy' } });
    fireEvent.change(screen.getByLabelText('Rating'), { target: { value: '4' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Show clips tagged lamb' })[0]);
    await waitFor(() => expect(api.search).toHaveBeenLastCalledWith('', 'landscape', { lead: 'a shepherd boy', tag: 'lamb', rating: 4, limit: 200 }));
  });

  it('rates a clip', async () => {
    api.update.mockResolvedValue(clip({ rating: 4 }));
    renderPage();
    const card = (await screen.findByText('A shepherd boy calls out at sunset')).closest('li') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Rate 4 stars' }));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('c1', { rating: 4 }));
    expect(within(card).getByRole('button', { name: 'Rate 4 stars' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('edits tags', async () => {
    api.update.mockResolvedValue(clip({ tags: ['lamb', 'sunset'] }));
    renderPage();
    const card = (await screen.findByText('A shepherd boy calls out at sunset')).closest('li') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Edit tags' }));
    const input = within(card).getByLabelText('Tags for this clip');
    fireEvent.change(input, { target: { value: 'Lamb, sunset , ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('c1', { tags: ['lamb', 'sunset'] }));
    expect(api.update).toHaveBeenCalledTimes(1);
  });

  it('leaves the tags alone when the edit is abandoned with Escape', async () => {
    renderPage();
    const card = (await screen.findByText('A shepherd boy calls out at sunset')).closest('li') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Edit tags' }));
    const input = within(card).getByLabelText('Tags for this clip');
    fireEvent.change(input, { target: { value: 'something else' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('shows the newest search even when an older answer arrives last', async () => {
    let answerOld: (clips: LibraryClip[]) => void = () => {};
    api.search
      .mockReturnValueOnce(new Promise((resolve) => { answerOld = resolve; }))
      .mockResolvedValueOnce([clip({ id: 'new', prompt: 'Landscape answer' })]);
    renderPage();
    await waitFor(() => expect(api.search).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Landscape' }));
    expect(await screen.findByText('Landscape answer')).toBeTruthy();
    answerOld([clip({ id: 'old', prompt: 'Old answer' })]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Old answer')).toBeNull();
  });

  it('asks before deleting, and again when a scene script still uses the clip', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.remove.mockRejectedValueOnce(new ApiError('This clip is used in Be Still.', 'IN_USE', { usedBy: [{ id: 'p', title: 'Be Still' }] }, 409));
    api.remove.mockResolvedValueOnce(undefined);
    renderPage();
    const card = (await screen.findByText('A shepherd boy calls out at sunset')).closest('li') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Delete clip' }));
    await waitFor(() => expect(api.remove).toHaveBeenLastCalledWith('c1', true));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1][0]).toMatch(/Be Still/);
    await waitFor(() => expect(screen.queryByText('A shepherd boy calls out at sunset')).toBeNull());
    confirm.mockRestore();
  });

  it('makes posters for clips that have none, then reloads', async () => {
    api.search.mockResolvedValueOnce([clip({ posterUrl: null })]);
    api.makePosters.mockResolvedValueOnce({ made: 10, failed: 0, remaining: 3 }).mockResolvedValueOnce({ made: 2, failed: 1, remaining: 0 });
    renderPage();
    await waitFor(() => expect(api.makePosters).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.search.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('opens the re-roll panel for a clip, with its price', async () => {
    renderPage();
    const card = (await screen.findByText('A shepherd boy calls out at sunset')).closest('li') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Re-roll from this prompt' }));
    expect(await screen.findByRole('heading', { name: 'Re-roll from this prompt' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Re-roll for $0.64' })).toBeTruthy();
    await waitFor(() => expect(api.rerollPrice).toHaveBeenCalledWith('c1'));
  });

  it('shows a re-roll being made and reloads the library when its clip arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      api.rerolls.mockResolvedValueOnce({ jobs: [job()], month }).mockResolvedValue({ jobs: [job({ status: 'done', clipId: 'c9' })], month });
      renderPage();
      expect(await screen.findByText(/Making a new clip: A shepherd boy at dawn/)).toBeTruthy();
      await waitFor(() => expect(api.search).toHaveBeenCalled());
      const before = api.search.mock.calls.length;
      await vi.advanceTimersByTimeAsync(REROLL_POLL_MS + 50);
      await waitFor(() => expect(api.search.mock.calls.length).toBeGreaterThan(before));
      await waitFor(() => expect(screen.queryByText(/Making a new clip/)).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it('says why a re-roll failed', async () => {
    api.rerolls.mockResolvedValue({ jobs: [job({ status: 'error', error: 'BytePlus declined this prompt. Reword it and try again.' })], month });
    renderPage();
    expect(await screen.findByText(/BytePlus declined this prompt/)).toBeTruthy();
  });

  it('offers to fetch a paid clip again for free, even after an hour', async () => {
    const paid = job({ status: 'error', error: 'The clip was made and paid for but could not be saved.', refetchable: true, createdAt: Date.now() - 5 * 60 * 60 * 1000 });
    api.rerolls.mockResolvedValue({ jobs: [paid], month });
    api.refetchReroll.mockResolvedValue({ ...paid, status: 'generating', refetchable: false });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Fetch it again (free)' }));
    await waitFor(() => expect(api.refetchReroll).toHaveBeenCalledWith('j1'));
    expect(await screen.findByText(/Making a new clip/)).toBeTruthy();
  });

  it('keeps a just-started re-roll when an older list arrives late', async () => {
    let answer: (v: { jobs: RerollJob[]; month: typeof month }) => void = () => {};
    api.rerolls.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    api.reroll.mockResolvedValue(job({ id: 'new', status: 'queued' }));
    renderPage();
    const card = (await screen.findByText('A shepherd boy calls out at sunset')).closest('li') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Re-roll from this prompt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Re-roll for $0.64' }));
    expect(await screen.findByText(/Making a new clip/)).toBeTruthy();
    answer({ jobs: [], month });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText(/Making a new clip/)).toBeTruthy();
  });

  it('adds older Story clips and says how many', async () => {
    api.backfillStory.mockResolvedValueOnce({ added: 10, remaining: 3 }).mockResolvedValueOnce({ added: 3, remaining: 0 });
    renderPage();
    await screen.findByText('A shepherd boy calls out at sunset');
    fireEvent.click(screen.getByRole('button', { name: 'Add older Story clips' }));
    expect(await screen.findByText('Added 13 older Story clips.')).toBeTruthy();
    expect(api.backfillStory).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(api.leads).toHaveBeenCalledTimes(2));
  });
});
