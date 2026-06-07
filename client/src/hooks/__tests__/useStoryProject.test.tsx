import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { storyApi } from '../../lib/storyApi';
import { useStoryProject } from '../useStoryProject';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => vi.restoreAllMocks());

describe('useStoryProject', () => {
  it('returns the fetched project', async () => {
    vi.spyOn(storyApi, 'getProject').mockResolvedValue({ projectId: 'p', status: 'ready_to_render', scenes: [] } as any);
    const { result } = renderHook(() => useStoryProject('p'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.projectId).toBe('p'));
  });

  it('is disabled when id is null', async () => {
    const spy = vi.spyOn(storyApi, 'getProject').mockResolvedValue({} as any);
    renderHook(() => useStoryProject(null), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });
});
