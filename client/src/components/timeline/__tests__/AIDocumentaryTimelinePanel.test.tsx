import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { AIDocumentaryTimelinePanel } from '../AIDocumentaryTimelinePanel';

describe('AIDocumentaryTimelinePanel', () => {
  test('creates a worship documentary project and surfaces Veo as the AI b-roll provider', async () => {
    const onCreateProject = vi.fn();
    render(<AIDocumentaryTimelinePanel onCreateProject={onCreateProject} />);

    expect(screen.getByText('AI Documentary Timeline')).toBeInTheDocument();
    expect(screen.getByText(/CapCut-like scene tracks/i)).toBeInTheDocument();
    expect(screen.getByText(/Veo-ready AI B-roll/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /create worship documentary timeline/i }));

    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(onCreateProject.mock.calls[0][0]).toMatchObject({
      template: 'worship-documentary',
      aspect: '16:9',
      renderSettings: {
        faceSafeDefault: true,
        voiceProvider: 'chatterbox',
      },
    });
  });
});
