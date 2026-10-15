import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { storyApi } from '../../lib/storyApi';
import { useAnimateEstimate } from '../useAnimateEstimate';
import type { AnimateEstimate, StoryProject } from '../../lib/storyTypes';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function est(usd: number): AnimateEstimate {
  return {
    configured: true, quality: 'standard', running: false, clips: 2, seconds: 20, usd, usdPerSecond: 0.0756,
    model: 'm', resolution: '720p', sceneIds: [], month: '2026-10',
    spentUsd: 0, reservedUsd: 0, capUsd: 30, monthClips: 0,
  };
}

function project(projectId: string, aiVideoStatus?: string): StoryProject {
  return { projectId, scenes: [{ id: 's1', imageStatus: 'ready', aiVideoStatus }] } as unknown as StoryProject;
}

beforeEach(() => vi.restoreAllMocks());

describe('useAnimateEstimate', () => {
  it('keeps the last estimate on screen while a changed scene state is re-priced', async () => {
    let release: (e: AnimateEstimate) => void = () => {};
    const spy = vi.spyOn(storyApi, 'estimateAnimation')
      .mockResolvedValueOnce(est(1))
      .mockImplementationOnce(() => new Promise<AnimateEstimate>((r) => { release = r; }));

    const { result, rerender } = renderHook(
      ({ p }: { p: StoryProject }) => useAnimateEstimate(p, 'standard', true),
      { wrapper: wrapper(), initialProps: { p: project('p1') } },
    );
    await waitFor(() => expect(result.current.data?.usd).toBe(1));

    rerender({ p: project('p1', 'generating') });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(result.current.data?.usd).toBe(1);
    expect(result.current.isPlaceholderData).toBe(true);

    release(est(2));
    await waitFor(() => expect(result.current.data?.usd).toBe(2));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it('keeps the last estimate while the quality is switched', async () => {
    let release: (e: AnimateEstimate) => void = () => {};
    vi.spyOn(storyApi, 'estimateAnimation')
      .mockResolvedValueOnce(est(1))
      .mockImplementationOnce(() => new Promise<AnimateEstimate>((r) => { release = r; }));

    const p = project('p1');
    const { result, rerender } = renderHook(
      ({ q }: { q: 'standard' | 'high' }) => useAnimateEstimate(p, q, true),
      { wrapper: wrapper(), initialProps: { q: 'standard' as 'standard' | 'high' } },
    );
    await waitFor(() => expect(result.current.data?.usd).toBe(1));

    rerender({ q: 'high' });
    expect(result.current.data?.usd).toBe(1);
    release(est(3));
    await waitFor(() => expect(result.current.data?.usd).toBe(3));
  });

  it('never shows another project\'s figures', async () => {
    vi.spyOn(storyApi, 'estimateAnimation')
      .mockResolvedValueOnce(est(1))
      .mockImplementationOnce(() => new Promise<AnimateEstimate>(() => {}));

    const { result, rerender } = renderHook(
      ({ p }: { p: StoryProject }) => useAnimateEstimate(p, 'standard', true),
      { wrapper: wrapper(), initialProps: { p: project('p1') } },
    );
    await waitFor(() => expect(result.current.data?.usd).toBe(1));

    rerender({ p: project('p2') });
    expect(result.current.data).toBeUndefined();
  });
});
