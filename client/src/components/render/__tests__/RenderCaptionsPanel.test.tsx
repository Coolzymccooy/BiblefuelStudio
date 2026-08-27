import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RenderCaptionsPanel, type RenderCaptionsPanelProps } from '../RenderCaptionsPanel';

const LAYOUTS = [
  { value: 'center', label: 'Center (default)' },
  { value: 'bottom-left', label: 'Bottom left' },
];

function setup(over: Partial<RenderCaptionsPanelProps> = {}) {
  const props: RenderCaptionsPanelProps = {
    lines: '',
    onLinesChange: vi.fn(),
    typographyPreset: 'cinematic-default',
    onTypographyPresetChange: vi.fn(),
    layout: 'center',
    onLayoutChange: vi.fn(),
    layoutOptions: LAYOUTS,
    depth: false,
    onDepthChange: vi.fn(),
    onOpenScripts: vi.fn(),
    onFormatForVideo: vi.fn(),
    maxLines: 6,
    hasScripts: true,
    onUseLatestScript: vi.fn(),
    onCaptionMotionChange: vi.fn(),
    onCaptionStaggerChange: vi.fn(),
    onCaptionHighlightChange: vi.fn(),
    ...over,
  };
  render(<RenderCaptionsPanel {...props} />);
  return props;
}

describe('RenderCaptionsPanel', () => {
  it('shows the caption text for editing', () => {
    setup({ lines: 'God is close to the brokenhearted' });
    expect(screen.getByDisplayValue(/brokenhearted/)).toBeInTheDocument();
  });

  it('reports every keystroke upward', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.type(screen.getByRole('textbox'), 'A');
    expect(props.onLinesChange).toHaveBeenCalled();
  });

  it('states the line cap so it is known before rendering', () => {
    // The renderer slices to 6; the operator should not discover that after a
    // render comes back missing lines.
    setup({ maxLines: 6 });
    expect(screen.getByText(/6 lines/i)).toBeInTheDocument();
  });

  it('offers the scripts library', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: /pick from scripts/i }));
    expect(props.onOpenScripts).toHaveBeenCalled();
  });

  it('offers format-for-video', async () => {
    const user = userEvent.setup();
    const props = setup({ lines: 'a very long line that would need slicing' });
    await user.click(screen.getByRole('button', { name: /format for video/i }));
    expect(props.onFormatForVideo).toHaveBeenCalled();
  });

  it('lists every layout option it is given', () => {
    setup();
    for (const o of LAYOUTS) {
      expect(screen.getByRole('option', { name: o.label })).toBeInTheDocument();
    }
  });

  it('changing the layout reports the value, not the label', async () => {
    const user = userEvent.setup();
    const props = setup();
    // Find the select by the option it holds - Field renders its own label
    // markup, so getByLabelText does not reach the control.
    const select = screen.getByRole('option', { name: 'Bottom left' }).closest('select')!;
    await user.selectOptions(select, 'bottom-left');
    expect(props.onLayoutChange).toHaveBeenCalledWith('bottom-left');
  });

  it('separately offers Use Latest Script', async () => {
    const user = userEvent.setup();
    const props = setup({ hasScripts: true });
    await user.click(screen.getByRole('button', { name: /use latest script/i }));
    expect(props.onUseLatestScript).toHaveBeenCalled();
  });

  it('hides Use Latest Script when there are no scripts', () => {
    setup({ hasScripts: false });
    expect(screen.queryByRole('button', { name: /use latest script/i })).not.toBeInTheDocument();
  });

  it('toggles layered depth', async () => {
    const user = userEvent.setup();
    const props = setup({ depth: false });
    await user.click(screen.getByRole('checkbox', { name: /layered depth/i }));
    expect(props.onDepthChange).toHaveBeenCalledWith(true);
  });

  it('reflects depth being already on', () => {
    setup({ depth: true });
    expect(screen.getByRole('checkbox', { name: /layered depth/i })).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// Caption motion: HOW captions are timed, independent of how they look.
//
// Base modes are mutually exclusive; highlight and stagger are modifiers that
// layer on. The operator asked for multi-select, and this is the honest shape
// of it - "per word AND line block" is a contradiction the UI must not offer.
describe('RenderCaptionsPanel — caption motion', () => {
  const MOTIONS = [
    { id: 'words', label: 'Per word', description: 'One word at a time.' },
    { id: 'lines', label: 'Per line', description: 'One line at a time.' },
    { id: 'block', label: 'Line block', description: 'A phrase together.' },
  ];

  it('offers every motion the server implements', () => {
    setup({ motions: MOTIONS, captionMotion: 'words' });
    for (const m of MOTIONS) {
      expect(screen.getByRole('option', { name: new RegExp(m.label, 'i') })).toBeInTheDocument();
    }
  });

  it('reports a motion change upward', async () => {
    const user = userEvent.setup();
    const props = setup({ motions: MOTIONS, captionMotion: 'words' });
    await user.selectOptions(screen.getByRole('combobox', { name: /caption motion/i }), 'block');
    expect(props.onCaptionMotionChange).toHaveBeenCalledWith('block');
  });

  it('lets stagger and highlight be ticked together', async () => {
    const user = userEvent.setup();
    const props = setup({ motions: MOTIONS, captionMotion: 'block' });
    await user.click(screen.getByLabelText(/stagger/i));
    await user.click(screen.getByLabelText(/highlight/i));
    expect(props.onCaptionStaggerChange).toHaveBeenCalledWith(true);
    expect(props.onCaptionHighlightChange).toHaveBeenCalledWith(true);
  });

  it('hides word highlight for per-word, where it is meaningless', () => {
    setup({ motions: MOTIONS, captionMotion: 'words' });
    expect(screen.queryByLabelText(/highlight/i)).not.toBeInTheDocument();
  });

  it('renders without motions rather than crashing', () => {
    // The panel must survive a server that predates the motions field.
    setup({ motions: undefined });
    expect(screen.getByText(/overlay text/i)).toBeInTheDocument();
  });
});
