import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InfoTooltip } from '../InfoTooltip';

describe('InfoTooltip', () => {
  it('uses the label as the button name', () => {
    render(<InfoTooltip label="About energy" content="Calm keeps it gentle." />);
    expect(screen.getByRole('button', { name: 'About energy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More info' })).toBeNull();
  });

  it('is still named "More info" without a label', () => {
    render(<InfoTooltip content="Some help." />);
    expect(screen.getByRole('button', { name: 'More info' })).toBeTruthy();
  });

  it('shows its content when opened', () => {
    render(<InfoTooltip label="About energy" content="Calm keeps it gentle." />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'About energy' }));
    expect(screen.getByRole('tooltip').textContent).toBe('Calm keeps it gentle.');
  });
});
