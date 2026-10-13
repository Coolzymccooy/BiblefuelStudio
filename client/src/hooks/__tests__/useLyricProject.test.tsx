import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { useLyricProject } from '../useLyricProject';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

const withTiming = (status: string) => ({ projectId: 'lv_1', title: 'T', lines: [], timing: { status } }) as never;

/** The interval the hook asked react-query for, given what it has fetched so far. */
function pollInterval(qc: QueryClient, id: string): unknown {
  const query = qc.getQueryCache().find({ queryKey: ['lyric-project', id] });
  const option = query?.observers[0]?.options.refetchInterval;
  return typeof option === 'function' ? option(query as never) : option;
}

beforeEach(() => vi.restoreAllMocks());

describe('useLyricProject', () => {
  it('returns the fetched project', async () => {
    vi.spyOn(lyricVideoApi, 'get').mockResolvedValue(withTiming('idle'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useLyricProject('lv_1'), { wrapper });
    await waitFor(() => expect(result.current.data?.projectId).toBe('lv_1'));
    expect(lyricVideoApi.get).toHaveBeenCalledWith('lv_1');
  });

  it('is disabled when there is no id', async () => {
    const spy = vi.spyOn(lyricVideoApi, 'get').mockResolvedValue(withTiming('idle'));
    const { wrapper } = setup();
    renderHook(() => useLyricProject(null), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });

  it('polls every 2 seconds while timing runs', async () => {
    vi.spyOn(lyricVideoApi, 'get').mockResolvedValue(withTiming('running'));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useLyricProject('lv_1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(pollInterval(qc, 'lv_1')).toBe(2000);
  });

  it.each(['idle', 'done', 'error'])('does not poll when timing is %s', async (status) => {
    vi.spyOn(lyricVideoApi, 'get').mockResolvedValue(withTiming(status));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useLyricProject('lv_1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(pollInterval(qc, 'lv_1')).toBe(false);
  });

  it('stops polling once the fetch has failed', async () => {
    vi.spyOn(lyricVideoApi, 'get').mockRejectedValue(new Error('Network Error'));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useLyricProject('lv_1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(pollInterval(qc, 'lv_1')).toBe(false);
  });

  it('stops polling after a failed refresh even though the last good copy was still running', async () => {
    const get = vi.spyOn(lyricVideoApi, 'get').mockResolvedValueOnce(withTiming('running'));
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useLyricProject('lv_1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(pollInterval(qc, 'lv_1')).toBe(2000);
    get.mockRejectedValue(new Error('Network Error'));
    let refreshed: Awaited<ReturnType<typeof result.current.refetch>> | undefined;
    await act(async () => { refreshed = await result.current.refetch(); });
    expect(refreshed?.isError).toBe(true);
    expect(refreshed?.data?.timing.status).toBe('running');
    expect(pollInterval(qc, 'lv_1')).toBe(false);
  });
});
