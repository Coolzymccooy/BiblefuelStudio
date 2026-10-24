import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../lib/errors', () => ({ toastError: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn() } }));
vi.mock('../../../lib/cartoonApi', () => ({
  cartoonApi: {
    get: vi.fn(),
    remove: vi.fn(),
    examples: vi.fn(),
    styles: vi.fn(),
    parse: vi.fn(),
    shelf: vi.fn(),
  },
}));

import { cartoonApi } from '../../../lib/cartoonApi';
import { ApiError } from '../../../lib/apiError';
import { toastError } from '../../../lib/errors';
import { useAuth } from '../../../hooks/useAuth';
import type { CartoonProject } from '../../../lib/cartoonTypes';
import { CartoonPage } from '../../../pages/CartoonPage';

function project(over: Partial<CartoonProject> = {}): CartoonProject {
  return {
    id: 'c1',
    mode: 'cartoon',
    meta: { title: 'The Lost Lamb', verse: { reference: 'Luke 15:4', text: '' }, aspect: 'portrait', style: 'family3d' },
    source: { markdown: '# The Lost Lamb', ignored: [], warnings: [] },
    cast: { Eli: { name: 'Eli', look: 'a boy', voice: '', portrait: null, approved: false, shelfId: null } },
    scenes: [{ id: 'a', place: 'Hillside', note: '' }],
    shots: [{ id: 'sh1', sceneId: 'a', speaker: 'Eli', line: 'Pip?', action: null, note: '', seconds: 4, firstFrame: 'fresh', clip: null }],
    shotListApproved: false,
    check: { storySec: 4, filmSec: 9.5, ok: true, overBySec: 0, trimScene: null, tooLong: [], tooMany: false },
    estimate: { clips: 1, refetch: 0, seconds: 4, usd: 0.4, images: 1, imageUsd: 0.04, spentUsd: 0, totalUsd: 0.4, benchmarkUsd: 10, overBenchmark: false, shotIds: ['sh1'] },
    running: { pictures: false, film: false, render: false },
    blockers: [],
    render: { status: 'idle' },
    renderBlockers: [],
    renderWarnings: [],
    ...over,
  } as unknown as CartoonProject;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/scene-script/cartoon/c1']}>
      <Routes>
        <Route path="/app/scene-script/cartoon/:id" element={<CartoonPage />} />
        <Route path="/app/scene-script" element={<p>All scene scripts list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CartoonPage', () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.setState({ isSuperAdmin: true });
    Element.prototype.scrollIntoView = scrollIntoView;
    vi.mocked(cartoonApi.get).mockResolvedValue({ project: project(), month: { spentUsd: 0, capUsd: 50 }, seedance: true });
    vi.mocked(cartoonApi.examples).mockResolvedValue({ examples: [], placeholder: '' });
    vi.mocked(cartoonApi.styles).mockResolvedValue({ styles: [], defaultStyle: 'family3d' });
    vi.mocked(cartoonApi.shelf).mockResolvedValue([]);
  });
  afterEach(() => { useAuth.setState({ isSuperAdmin: false }); vi.restoreAllMocks(); });

  it('Delete asks first, removes the cartoon and goes back to the list', async () => {
    vi.mocked(cartoonApi.remove).mockResolvedValue();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPage();
    const remove = await screen.findByRole('button', { name: 'Delete cartoon' });
    fireEvent.click(remove);
    expect(confirm).toHaveBeenCalledWith('Delete this cartoon? Its clips stay in your visual library.');
    expect(cartoonApi.remove).not.toHaveBeenCalled();
    fireEvent.click(remove);
    await waitFor(() => expect(cartoonApi.remove).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText('All scene scripts list')).toBeInTheDocument();
  });

  it('Delete is off while something runs, and a BUSY answer is shown, not swallowed', async () => {
    vi.mocked(cartoonApi.get).mockResolvedValueOnce({ project: project({ running: { pictures: false, film: true, render: false } }), month: { spentUsd: 0, capUsd: 50 }, seedance: true });
    const { unmount } = renderPage();
    expect(await screen.findByRole('button', { name: 'Delete cartoon' })).toBeDisabled();
    unmount();

    const busy = new ApiError('Stop the running step before deleting this cartoon.', 'BUSY', {}, 409);
    vi.mocked(cartoonApi.remove).mockRejectedValue(busy);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete cartoon' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(busy));
    expect(screen.queryByText('All scene scripts list')).not.toBeInTheDocument();
  });

  it('moving to another step scrolls to the top of that step', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Delete cartoon' });
    expect(scrollIntoView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Script/ }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: 'start' });
  });
});
