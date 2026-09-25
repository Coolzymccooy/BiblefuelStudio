import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AmbientCaptionsPanel } from '../AmbientCaptionsPanel';

const setup = (value: { captions?: string; captionSpan?: 'spoken' | 'section'; captionPosition?: 'lower' | 'centre' }) => {
  const onChange = vi.fn();
  render(<AmbientCaptionsPanel value={value} onChange={onChange} busy={false} />);
  return onChange;
};

describe('AmbientCaptionsPanel', () => {
  it('offers exactly what the ambient render does — no controls that change nothing', () => {
    setup({ captions: 'static', captionSpan: 'section', captionPosition: 'lower' });
    expect(screen.getByText('Scripture on screen')).toBeInTheDocument();
    for (const name of ['Off', 'While spoken', 'Whole section', 'Lower third', 'Centre']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // Story's controls: the ambient renderer reads none of them.
    expect(screen.queryByText(/caption motion/i)).toBeNull();
    expect(screen.queryByText(/stagger/i)).toBeNull();
    expect(screen.queryByText(/highlight each word/i)).toBeNull();
  });

  it('marks the current choice', () => {
    setup({ captions: 'static', captionSpan: 'section', captionPosition: 'centre' });
    expect(screen.getByRole('button', { name: 'Whole section' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Centre' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a project saved before the choice existed reads as While spoken — what it renders', () => {
    setup({ captions: 'static' });
    expect(screen.getByRole('button', { name: 'While spoken' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Off turns captions off; the others turn them on with that span', async () => {
    const onChange = setup({ captions: 'static', captionSpan: 'section' });
    await userEvent.click(screen.getByRole('button', { name: 'Off' }));
    expect(onChange).toHaveBeenLastCalledWith({ captions: 'none' });
    await userEvent.click(screen.getByRole('button', { name: 'While spoken' }));
    expect(onChange).toHaveBeenLastCalledWith({ captions: 'static', captionSpan: 'spoken' });
  });

  it('position is hidden while captions are off', () => {
    setup({ captions: 'none' });
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Centre' })).toBeNull();
  });

  it('changing position sends only the position', async () => {
    const onChange = setup({ captions: 'static', captionSpan: 'section', captionPosition: 'lower' });
    await userEvent.click(screen.getByRole('button', { name: 'Centre' }));
    expect(onChange).toHaveBeenLastCalledWith({ captionPosition: 'centre' });
  });
});
