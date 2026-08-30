import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorShell, type EditorTool } from '../EditorShell';

const tools: EditorTool[] = [
  { id: 'media', label: 'Media', icon: 'M', count: 4 },
  { id: 'audio', label: 'Audio', icon: 'A' },
  { id: 'fx', label: 'Effects', icon: 'F', count: 0 },
];

const panels = {
  media: <div>media panel body</div>,
  audio: <div>audio panel body</div>,
};

function setup(extra = {}) {
  return render(
    <EditorShell
      tools={tools}
      panels={panels}
      stage={<div>stage content</div>}
      strip={<div>timeline strip</div>}
      topBar={<div>top bar</div>}
      {...extra}
    />,
  );
}

describe('EditorShell', () => {
  it('renders every region it was given', () => {
    setup();
    expect(screen.getByText('top bar')).toBeInTheDocument();
    expect(screen.getByText('stage content')).toBeInTheDocument();
    expect(screen.getByText('timeline strip')).toBeInTheDocument();
  });

  it('shows the first tool panel by default', () => {
    setup();
    expect(screen.getByText('media panel body')).toBeInTheDocument();
    expect(screen.queryByText('audio panel body')).not.toBeInTheDocument();
  });

  it('follows a controlled activeToolId so a quick job can hand off to the next tool', () => {
    const { rerender } = setup({ activeToolId: 'media' });
    expect(screen.getByText('media panel body')).toBeInTheDocument();
    rerender(
      <EditorShell tools={tools} panels={panels} stage={<div>stage content</div>} strip={<div>timeline strip</div>} topBar={<div>top bar</div>} activeToolId="audio" />,
    );
    expect(screen.getByText('audio panel body')).toBeInTheDocument();
    expect(screen.queryByText('media panel body')).not.toBeInTheDocument();
  });

  it('honours initialToolId over the first tool', () => {
    setup({ initialToolId: 'audio' });
    expect(screen.getByText('audio panel body')).toBeInTheDocument();
  });

  it('switches panel when a rail tool is clicked', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: /audio/i }));
    expect(screen.getByText('audio panel body')).toBeInTheDocument();
    expect(screen.queryByText('media panel body')).not.toBeInTheDocument();
  });

  it('marks the active tool for assistive tech', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole('tab', { name: /media/i })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: /audio/i }));
    expect(screen.getByRole('tab', { name: /audio/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /media/i })).toHaveAttribute('aria-selected', 'false');
  });

  it('reports tool changes to the page', async () => {
    const onToolChange = vi.fn();
    const user = userEvent.setup();
    setup({ onToolChange });
    await user.click(screen.getByRole('tab', { name: /effects/i }));
    expect(onToolChange).toHaveBeenCalledWith('fx');
  });

  it('shows an empty state rather than blank space for a tool with no panel', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: /effects/i }));
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });

  it('shows a count badge only when the count is above zero', () => {
    setup();
    // Media has 4 clips; Effects has 0 and must not show a stray "0".
    expect(screen.getByRole('tab', { name: /media/i })).toHaveTextContent('4');
    expect(screen.getByRole('tab', { name: /effects/i })).not.toHaveTextContent('0');
  });

  it('hides the properties rail when nothing is selected', () => {
    setup();
    expect(screen.queryByRole('tablist', { name: /properties/i })).not.toBeInTheDocument();
  });

  it('shows the properties rail when a selection exists', () => {
    // CapCut reveals a RIGHT-hand rail (Basic, Background, Audio, Speed…) only
    // once a clip is selected. Keeping it hidden otherwise is what leaves the
    // centre free for the preview.
    setup({
      propertyTools: [
        { id: 'basic', label: 'Basic', icon: 'B' },
        { id: 'speed', label: 'Speed', icon: 'S' },
      ],
      propertyPanels: { basic: <div>basic properties</div> },
    });
    expect(screen.getByRole('tablist', { name: /properties/i })).toBeInTheDocument();
    expect(screen.getByText('basic properties')).toBeInTheDocument();
  });

  it('switches property panels independently of the tool rail', async () => {
    const user = userEvent.setup();
    setup({
      propertyTools: [
        { id: 'basic', label: 'Basic', icon: 'B' },
        { id: 'speed', label: 'Speed', icon: 'S' },
      ],
      propertyPanels: { basic: <div>basic properties</div>, speed: <div>speed properties</div> },
    });
    await user.click(screen.getByRole('tab', { name: /speed/i }));
    expect(screen.getByText('speed properties')).toBeInTheDocument();
    // The left rail must not have changed.
    expect(screen.getByText('media panel body')).toBeInTheDocument();
  });

  it('renders an icon-only clip toolbar with accessible names', () => {
    setup({
      clipActions: [
        { id: 'split', label: 'Split clip', icon: 'S', onClick: vi.fn() },
        { id: 'delete', label: 'Delete clip', icon: 'D', onClick: vi.fn() },
      ],
    });
    // Icon-only buttons still need names — this is the trade for the density.
    expect(screen.getByRole('button', { name: 'Split clip' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete clip' })).toBeInTheDocument();
  });

  it('fires the clip action handler', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    setup({ clipActions: [{ id: 'split', label: 'Split clip', icon: 'S', onClick }] });
    await user.click(screen.getByRole('button', { name: 'Split clip' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('disables a clip action that is not currently available', () => {
    setup({
      clipActions: [{ id: 'split', label: 'Split clip', icon: 'S', onClick: vi.fn(), disabled: true }],
    });
    expect(screen.getByRole('button', { name: 'Split clip' })).toBeDisabled();
  });

  it('renders without a strip or top bar', () => {
    render(<EditorShell tools={tools} panels={panels} stage={<div>only stage</div>} />);
    expect(screen.getByText('only stage')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phone legibility.
//
// The operator marked several editor labels as unreadable on a phone. Contrast
// was NOT the cause and darkening the colour would not have fixed it:
// editor-dim measures 9.65:1 and editor-faint 5.86:1 on the light panel, both
// well past the 4.5 threshold. The cause is SIZE - those labels are 11px
// against a 15px root, which is below comfortable reading size on a handset.
//
// So the rule under test is a floor on label size, not a colour.

describe('EditorShell — phone legibility', () => {
  const PHONE = '(max-width: 1023px)';

  function asPhone(matches: boolean) {
    // usePhoneLayout reads window.matchMedia, so stub it THERE - a bare global
    // stub leaves window.matchMedia untouched and the component stays desktop.
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q === PHONE ? matches : false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));
    window.matchMedia = globalThis.matchMedia;
  }

  afterEach(() => {
    // Leaking a stubbed matchMedia breaks unrelated files - it has happened
    // in this suite before.
    vi.unstubAllGlobals();
  });

  it('gives the phone reopen button a readable size', async () => {
    // Closed sheet: this bar is the operator's way back to the tool, and was
    // one of the labels marked unreadable. The sheet starts OPEN, so fold it
    // away first - the bar only exists once it is closed.
    asPhone(true);
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /hide panel/i }));
    const bar = document.body.querySelector('button.absolute.inset-x-0');
    const barPx = Number(((bar?.className as string) || '').match(/text-\[(\d+)px\]/)?.[1]);
    expect(barPx).toBeGreaterThanOrEqual(13);
  });

  it('gives the phone sheet header a readable size', async () => {
    asPhone(true);
    setup();
    // The sheet is open by default on a phone, so its header is already here.
    // Target the sheet header by its distinctive uppercase tracking, not by
    // position - the rail renders spans of its own.
    const header = [...document.body.querySelectorAll('span')]
      .find((el) => el.className.includes('uppercase') && el.className.includes('tracking-'));
    const px = Number(((header?.className as string) || '').match(/text-\[(\d+)px\]/)?.[1]);
    expect(px).toBeGreaterThanOrEqual(13);
  });

  it('keeps empty-state copy readable on phones', () => {
    asPhone(true);
    setup({ panels: {} });
    const empty = screen.getByText(/nothing here yet/i);
    const px = Number((empty.className.match(/text-\[(\d+)px\]/) || [])[1]);
    expect(px).toBeGreaterThanOrEqual(13);
  });

  it('leaves the desktop layout alone', () => {
    // Desktop had no complaint; this fix must not inflate that layout. The
    // phone sheet simply does not exist there.
    asPhone(false);
    setup();
    expect(document.body.querySelector('.editor-phone')).toBeNull();
  });
});
