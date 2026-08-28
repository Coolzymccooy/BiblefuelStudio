import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { OutputQuickPanel, type OutputQuickPanelProps } from '../OutputQuickPanel';

function setup(over: Partial<OutputQuickPanelProps> = {}) {
  const props: OutputQuickPanelProps = {
    items: [
      { label: 'Source media loaded', status: 'done' },
      { label: 'Transcribe first', status: 'todo', detail: 'Kinetic captions need a transcript.' },
      { label: 'Music bed', status: 'optional' },
    ],
    renderLabel: 'Render captioned video',
    renderHint: 'Renders your source media with captions and backgrounds.',
    onRender: vi.fn(),
    isRendering: false,
    progress: 0,
    renderedVideo: null,
    onPreviewOnStage: vi.fn(),
    onShare: vi.fn(),
    onDownload: vi.fn(),
    shareKit: React.createElement('div', null, 'share-kit-here'),
    ...over,
  };
  render(React.createElement(OutputQuickPanel, props));
  return props;
}

describe('OutputQuickPanel', () => {
  it('shows readiness as visible state and blocks Render on a todo, naming the reason', () => {
    setup();
    expect(screen.getByText('Transcribe first')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /render captioned video/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Kinetic captions need a transcript.');
  });

  it('renders when every blocker is cleared', async () => {
    const user = userEvent.setup();
    const props = setup({ items: [{ label: 'Source media loaded', status: 'done' }, { label: 'Music bed', status: 'optional' }] });
    await user.click(screen.getByRole('button', { name: /render captioned video/i }));
    expect(props.onRender).toHaveBeenCalled();
  });

  it('shows live progress while rendering', () => {
    setup({ items: [], isRendering: true, progress: 42 });
    expect(screen.getByText(/Rendering… 42%/)).toBeInTheDocument();
  });

  it('offers Preview on stage, Share and Download once a render exists', async () => {
    const user = userEvent.setup();
    const props = setup({ items: [], renderedVideo: '/outputs/timeline/cut.mp4' });
    await user.click(screen.getByRole('button', { name: /preview on stage/i }));
    await user.click(screen.getByRole('button', { name: /^share$/i }));
    await user.click(screen.getByRole('button', { name: /download mp4/i }));
    expect(props.onPreviewOnStage).toHaveBeenCalled();
    expect(props.onShare).toHaveBeenCalled();
    expect(props.onDownload).toHaveBeenCalled();
  });

  it('docks the Share Kit', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /share kit/i }));
    expect(screen.getByText('share-kit-here')).toBeInTheDocument();
  });
});
