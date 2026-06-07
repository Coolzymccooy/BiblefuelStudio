import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { storyApi } from '../../lib/storyApi';
import { useStoryProjects } from '../useStoryProjects';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => vi.restoreAllMocks());

describe('useStoryProjects', () => {
  it('returns the list of project summaries', async () => {
    vi.spyOn(storyApi, 'listProjects').mockResolvedValue([
      { projectId: 'a', title: 'A', status: 'done', style: 'cinematic-bible', updatedAt: 2 },
    ] as any);
    const { result } = renderHook(() => useStoryProjects(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(result.current.data?.[0].projectId).toBe('a');
  });
});
