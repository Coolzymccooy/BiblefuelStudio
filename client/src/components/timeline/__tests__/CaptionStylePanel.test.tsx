import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CaptionStylePanel, type CaptionStylePanelProps } from '../CaptionStylePanel';

vi.mock('../../voicelab/AnimationPicker', () => ({
  // The real picker pulls the animation catalogue from the server; this panel's
  // job is only to pass the value through and report changes.
  AnimationPicker: ({ value, onChange }: { value: string; onChange: (id: string) => void }) => (
    <button type="button" onClick={() => onChange('hero-bold')}>
      preset:{value}
    </button>
  ),
}));

const LAYOUTS = [
  { value: 'center', label: 'Center (default)' },
  { value: 'lower-third', label: 'Lower third' },
];

function setup(over: Partial<CaptionStylePanelProps> = {}) {
  const props: CaptionStylePanelProps = {
    enabled: true,
    typographyPreset: 'karaoke-pop',
    onTypographyPresetChange: vi.fn(),
    layout: 'center',
    onLayoutChange: vi.fn(),
    layoutOptions: LAYOUTS,
    depth: false,
    onDepthChange: vi.fn(),
    ...over,
  };
  render(<CaptionStylePanel {...props} />);
  return props;
}

describe('CaptionStylePanel', () => {
  it('renders nothing when kinetic captions are off', () => {
    // With captions off the render is plain audio/video over a background, so
    // these controls would imply an effect that never happens.
    const { container } = render(
      <CaptionStylePanel
        enabled={false}
        typographyPreset="karaoke-pop"
        onTypographyPresetChange={vi.fn()}
        layout="center"
        onLayoutChange={vi.fn()}
        layoutOptions={LAYOUTS}
        depth={false}
        onDepthChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the current typography preset', () => {
    setup({ typographyPreset: 'hero-bold' });
    expect(screen.getByText('preset:hero-bold')).toBeInTheDocument();
  });

  it('reports a typography preset change', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByText(/^preset:/));
    expect(props.onTypographyPresetChange).toHaveBeenCalledWith('hero-bold');
  });

  it('lists every layout option', () => {
    setup();
    const select = screen.getByLabelText('Text layout');
    expect(select).toHaveValue('center');
    expect(screen.getByRole('option', { name: 'Lower third' })).toBeInTheDocument();
  });

  it('reports a layout change', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.selectOptions(screen.getByLabelText('Text layout'), 'lower-third');
    expect(props.onLayoutChange).toHaveBeenCalledWith('lower-third');
  });

  it('reflects the layered-depth state', () => {
    setup({ depth: true });
    expect(screen.getByRole('checkbox', { name: /layered depth/i })).toBeChecked();
  });

  it('reports a layered-depth change', async () => {
    const user = userEvent.setup();
    const props = setup({ depth: false });
    await user.click(screen.getByRole('checkbox', { name: /layered depth/i }));
    expect(props.onDepthChange).toHaveBeenCalledWith(true);
  });

  it('handles an empty layout list without crashing', () => {
    setup({ layoutOptions: [] });
    expect(screen.getByLabelText('Text layout')).toBeInTheDocument();
  });
});
