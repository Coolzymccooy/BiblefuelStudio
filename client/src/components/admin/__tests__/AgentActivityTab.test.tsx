import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentActivityTab } from '../AgentActivityTab';
import { api } from '../../../lib/api';
import { adminActivityCsvUrl, defaultFilters } from '../../../lib/adminActivityApi';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');

const BODY = {
  ok: true,
  rows: [
    {
      ts: '2026-10-24T11:00:00.000Z',
      keyId: 'k_1',
      keyName: 'Hermes laptop',
      userId: 'u_1',
      email: 'one@example.com',
      tool: 'render_story',
      ok: false,
      error: 'MCP_CAP_REACHED: Daily renders cap reached',
      ms: 42,
    },
    {
      ts: '2026-10-24T10:00:00.000Z',
      keyId: 'k_2',
      keyName: 'Codex',
      userId: 'u_2',
      email: 'two@example.com',
      tool: 'whoami',
      ok: true,
      error: null,
      ms: 7,
    },
  ],
  counts: {
    byTool: { render_story: { calls: 12, errors: 3 }, whoami: { calls: 5, errors: 0 } },
    byUser: { u_1: { calls: 12, errors: 3 }, u_2: { calls: 5, errors: 0 } },
    emails: { u_1: 'one@example.com', u_2: 'two@example.com' },
  },
  total: 17,
};

const USERS = [
  { id: 'u_1', email: 'one@example.com' },
  { id: 'u_2', email: 'two@example.com' },
];

let getSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  getSpy = vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: BODY });
  vi.spyOn(api, 'getToken').mockReturnValue('admin-session-token');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const lastUrl = () => String(getSpy.mock.calls.at(-1)?.[0]);

describe('AgentActivityTab', () => {
  it('loads the last seven days and renders rows and counts', async () => {
    render(<AgentActivityTab users={USERS} reloadToken={0} />);

    expect(lastUrl()).toBe('/api/admin/agent-activity?from=2026-10-18&to=2026-10-24&limit=200');

    const rows = await screen.findByRole('table', { name: 'Newest agent calls' });
    expect(within(rows).getByText('render_story')).toBeTruthy();
    expect(within(rows).getByText('MCP_CAP_REACHED: Daily renders cap reached')).toBeTruthy();
    expect(within(rows).getByText('Hermes laptop')).toBeTruthy();
    expect(within(rows).getByText('Codex')).toBeTruthy();

    const byTool = screen.getByRole('table', { name: 'Calls per tool' });
    const toolRow = within(byTool).getByText('render_story').closest('tr')!;
    expect(within(toolRow).getByText('12')).toBeTruthy();
    expect(within(toolRow).getByText('3')).toBeTruthy();

    const byUser = screen.getByRole('table', { name: 'Calls per user' });
    const userRow = within(byUser).getByText('two@example.com').closest('tr')!;
    expect(within(userRow).getByText('5')).toBeTruthy();

    expect(screen.getByText('Showing the newest 2 of 17 calls')).toBeTruthy();
  });

  it('labels each user row by email: from the counts, else the known accounts, else the id', async () => {
    getSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        ...BODY,
        counts: {
          ...BODY.counts,
          byUser: { u_1: { calls: 9, errors: 1 }, u_2: { calls: 4, errors: 0 }, u_3: { calls: 2, errors: 0 } },
          emails: { u_1: 'one@example.com', u_2: null, u_3: null },
        },
      },
    });
    render(<AgentActivityTab users={USERS} reloadToken={0} />);
    const byUser = await screen.findByRole('table', { name: 'Calls per user' });
    expect(within(within(byUser).getByText('one@example.com').closest('tr')!).getByText('9')).toBeTruthy();
    expect(within(within(byUser).getByText('two@example.com').closest('tr')!).getByText('4')).toBeTruthy();
    expect(within(within(byUser).getByText('u_3').closest('tr')!).getByText('2')).toBeTruthy();
    expect(within(byUser).queryByText('u_1')).toBeNull();
  });

  it('applies the outcome, user and tool filters', async () => {
    render(<AgentActivityTab users={USERS} reloadToken={0} />);
    await screen.findByRole('table', { name: 'Newest agent calls' });

    await userEvent.selectOptions(screen.getByLabelText('Outcome'), 'false');
    await userEvent.selectOptions(screen.getByLabelText('User'), 'u_1');
    await userEvent.selectOptions(screen.getByLabelText('Tool'), 'render_story');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(lastUrl()).toBe(
      '/api/admin/agent-activity?from=2026-10-18&to=2026-10-24&userId=u_1&tool=render_story&ok=false&limit=200',
    );
  });

  it('exports the applied filters as a CSV with the session token', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['ts\n']) });
    vi.stubGlobal('fetch', fetchSpy);
    const createUrl = vi.fn(() => 'blob:csv');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });

    render(<AgentActivityTab users={USERS} reloadToken={0} />);
    await screen.findByRole('table', { name: 'Newest agent calls' });
    await userEvent.selectOptions(screen.getByLabelText('Outcome'), 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/admin\/agent-activity\?from=2026-10-18&to=2026-10-24&ok=false&format=csv$/);
    expect(init.headers.Authorization).toBe('Bearer admin-session-token');
    expect(createUrl).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('ignores a slow earlier response that arrives after a newer one', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const STALE = {
      ...BODY,
      rows: [{ ...BODY.rows[0], tool: 'stale_tool', keyName: 'Stale key' }],
      counts: { byTool: { stale_tool: { calls: 1, errors: 0 } }, byUser: {}, emails: {} },
      total: 1,
    };
    getSpy.mockReturnValueOnce(first as never);
    const { rerender } = render(<AgentActivityTab users={USERS} reloadToken={0} />);

    // The page's Refresh button bumps reloadToken while the first load is still out.
    rerender(<AgentActivityTab users={USERS} reloadToken={1} />);
    const rows = await screen.findByRole('table', { name: 'Newest agent calls' });
    expect(within(rows).getByText('Hermes laptop')).toBeTruthy();

    resolveFirst({ ok: true, status: 200, data: STALE });
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const after = screen.getByRole('table', { name: 'Newest agent calls' });
    expect(within(after).queryByText('Stale key')).toBeNull();
    expect(within(after).getByText('Hermes laptop')).toBeTruthy();
    expect(screen.getByText('Showing the newest 2 of 17 calls')).toBeTruthy();
  });

  it('shows the error and the empty state', async () => {
    getSpy.mockResolvedValueOnce({ ok: false, status: 400, error: 'RANGE_TOO_LONG', data: { hint: 'Pick at most 31 days.' } });
    render(<AgentActivityTab users={USERS} reloadToken={0} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Pick at most 31 days.');

    getSpy.mockResolvedValueOnce({ ok: true, status: 200, data: { ok: true, rows: [], counts: { byTool: {}, byUser: {} }, total: 0 } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByText('No agent calls match these filters.')).toBeTruthy();
  });
});

describe('adminActivityCsvUrl', () => {
  it('carries every set filter and format=csv', () => {
    const filters = { ...defaultFilters(NOW), userId: 'u_2', tool: 'whoami', ok: 'true' as const };
    expect(adminActivityCsvUrl(filters)).toBe(
      '/api/admin/agent-activity?from=2026-10-18&to=2026-10-24&userId=u_2&tool=whoami&ok=true&format=csv',
    );
  });
});
