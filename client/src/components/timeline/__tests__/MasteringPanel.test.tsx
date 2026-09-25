import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MasteringPanel, LUFS_MIN, LUFS_MAX, type MasteringPanelProps } from '../MasteringPanel';

function setup(over: Partial<MasteringPanelProps> = {}) {
  const props: MasteringPanelProps = {
    normalizeLUFS: -16,
    onNormalizeLUFSChange: vi.fn(),
    fadeInMs: 250,
    onFadeInChange: vi.fn(),
    fadeOutMs: 400,
    onFadeOutChange: vi.fn(),
    deEsser: false,
    onDeEsserChange: vi.fn(),
    ...over,
  };
  render(<MasteringPanel {...props} />);
  return props;
}

describe('MasteringPanel', () => {
  it('shows the current values', () => {
    setup();
    expect(screen.getByLabelText(/normalize/i)).toHaveValue('-16');
    expect(screen.getByLabelText(/fade in/i)).toHaveValue(250);
    expect(screen.getByLabelText(/fade out/i)).toHaveValue(400);
  });

  it('shows the LUFS number alongside the slider, which is otherwise unreadable', () => {
    setup({ normalizeLUFS: -14 });
    expect(screen.getByText('-14')).toBeInTheDocument();
  });

  it('constrains LUFS to the broadcast-sane window', () => {
    // Below -24 is inaudibly quiet; above -6 clips on phone speakers.
    setup();
    const slider = screen.getByLabelText(/normalize/i);
    expect(slider).toHaveAttribute('min', String(LUFS_MIN));
    expect(slider).toHaveAttribute('max', String(LUFS_MAX));
  });

  it('reports a fade-in change as a NUMBER, not a string', async () => {
    const user = userEvent.setup();
    const props = setup({ fadeInMs: 0 });
    await user.type(screen.getByLabelText(/fade in/i), '5');
    expect(props.onFadeInChange).toHaveBeenCalledWith(5);
  });

  it('reports a fade-out change', async () => {
    const user = userEvent.setup();
    const props = setup({ fadeOutMs: 0 });
    await user.type(screen.getByLabelText(/fade out/i), '9');
    expect(props.onFadeOutChange).toHaveBeenCalledWith(9);
  });

  it('reflects and reports the de-esser', async () => {
    const user = userEvent.setup();
    const props = setup({ deEsser: true });
    const box = screen.getByLabelText(/de-esser/i);
    expect(box).toBeChecked();
    await user.click(box);
    expect(props.onDeEsserChange).toHaveBeenCalledWith(false);
  });

  it('every control has an accessible name', () => {
    // These were previously label elements with no htmlFor, so nothing but
    // position could target them.
    setup();
    expect(screen.getByLabelText(/normalize/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fade in/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fade out/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/de-esser/i)).toBeInTheDocument();
  });

  it('stacks in column layout for a narrow properties rail', () => {
    const { container } = render(
      <MasteringPanel
        normalizeLUFS={-16} onNormalizeLUFSChange={vi.fn()}
        fadeInMs={0} onFadeInChange={vi.fn()}
        fadeOutMs={0} onFadeOutChange={vi.fn()}
        deEsser={false} onDeEsserChange={vi.fn()}
        layout="column"
      />,
    );
    expect(container.firstElementChild?.className).toContain('grid-cols-1');
    expect(container.firstElementChild?.className).not.toContain('md:grid-cols-4');
  });
});
