import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { RenderBackgroundsPanel, type RenderBackgroundsPanelProps, type BackgroundItem } from '../RenderBackgroundsPanel';

const item = (id: string, kind: 'image' | 'video' = 'video'): BackgroundItem => ({
  id,
  url: `/media/${id}`,
  image: `/media/${id}.jpg`,
  kind,
});

function setup(over: Partial<RenderBackgroundsPanelProps> = {}) {
  const props: RenderBackgroundsPanelProps = {
    autoBackground: true,
    onAutoBackgroundChange: vi.fn(),
    backgroundPath: '',
    onBackgroundPathChange: vi.fn(),
    backgroundItems: [],
    isUploading: false,
    maxBackgrounds: 30,
    maxUploadMb: 500,
    durationSec: 20,
    onDropFiles: vi.fn(),
    onUploadFile: vi.fn(),
    onOpenLibrary: vi.fn(),
    onClearAll: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onRemove: vi.fn(),
    onTrimItem: vi.fn(),
    getImageSrc: (i) => i.image,
    onImageError: vi.fn(),
    genVisualsMode: 'alongside',
    onGenVisualsModeChange: vi.fn(),
    genVisualsCount: 2,
    onGenVisualsCountChange: vi.fn(),
    onGenerateVisuals: vi.fn(),
    isGeneratingVisuals: false,
    kenBurns: false,
    onKenBurnsChange: vi.fn(),
    ...over,
  };
  render(React.createElement(RenderBackgroundsPanel, props));
  return props;
}

describe('RenderBackgroundsPanel', () => {
  it('toggles Auto background', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('checkbox', { name: 'Auto background' }));
    expect(props.onAutoBackgroundChange).toHaveBeenCalledWith(false);
  });

  it('offers the path input and library picker before anything is selected', async () => {
    const user = userEvent.setup();
    const props = setup();
    expect(screen.getByPlaceholderText(/pick a background/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /from library/i }));
    expect(props.onOpenLibrary).toHaveBeenCalled();
  });

  it('lists selected backgrounds with reorder, remove and clear-all', async () => {
    const user = userEvent.setup();
    const props = setup({ backgroundItems: [item('a'), item('b')] });
    expect(screen.getByText('2 backgrounds selected')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Move down' })[0]);
    expect(props.onMoveDown).toHaveBeenCalledWith(0);
    await user.click(screen.getAllByRole('button', { name: 'Move up' })[1]);
    expect(props.onMoveUp).toHaveBeenCalledWith(1);
    await user.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(props.onRemove).toHaveBeenCalledWith(0);
    await user.click(screen.getByRole('button', { name: 'Clear all backgrounds' }));
    expect(props.onClearAll).toHaveBeenCalled();
  });

  it('disables Move up on the first item and Move down on the last', () => {
    setup({ backgroundItems: [item('a'), item('b')] });
    expect(screen.getAllByRole('button', { name: 'Move up' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Move down' })[1]).toBeDisabled();
  });

  it('offers Trim only for video items', () => {
    setup({ backgroundItems: [item('a', 'image'), item('b', 'video')] });
    expect(screen.getAllByRole('button', { name: 'Trim this clip' })).toHaveLength(1);
  });

  it('reports the hard-cut slot length for multi-background renders', () => {
    setup({ backgroundItems: [item('a'), item('b')], durationSec: 20 });
    expect(screen.getByText(/~10\.0s each/)).toBeInTheDocument();
  });

  it('generates AI visuals with the chosen mode', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.selectOptions(
      screen.getByRole('combobox', { name: /how generated visuals combine/i }),
      'replace',
    );
    expect(props.onGenVisualsModeChange).toHaveBeenCalledWith('replace');
    await user.click(screen.getByRole('button', { name: /generate/i }));
    expect(props.onGenerateVisuals).toHaveBeenCalled();
  });

  it('toggles Ken Burns motion', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('checkbox', { name: 'Ken Burns motion' }));
    expect(props.onKenBurnsChange).toHaveBeenCalledWith(true);
  });

  it('caps the library button once the background limit is reached', () => {
    setup({ backgroundItems: Array.from({ length: 3 }, (_, i) => item(String(i))), maxBackgrounds: 3 });
    expect(screen.getByRole('button', { name: 'Library' })).toBeDisabled();
  });
});
