import { describe, it, expect, vi } from 'vitest';
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
