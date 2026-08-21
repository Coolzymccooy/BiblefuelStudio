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

  it('renders without a strip or top bar', () => {
    render(<EditorShell tools={tools} panels={panels} stage={<div>only stage</div>} />);
    expect(screen.getByText('only stage')).toBeInTheDocument();
  });
});
