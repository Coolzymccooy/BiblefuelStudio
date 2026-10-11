import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LivePreviewStage } from '../LivePreviewStage';
import { buildWorshipDocumentaryProject } from '../../../lib/timelineProject';

const BADGE = 'Studio effects appear in the render';

const stage = (preset: string) => (
  <LivePreviewStage
    project={buildWorshipDocumentaryProject({ title: 'T' })}
    backgrounds={[]}
    captionLines={['Be still and know']}
    timeSec={0}
    onTimeChange={() => {}}
    captionStyle={{ preset }}
  />
);

describe('LivePreviewStage Studio badge', () => {
  it('shows the caption text and the badge for a Studio look', () => {
    render(stage('studio-lagos-night'));
    expect(screen.getByTestId('caption-preview').textContent).toContain('Be still and know');
    expect(screen.getByText(BADGE)).toBeInTheDocument();
  });

  it('shows no badge for a non-Studio look', () => {
    render(stage('cinematic-worship'));
    expect(screen.getByTestId('caption-preview')).toBeInTheDocument();
    expect(screen.queryByText(BADGE)).toBeNull();
  });
});
