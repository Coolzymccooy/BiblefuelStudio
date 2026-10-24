import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { ConnectedAgentsCard } from '../ConnectedAgentsCard';
import * as keysApi from '../../lib/agentKeysApi';
import type { AgentKey } from '../../lib/agentKeysApi';

vi.mock('../../lib/agentKeysApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/agentKeysApi')>();
  return {
    ...actual,
    listAgentKeys: vi.fn(),
    createAgentKey: vi.fn(),
    updateAgentKey: vi.fn(),
    revokeAgentKey: vi.fn(),
    listAgentActivity: vi.fn(),
    downloadActivityCsv: vi.fn(),
  };
});

const api = vi.mocked(keysApi);
const ENDPOINT = 'https://studio.example.test/api/mcp';
const CEILINGS = { renders: 10, aiVideoUsd: 2, images: 30, tts: 30, publishes: 3, imports: 20 };
const PLAIN = 'bfk_live_9f3a1c77d2e84b5a';

function makeKey(over: Partial<AgentKey> = {}): AgentKey {
  return {
    id: 'key_1',
    name: 'Hermes laptop',
    prefix: 'bfk_9f3a',
    createdAt: '2026-10-20T10:00:00.000Z',
    lastUsedAt: null,
    publishAllowed: false,
    caps: CEILINGS,
    usage: {
      renders: { used: 3, limit: 10, remaining: 7 },
      aiVideoUsd: { used: 0.5, limit: 2, remaining: 1.5 },
      images: { used: 0, limit: 30, remaining: 30 },
      tts: { used: 1, limit: 30, remaining: 29 },
      publishes: { used: 0, limit: 3, remaining: 3 },
      imports: { used: 2, limit: 20, remaining: 18 },
    },
    ...over,
  };
}

function serve(keys: AgentKey[]) {
  api.listAgentKeys.mockResolvedValue({ endpoint: ENDPOINT, ceilings: CEILINGS, keys });
}

beforeEach(() => {
  vi.resetAllMocks();
  api.listAgentActivity.mockResolvedValue([]);
});

describe('ConnectedAgentsCard', () => {
  it('creates a key and shows it once', async () => {
    const created = makeKey({ id: 'key_new', name: 'Codex desktop', prefix: 'bfk_c0de' });
    api.listAgentKeys
      .mockResolvedValueOnce({ endpoint: ENDPOINT, ceilings: CEILINGS, keys: [] })
      .mockResolvedValue({ endpoint: ENDPOINT, ceilings: CEILINGS, keys: [created] });
    api.createAgentKey.mockResolvedValue({ key: created, plain: PLAIN });
    render(<ConnectedAgentsCard />);

    await userEvent.click(await screen.findByRole('button', { name: 'Create key' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Key name'), 'Codex desktop');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(api.createAgentKey).toHaveBeenCalledWith('Codex desktop');
    const shown = await within(dialog).findByLabelText('Your new key');
    expect((shown as HTMLInputElement).value).toBe(PLAIN);
    expect((shown as HTMLInputElement).readOnly).toBe(true);
    expect(document.activeElement).toBe(shown);
    expect(within(dialog).getByText('Copy it now. It will not be shown again.')).toBeTruthy();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByDisplayValue(PLAIN)).toBeNull();
    expect(document.body.textContent).not.toContain(PLAIN);
    expect(await screen.findByText('Codex desktop')).toBeTruthy();
    expect(screen.getByText('bfk_c0de')).toBeTruthy();
  });

  it('opens a labelled modal dialog that closes on Escape and gives focus back', async () => {
    serve([]);
    render(<ConnectedAgentsCard />);

    const opener = await screen.findByRole('button', { name: 'Create key' });
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Create an agent key' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(within(dialog).getByLabelText('Key name'));

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('toggles publish consent', async () => {
    serve([makeKey()]);
    api.updateAgentKey.mockResolvedValue(makeKey({ publishAllowed: true }));
    render(<ConnectedAgentsCard />);

    const toggle = await screen.findByRole('switch', { name: 'This key may publish' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('The agent will post to your connected accounts as you.')).toBeTruthy();

    await userEvent.click(toggle);

    expect(api.updateAgentKey).toHaveBeenCalledWith('key_1', { publishAllowed: true });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  });

  it('puts the switch back and says why when saving consent fails', async () => {
    serve([makeKey()]);
    api.updateAgentKey.mockRejectedValue(new Error('Could not save'));
    const fail = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
    render(<ConnectedAgentsCard />);

    const toggle = await screen.findByRole('switch', { name: 'This key may publish' });
    await userEvent.click(toggle);

    await waitFor(() => expect(fail).toHaveBeenCalledWith('Could not save'));
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });

  it('revokes after confirm', async () => {
    serve([makeKey()]);
    api.revokeAgentKey.mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ConnectedAgentsCard />);

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Hermes laptop' }));

    expect(confirm).toHaveBeenCalledWith('Revoke "Hermes laptop"? Agents using it stop working immediately.');
    expect(api.revokeAgentKey).toHaveBeenCalledWith('key_1');
    await waitFor(() => expect(screen.queryByText('Hermes laptop')).toBeNull());
  });

  it('keeps the key when the confirm is declined', async () => {
    serve([makeKey()]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ConnectedAgentsCard />);

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke Hermes laptop' }));

    expect(api.revokeAgentKey).not.toHaveBeenCalled();
    expect(screen.getByText('Hermes laptop')).toBeTruthy();
  });

  it('never renders a real key in the snippets', async () => {
    const created = makeKey({ id: 'key_new', name: 'Codex desktop' });
    serve([]);
    api.createAgentKey.mockResolvedValue({ key: created, plain: PLAIN });
    const { container } = render(<ConnectedAgentsCard />);

    await userEvent.click(await screen.findByRole('button', { name: 'Create key' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Key name'), 'Codex desktop');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await within(dialog).findByLabelText('Your new key');

    const snippets = Array.from(container.querySelectorAll('pre')).map((el) => el.textContent ?? '');
    expect(snippets).toHaveLength(3);
    expect(snippets.some((s) => s.includes('<your key>'))).toBe(true);
    for (const text of snippets) {
      expect(text).not.toContain(PLAIN);
      expect(text).toContain(ENDPOINT);
    }
    expect(screen.getAllByRole('button', { name: /^Copy .*(snippet|endpoint)/i }).length).toBeGreaterThanOrEqual(4);
  });

  it('shows cap usage per bucket', async () => {
    serve([makeKey()]);
    render(<ConnectedAgentsCard />);

    expect(await screen.findByText('3 / 10')).toBeTruthy();
    expect(screen.getByText('Renders')).toBeTruthy();
    expect(screen.getByText('AI video ($)')).toBeTruthy();
    expect(screen.getByText('0.50 / 2.00')).toBeTruthy();
    expect(screen.getByText('Publishes')).toBeTruthy();
    expect(screen.getByText('0 / 3')).toBeTruthy();
  });

  it('explains what a key is when there are none', async () => {
    serve([]);
    render(<ConnectedAgentsCard />);
    expect(await screen.findByText(/Help → Connect an agent/)).toBeTruthy();
  });

  it('says so when the keys will not load', async () => {
    api.listAgentKeys.mockRejectedValue(new Error('Server unavailable'));
    const fail = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
    render(<ConnectedAgentsCard />);
    expect(await screen.findByText('Server unavailable')).toBeTruthy();
    expect(fail).toHaveBeenCalledWith('Server unavailable');
  });

  it('loads recent activity only when opened', async () => {
    serve([makeKey()]);
    api.listAgentActivity.mockResolvedValue([
      { ts: new Date().toISOString(), keyId: 'key_1', keyName: 'Hermes laptop', tool: 'render_story', ok: true, error: null },
      { ts: new Date().toISOString(), keyId: 'key_1', keyName: null, tool: 'key:publish_on', ok: true, error: null },
      { ts: new Date().toISOString(), keyId: 'key_1', keyName: 'Hermes laptop', tool: 'publish', ok: false, error: 'CAP_REACHED' },
    ]);
    render(<ConnectedAgentsCard />);
    const toggle = await screen.findByRole('button', { name: /recent activity/i });
    expect(api.listAgentActivity).not.toHaveBeenCalled();

    await userEvent.click(toggle);

    expect(api.listAgentActivity).toHaveBeenCalledWith({ limit: 50 });
    expect(await screen.findByText('render_story')).toBeTruthy();
    expect(screen.getByText('Publishing allowed')).toBeTruthy();
    expect(screen.getByText('CAP_REACHED')).toBeTruthy();
  });

  it('exports the activity log as a CSV file', async () => {
    serve([makeKey()]);
    api.downloadActivityCsv.mockResolvedValue(new Blob(['ts,tool\n']));
    const url = vi.fn(() => 'blob:csv');
    Object.assign(URL, { createObjectURL: url, revokeObjectURL: vi.fn() });
    const saved = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ConnectedAgentsCard />);

    await userEvent.click(await screen.findByRole('button', { name: /recent activity/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(api.downloadActivityCsv).toHaveBeenCalled());
    await waitFor(() => expect(url).toHaveBeenCalled());
    await waitFor(() => expect(saved).toHaveBeenCalled());
  });

  describe('daily limits', () => {
    async function openLimits() {
      await userEvent.click(await screen.findByRole('button', { name: 'Daily limits' }));
      return screen.getByRole('form', { name: 'Daily limits for Hermes laptop' });
    }

    it('prefills each bucket with the effective limit, bounded by the ceiling', async () => {
      serve([makeKey({ caps: { renders: 4, images: 99 } })]);
      render(<ConnectedAgentsCard />);
      const form = await openLimits();

      const renders = within(form).getByLabelText('Renders') as HTMLInputElement;
      expect(renders.value).toBe('4');
      expect(renders.min).toBe('0');
      expect(renders.max).toBe('10');
      expect(renders.step).toBe('1');
      expect((within(form).getByLabelText('Images') as HTMLInputElement).value).toBe('30');
      const usd = within(form).getByLabelText('AI video ($)') as HTMLInputElement;
      expect(usd.value).toBe('2');
      expect(usd.step).toBe('0.01');
      expect(usd.max).toBe('2');
      expect(within(form).getByLabelText('Voice (TTS)')).toBeTruthy();
      expect(within(form).getByLabelText('Publishes')).toBeTruthy();
      expect((within(form).getByLabelText('Imports') as HTMLInputElement).value).toBe('20');
    });

    it('saves only the changed bucket and shows what the server kept', async () => {
      serve([makeKey()]);
      api.updateAgentKey.mockResolvedValue(makeKey({ caps: { renders: 5 }, usage: undefined }));
      render(<ConnectedAgentsCard />);
      const form = await openLimits();

      const renders = within(form).getByLabelText('Renders') as HTMLInputElement;
      await userEvent.clear(renders);
      await userEvent.type(renders, '5');
      await userEvent.click(within(form).getByRole('button', { name: 'Save limits' }));

      expect(api.updateAgentKey).toHaveBeenCalledWith('key_1', { caps: { renders: 5 } });
      expect(await within(form).findByText('Limits saved.')).toBeTruthy();
      expect(renders.value).toBe('5');
      // Today's use is re-read against the new limit without a reload.
      expect(screen.getByText('3 / 5')).toBeTruthy();
    });

    it('never sends a value above the ceiling', async () => {
      serve([makeKey({ caps: { renders: 4 } })]);
      api.updateAgentKey.mockResolvedValue(makeKey({ caps: { renders: 10 } }));
      render(<ConnectedAgentsCard />);
      const form = await openLimits();

      const renders = within(form).getByLabelText('Renders') as HTMLInputElement;
      await userEvent.clear(renders);
      await userEvent.type(renders, '50');
      await userEvent.click(within(form).getByRole('button', { name: 'Save limits' }));

      expect(api.updateAgentKey).toHaveBeenCalledWith('key_1', { caps: { renders: 10 } });
      await waitFor(() => expect(renders.value).toBe('10'));
    });

    it('refuses a blank or negative value without calling the server', async () => {
      serve([makeKey()]);
      render(<ConnectedAgentsCard />);
      const form = await openLimits();

      await userEvent.clear(within(form).getByLabelText('Images'));
      await userEvent.click(within(form).getByRole('button', { name: 'Save limits' }));

      expect(within(form).getByRole('alert').textContent).toBe('Images: enter a number of 0 or more.');
      expect(api.updateAgentKey).not.toHaveBeenCalled();
    });

    it('says why when the save fails', async () => {
      serve([makeKey()]);
      api.updateAgentKey.mockRejectedValue(new Error('Caps must be numbers of 0 or more.'));
      render(<ConnectedAgentsCard />);
      const form = await openLimits();

      const tts = within(form).getByLabelText('Voice (TTS)');
      await userEvent.clear(tts);
      await userEvent.type(tts, '7');
      await userEvent.click(within(form).getByRole('button', { name: 'Save limits' }));

      expect((await within(form).findByRole('alert')).textContent).toBe('Caps must be numbers of 0 or more.');
    });
  });
});
