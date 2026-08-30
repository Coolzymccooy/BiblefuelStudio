import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { RenderSharePanel, type RenderSharePanelProps } from '../RenderSharePanel';

beforeAll(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

function setup(over: Partial<RenderSharePanelProps> = {}) {
  const props: RenderSharePanelProps = {
    lines: 'The Lord is my shepherd\nI shall not want',
    latestRenderFile: undefined,
    jobVideoOptions: [],
    shareVideoPath: '',
    onShareVideoPathChange: vi.fn(),
    onRefreshVideos: vi.fn(),
    postDestination: 'webhook',
    onPostDestinationChange: vi.fn(),
    selectedWebhook: '',
    onSelectedWebhookChange: vi.fn(),
    webhookOptions: [],
    selectedProfile: '',
    onSelectedProfileChange: vi.fn(),
    bufferProfiles: [],
    youtubePrivacy: 'private',
    onYoutubePrivacyChange: vi.fn(),
    onShare: vi.fn(),
    isSharing: false,
    ...over,
  };
  render(React.createElement(RenderSharePanel, props));
  return props;
}

describe('RenderSharePanel', () => {
  it('offers the latest instant render as a share source', () => {
    setup({ latestRenderFile: 'outputs/video-1.mp4' });
    expect(screen.getByRole('option', { name: 'Latest Instant Render' })).toBeInTheDocument();
  });

  it('says when there is nothing to share yet', () => {
    setup();
    expect(screen.getByRole('option', { name: 'No rendered videos found' })).toBeInTheDocument();
  });

  it('refreshes the rendered-video list', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Refresh Rendered Videos' }));
    expect(props.onRefreshVideos).toHaveBeenCalled();
  });

  it('copies the caption built from the overlay lines', async () => {
    // userEvent.setup() installs its own clipboard stub - read it back rather
    // than spying on the stub it replaced.
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Copy Caption' }));
    expect(await navigator.clipboard.readText()).toBe('The Lord is my shepherd I shall not want');
  });

  it('shows the webhook picker for the webhook destination', () => {
    setup({ webhookOptions: [{ id: 'w1', name: 'Zapier hook' }] });
    expect(screen.getByRole('option', { name: 'Zapier hook' })).toBeInTheDocument();
  });

  it('shows the privacy picker for the YouTube destination', () => {
    setup({ postDestination: 'youtube' });
    expect(screen.getByRole('option', { name: 'YouTube Private' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'YouTube Public' })).toBeInTheDocument();
  });

  it('warns that direct Instagram/TikTok posting needs OAuth', () => {
    setup({ postDestination: 'tiktok' });
    expect(screen.getByText(/requires OAuth setup/i)).toBeInTheDocument();
  });

  it('shares now', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: /share now/i }));
    expect(props.onShare).toHaveBeenCalled();
  });

  it('guards against double-taps while a share is in flight', () => {
    setup({ isSharing: true });
    expect(screen.getByRole('button', { name: /sharing/i })).toBeDisabled();
  });
});
