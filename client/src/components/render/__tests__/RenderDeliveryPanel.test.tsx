import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { RenderDeliveryPanel, type RenderDeliveryPanelProps } from '../RenderDeliveryPanel';

function setup(over: Partial<RenderDeliveryPanelProps> = {}) {
  const props: RenderDeliveryPanelProps = {
    renderInBackground: false,
    onRenderInBackgroundChange: vi.fn(),
    isLongRender: false,
    kineticCaptions: false,
    onKineticCaptionsChange: vi.fn(),
    ttsVoiceId: '',
    onTtsVoiceIdChange: vi.fn(),
    renderEnabled: true,
    isRendering: false,
    onRenderVideo: vi.fn(),
    onRenderWaveform: vi.fn(),
    ...over,
  };
  render(React.createElement(RenderDeliveryPanel, props));
  return props;
}

describe('RenderDeliveryPanel', () => {
  it('starts a video render', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Render the video' }));
    expect(props.onRenderVideo).toHaveBeenCalled();
  });

  it('starts a waveform render', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Render a waveform video' }));
    expect(props.onRenderWaveform).toHaveBeenCalled();
  });

  it('locks Render-in-background on for long renders, and says why', () => {
    setup({ isLongRender: true });
    expect(screen.getByLabelText('Render in background')).toBeDisabled();
    expect(screen.getByText('Required for 60s+')).toBeInTheDocument();
  });

  it('locks Render-in-background on when kinetic captions are on', () => {
    setup({ kineticCaptions: true });
    expect(screen.getByLabelText('Render in background')).toBeDisabled();
    expect(screen.getByText('Forced on by kinetic captions')).toBeInTheDocument();
  });

  it('refuses an instant long render - background mode is required', () => {
    setup({ isLongRender: true, renderInBackground: false });
    expect(screen.getByRole('button', { name: 'Render the video' })).toBeDisabled();
  });

  it('reveals the ElevenLabs voice ID only when kinetic captions are on', async () => {
    const user = userEvent.setup();
    const props = setup();
    expect(screen.queryByPlaceholderText(/server default/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /kinetic captions/i }));
    expect(props.onKineticCaptionsChange).toHaveBeenCalledWith(true);
  });

  it('edits the voice ID', async () => {
    const user = userEvent.setup();
    const props = setup({ kineticCaptions: true });
    await user.type(screen.getByPlaceholderText(/server default/i), 'x');
    expect(props.onTtsVoiceIdChange).toHaveBeenCalledWith('x');
  });

  it('surfaces the first blocker as the button tooltip, before the click', () => {
    setup({ videoBlockerMessage: 'Add overlay text first' });
    expect(screen.getByRole('button', { name: 'Render the video' })).toHaveAttribute('title', 'Add overlay text first');
  });

  it('renames the buttons when background mode is on', () => {
    setup({ renderInBackground: true });
    expect(screen.getByText('Queue Video Render')).toBeInTheDocument();
    expect(screen.getByText('Queue Waveform Render')).toBeInTheDocument();
  });
});
