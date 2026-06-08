import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MusicControl } from '../MusicControl';

describe('MusicControl', () => {
  it('shows an add-music control when no music set', () => {
    render(<MusicControl music={{ path: null, volume: 0.3, autoDuck: true }} onChange={vi.fn()} busy={false} />);
    expect(screen.getByRole('button', { name: /add background music/i })).toBeInTheDocument();
  });

  it('shows volume + autoduck + remove when music is set, and toggling autoduck calls onChange', async () => {
    const onChange = vi.fn();
    render(<MusicControl music={{ path: '/m.mp3', volume: 0.3, autoDuck: true }} onChange={onChange} busy={false} />);
    expect(screen.getByRole('button', { name: /remove music/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /autoduck/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ autoDuck: false }));
  });
});
