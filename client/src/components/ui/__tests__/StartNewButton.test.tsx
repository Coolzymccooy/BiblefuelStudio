import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StartNewButton } from '../StartNewButton';

describe('StartNewButton', () => {
  it('is a visible button that starts something new', async () => {
    const onClick = vi.fn();
    render(<StartNewButton onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Start new' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('btn');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('can be locked while work is in flight', async () => {
    const onClick = vi.fn();
    render(<StartNewButton onClick={onClick} disabled />);
    const button = screen.getByRole('button', { name: 'Start new' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('has a compact form for the editor side panels', () => {
    render(<StartNewButton onClick={vi.fn()} compact />);
    const button = screen.getByRole('button', { name: 'Start new' });
    expect(button).not.toHaveClass('btn');
    expect(button.className).toMatch(/border/);
  });
});
