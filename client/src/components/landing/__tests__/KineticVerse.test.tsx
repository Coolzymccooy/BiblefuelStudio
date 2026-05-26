import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { KineticVerse } from '../KineticVerse';

describe('KineticVerse', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders every word of the first verse on mount', () => {
    render(<KineticVerse cycle={false} />);
    // First verse defaults to John 1:1
    expect(screen.getByText(/John 1:1/i)).toBeInTheDocument();
    expect(screen.getByText(/In/)).toBeInTheDocument();
    expect(screen.getByText(/beginning/)).toBeInTheDocument();
    expect(screen.getByText(/Word,/)).toBeInTheDocument();
  });

  it('does not advance when cycle=false', async () => {
    render(<KineticVerse cycle={false} holdMs={500} />);
    vi.advanceTimersByTime(3000);
    expect(screen.getByText(/John 1:1/i)).toBeInTheDocument();
    expect(screen.queryByText(/Psalm 119:105/i)).not.toBeInTheDocument();
  });
});

describe('KineticVerse cycling', () => {
  it('advances to the next verse after the hold elapses', () => {
    vi.useFakeTimers();
    const verses = [
      { ref: 'ALPHA 1:1', lines: [['alpha']] },
      { ref: 'BETA 2:2', lines: [['beta']] },
    ];
    render(<KineticVerse verses={verses} cycle={true} holdMs={200} staggerMs={100} wordDurationMs={100} />);
    expect(screen.getByText(/ALPHA 1:1/)).toBeInTheDocument();
    expect(screen.queryByText(/BETA 2:2/)).not.toBeInTheDocument();

    // wordCount=1 × stagger 100 + wordDuration 100 = revealMs=200; +hold 200 = 400ms.
    act(() => {
      vi.advanceTimersByTime(450);
    });
    // After advancing past the total reveal + hold time, BETA verse should be present.
    expect(screen.getByText(/BETA 2:2/)).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe('KineticVerse reduced motion', () => {
  // Override matchMedia for this block.
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = (q: string) => ({
      matches: q.includes('reduce'),
      media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  });
  afterEach(() => { window.matchMedia = originalMatchMedia; });

  it('renders verse[0] static and does not advance', async () => {
    vi.useFakeTimers();
    const verses = [
      { ref: 'ALPHA 1:1', lines: [['alpha']] },
      { ref: 'BETA 2:2', lines: [['beta']] },
    ];
    render(<KineticVerse verses={verses} cycle={true} holdMs={100} />);
    await vi.advanceTimersByTimeAsync(2000);
    expect(screen.getByText(/ALPHA 1:1/)).toBeInTheDocument();
    expect(screen.queryByText(/BETA 2:2/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
