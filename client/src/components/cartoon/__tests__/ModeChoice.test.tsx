import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../lib/errors', () => ({ toastError: vi.fn() }));
vi.mock('../../../lib/sceneScriptApi', () => ({ sceneScriptApi: { list: vi.fn() } }));
vi.mock('../../../lib/cartoonApi', () => ({ cartoonApi: { list: vi.fn() } }));

import { sceneScriptApi } from '../../../lib/sceneScriptApi';
import { cartoonApi } from '../../../lib/cartoonApi';
import { useAuth } from '../../../hooks/useAuth';
import { SceneScriptPage } from '../../../pages/SceneScriptPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/scene-script']}>
      <Routes>
        <Route path="/app/scene-script" element={<SceneScriptPage />} />
        <Route path="/app/scene-script/cartoon/new" element={<p>Cartoon journey</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ModeChoice on the Scene script page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.setState({ isSuperAdmin: true });
    vi.mocked(sceneScriptApi.list).mockResolvedValue([]);
    vi.mocked(cartoonApi.list).mockResolvedValue([]);
  });
  afterEach(() => useAuth.setState({ isSuperAdmin: false }));

  it('choosing Cartoon opens the cartoon journey', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^Cartoon/ }));
    expect(await screen.findByText('Cartoon journey')).toBeInTheDocument();
  });

  it('choosing Human shows today\'s paste flow', () => {
    renderPage();
    expect(screen.queryByRole('textbox', { name: 'Your script' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Human/ }));
    expect(screen.getByRole('textbox', { name: 'Your script' })).toBeInTheDocument();
  });

  it('lists cartoons beside scene scripts, newest first, with a Cartoon tag', async () => {
    vi.mocked(sceneScriptApi.list).mockResolvedValue([{ id: 'h1', title: 'Older human', updatedAt: 100, renderStatus: 'idle' }]);
    vi.mocked(cartoonApi.list).mockResolvedValue([{ id: 'c1', title: 'Newer cartoon', updatedAt: 200, renderStatus: 'idle', mode: 'cartoon' }]);
    renderPage();
    const list = await screen.findByRole('list', { name: 'Your scene scripts' });
    await within(list).findByText('Older human');
    const links = within(list).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/app/scene-script/cartoon/c1', '/app/scene-script/h1']);
    expect(within(links[0]).getByText('Cartoon')).toBeInTheDocument();
    expect(within(links[1]).queryByText('Cartoon')).not.toBeInTheDocument();
  });

  it('a failed list does not hide the other one', async () => {
    vi.mocked(sceneScriptApi.list).mockRejectedValue(new Error('Could not load scene scripts'));
    vi.mocked(cartoonApi.list).mockResolvedValue([{ id: 'c1', title: 'Still here', updatedAt: 200, renderStatus: 'idle', mode: 'cartoon' }]);
    renderPage();
    expect(await screen.findByText('Still here')).toBeInTheDocument();
  });
});
