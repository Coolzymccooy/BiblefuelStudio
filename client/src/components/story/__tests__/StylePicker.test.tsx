import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StylePicker } from '../StylePicker';

describe('StylePicker', () => {
  it('renders all 4 styles and marks the selected one pressed', () => {
    render(<StylePicker value="cinematic-bible" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Cinematic Bible/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Modern Devotional/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('calls onChange with the style id when a style is clicked', async () => {
    const onChange = vi.fn();
    render(<StylePicker value="cinematic-bible" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Heavenly Atmosphere/i }));
    expect(onChange).toHaveBeenCalledWith('heavenly-atmosphere');
  });
});
