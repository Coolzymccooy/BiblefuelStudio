import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
