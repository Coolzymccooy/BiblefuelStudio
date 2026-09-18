import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimelineScale } from './useTimelineScale';

// The hook's ONLY job beyond computeScale (tested separately) is measuring the
// container and re-measuring when it changes. computeScale is already proven,
// so these tests pin the measurement contract: what the scale is before the
// first measurement, that a resize is picked up, and that the observer is
// disconnected on unmount.

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element) { this.observed.push(el); }
  unobserve() { /* not used */ }
  disconnect() { this.disconnected = true; }
  /** Drive a resize the way the browser would. */
  emit(width: number) {
    this.cb(
      [{ contentRect: { width } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Props { durationSec: number; zoom: number }

/**
 * Mount the hook with its ref already attached to a real element.
 *
 * React assigns refs during render, BEFORE effects run, so a test that sets
 * ref.current after mounting never triggers the measuring effect — the ref
 * has to be populated by the render itself. jsdom reports 0 for every
 * getBoundingClientRect, which is exactly the pre-layout case the hook has to
 * survive, so the width arrives through the observer instead.
 */
function mountWithElement(initialProps: Props) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return renderHook(
    (props: Props) => {
      const r = useTimelineScale(props);
      r.ref.current = el; // as <div ref={r.ref}> would
      return r;
    },
    { initialProps },
  );
}

/** The observer the hook constructed for the mounted element. */
function observer() {
  const o = FakeResizeObserver.instances[0];
  if (!o) throw new Error('the hook never observed its container');
  return o;
}

describe('useTimelineScale', () => {
  it('returns a usable scale before the container has ever been measured', () => {
    // First paint happens before the ResizeObserver fires. A NaN pxPerSecond
    // here would blank the whole timeline, so the floor in computeScale must
    // carry through the hook.
    const { result } = renderHook(() => useTimelineScale({ durationSec: 270, zoom: 1 }));
    expect(Number.isFinite(result.current.scale.pxPerSecond)).toBe(true);
    expect(result.current.scale.pxPerSecond).toBeGreaterThan(0);
    expect(result.current.scale.ticks.length).toBeGreaterThan(0);
  });

  it('recomputes the scale when the container is measured', () => {
    const { result } = mountWithElement({ durationSec: 270, zoom: 1 });
    act(() => { observer().emit(1080); });

    // 270s across 1080px at zoom 1 = exactly 4px per second.
    expect(result.current.scale.pxPerSecond).toBeCloseTo(4, 3);
    expect(result.current.scale.contentWidth).toBeCloseTo(1080, 0);
    expect(result.current.containerWidth).toBe(1080);
  });

  it('follows a later resize — the strip is user-resizable', () => {
    const { result } = mountWithElement({ durationSec: 270, zoom: 1 });

    act(() => { observer().emit(1080); });
    expect(result.current.scale.pxPerSecond).toBeCloseTo(4, 3);

    act(() => { observer().emit(2160); });
    expect(result.current.scale.pxPerSecond).toBeCloseTo(8, 3);
  });

  it('responds to a zoom change without needing a resize', () => {
    const { result, rerender } = mountWithElement({ durationSec: 270, zoom: 1 });
    act(() => { observer().emit(1080); });
    expect(result.current.scale.pxPerSecond).toBeCloseTo(4, 3);

    rerender({ durationSec: 270, zoom: 2 });
    expect(result.current.scale.pxPerSecond).toBeCloseTo(8, 3);
  });

  it('responds to a duration change — clips get added while the editor is open', () => {
    const { result, rerender } = mountWithElement({ durationSec: 270, zoom: 1 });
    act(() => { observer().emit(1080); });
    expect(result.current.scale.pxPerSecond).toBeCloseTo(4, 3);

    rerender({ durationSec: 540, zoom: 1 });
    expect(result.current.scale.pxPerSecond).toBeCloseTo(2, 3);
  });

  it('disconnects the observer on unmount', () => {
    const { unmount } = mountWithElement({ durationSec: 270, zoom: 1 });
    expect(observer().disconnected).toBe(false);

    unmount();
    expect(observer().disconnected).toBe(true);
  });

  it('survives an environment with no ResizeObserver', () => {
    // Older Safari and the SSR/test path have none. The timeline must still
    // render at the fallback width rather than throwing on construction.
    vi.stubGlobal('ResizeObserver', undefined);
    const { result } = mountWithElement({ durationSec: 270, zoom: 1 });
    expect(Number.isFinite(result.current.scale.pxPerSecond)).toBe(true);
    expect(result.current.scale.pxPerSecond).toBeGreaterThan(0);
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });
});
