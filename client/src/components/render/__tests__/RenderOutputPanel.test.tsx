import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RenderOutputPanel, type RenderOutputPanelProps } from '../RenderOutputPanel';

function setup(over: Partial<RenderOutputPanelProps> = {}) {
  const props: RenderOutputPanelProps = {
    aspect: 'portrait',
    onAspectChange: vi.fn(),
    durationSec: 20,
    onDurationChange: vi.fn(),
    captionWidth: 90,
    onCaptionWidthChange: vi.fn(),
    isLongRender: false,
    ...over,
  };
  render(<RenderOutputPanel {...props} />);
  return props;
}

describe('RenderOutputPanel', () => {
  it('offers all three output frames', () => {
    setup();
    for (const label of [/portrait/i, /landscape/i, /square/i]) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    }
  });

  it('reports the aspect as its value, not its label', async () => {
    const user = userEvent.setup();
    const props = setup();
    const select = screen.getByRole('option', { name: /landscape/i }).closest('select')!;
    await user.selectOptions(select, 'landscape');
    expect(props.onAspectChange).toHaveBeenCalledWith('landscape');
  });

  it('reports duration as a NUMBER, not the string from the select', async () => {
    // The render payload does arithmetic on this; a string would silently
    // concatenate rather than add.
    const user = userEvent.setup();
    const props = setup();
    const select = screen.getByRole('option', { name: /60s/ }).closest('select')!;
    await user.selectOptions(select, '60');
    expect(props.onDurationChange).toHaveBeenCalledWith(60);
  });

  it('warns that long renders move to the background', () => {
    // Otherwise a 3-minute render looks like it hung.
    setup({ isLongRender: true });
    expect(screen.getByText(/background/i)).toBeInTheDocument();
  });

  it('stays quiet for short renders', () => {
    setup({ isLongRender: false });
    expect(screen.queryByText(/run in the background/i)).not.toBeInTheDocument();
  });

  it('shows the caption width in the label so the slider has a value', () => {
    setup({ captionWidth: 76 });
    expect(screen.getByText(/76%/)).toBeInTheDocument();
  });

  it('reports caption width as a NUMBER', () => {
    // A range input yields a string; the render payload treats this as a
    // percentage and does arithmetic on it.
    const props = setup({ captionWidth: 90 });
    fireEvent.change(screen.getByRole('slider'), { target: { value: '78' } });
    expect(props.onCaptionWidthChange).toHaveBeenCalledWith(78);
  });

  it('keeps the slider within the range the renderer accepts', () => {
    setup();
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('min', '60');
    expect(slider).toHaveAttribute('max', '100');
  });
});
