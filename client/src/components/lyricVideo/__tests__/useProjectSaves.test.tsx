import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProjectSaves } from '../useProjectSaves';
import type { LyricProject } from '../../../lib/lyricVideoTypes';

const p = (seed: number) => ({ projectId: 'lv_1', look: { seed } }) as unknown as LyricProject;
const later = (ms: number, value: LyricProject) => new Promise<LyricProject>((r) => setTimeout(() => r(value), ms));

describe('useProjectSaves', () => {
  it('starts each write only when the one before has answered, and files the replies in order', async () => {
    const onChange = vi.fn();
    const started: number[] = [];
    const { result } = renderHook(() => useProjectSaves(onChange));
    const first = result.current(() => { started.push(1); return later(30, p(1)); });
    const second = result.current(() => { started.push(2); return later(0, p(2)); });
    await Promise.resolve();
    expect(started).toEqual([1]);
    await expect(first).resolves.toEqual(p(1));
    await expect(second).resolves.toEqual(p(2));
    expect(started).toEqual([1, 2]);
    expect(onChange.mock.calls.map(([x]) => x.look.seed)).toEqual([1, 2]);
  });

  it('a failed write rejects for its caller and the next write still runs', async () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useProjectSaves(onChange));
    const bad = result.current(() => Promise.reject(new Error('Could not save that.')));
    const good = result.current(() => later(0, p(3)));
    await expect(bad).rejects.toThrow('Could not save that.');
    await expect(good).resolves.toEqual(p(3));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(p(3));
  });

  it('files replies with the newest onChange it was given', async () => {
    const old = vi.fn();
    const fresh = vi.fn();
    const { result, rerender } = renderHook(({ cb }) => useProjectSaves(cb), { initialProps: { cb: old } });
    const save = result.current;
    rerender({ cb: fresh });
    await save(() => later(0, p(4)));
    expect(old).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledWith(p(4));
    expect(result.current).toBe(save);
  });
});
