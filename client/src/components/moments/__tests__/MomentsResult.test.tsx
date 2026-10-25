import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MomentsResult } from '../MomentsResult';
import { api } from '../../../lib/api';
import { mkMoment } from '../../../lib/__tests__/momentsFixtures';

const handlers = () => ({ onShuffle: vi.fn(), onRetry: vi.fn(), onCancel: vi.fn(), busy: false });

beforeEach(() => { vi.restoreAllMocks(); });

describe('MomentsResult', () => {
  it('while rendering shows the stage and percent, with Cancel', async () => {
    const h = handlers();
    render(<MomentsResult project={mkMoment({ render: { jobId: 'j', status: 'running', percent: 42, stage: 'shots' } })} {...h} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText(/cutting your photos/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(h.onCancel).toHaveBeenCalled();
  });

  it('falls back to a generic line for a stage it does not know', () => {
    render(<MomentsResult project={mkMoment({ render: { jobId: 'j', status: 'running', percent: 5, stage: 'mystery' } })} {...handlers()} />);
    expect(screen.getByText(/making your moment/i)).toBeInTheDocument();
  });

  it('when done plays the video, offers Download and Shuffle, and lists notes', async () => {
    const h = handlers();
    const download = vi.spyOn(api, 'downloadMedia').mockReturnValue(true);
    render(<MomentsResult
      project={mkMoment({ render: { jobId: 'j', status: 'done', percent: 100, stage: 'done', file: '/outputs/moment-1.mp4', notes: ['4 photos didn\'t fit 15 s. Try 30 s?'] } })}
      {...h}
    />);
    const video = document.querySelector('video');
    expect(video?.getAttribute('src')).toContain('/outputs/moment-1.mp4');
    // iPhone Safari draws nothing before play unless it loads a frame: the
    // fragment asks for the first one, so the player shows the Moment, not black.
    expect(video?.getAttribute('src')).toMatch(/#t=0\.001$/);
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(screen.getByText(/try 30 s/i)).toBeInTheDocument();
    // A button, not <a download>: the attribute is ignored on the prod media host and iOS plays inline.
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(download).toHaveBeenCalledWith(expect.stringContaining('/outputs/moment-1.mp4'), 'moment.mp4');
    await userEvent.click(screen.getByRole('button', { name: /shuffle/i }));
    expect(h.onShuffle).toHaveBeenCalled();
  });

  it('Shuffle is disabled while busy', () => {
    render(<MomentsResult
      project={mkMoment({ render: { jobId: 'j', status: 'done', percent: 100, stage: 'done', file: '/outputs/moment-1.mp4' } })}
      {...handlers()}
      busy
    />);
    expect(screen.getByRole('button', { name: /shuffle/i })).toBeDisabled();
  });

  it('a failure shows the message and Make it again', async () => {
    const h = handlers();
    render(<MomentsResult project={mkMoment({ render: { jobId: 'j', status: 'error', percent: 0, stage: 'error', error: 'Need at least 3 readable photos.' } })} {...h} />);
    expect(screen.getByText(/need at least 3 readable photos/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /make it again/i }));
    expect(h.onRetry).toHaveBeenCalled();
  });

  it('a cancelled render reads as Cancelled with Make it again', () => {
    render(<MomentsResult project={mkMoment({ render: { jobId: 'j', status: 'error', percent: 0, stage: 'error', error: 'Cancelled.' } })} {...handlers()} />);
    expect(screen.getByText('Cancelled.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /make it again/i })).toBeInTheDocument();
  });

  it('an interrupted render (a server restart) offers Make it again, not a spinner', () => {
    render(<MomentsResult project={mkMoment({ render: { jobId: 'j', status: 'interrupted', percent: 40, stage: 'shots' } })} {...handlers()} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(/was interrupted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /make it again/i })).toBeInTheDocument();
  });

  it('before any render, says to press Make it', () => {
    render(<MomentsResult project={mkMoment()} {...handlers()} />);
    expect(screen.getByText(/press make it/i)).toBeInTheDocument();
  });

  it('lists earlier renders newest first, whatever order they arrive in', () => {
    render(<MomentsResult project={mkMoment({
      history: [
        { jobId: 'b', file: '/outputs/moment-b.mp4', createdAt: 2, seed: 2 },
        { jobId: 'a', file: '/outputs/moment-a.mp4', createdAt: 1, seed: 1 },
      ],
    })} {...handlers()} />);
    const links = screen.getAllByRole('link', { name: /version/i });
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('moment-b.mp4'));
    expect(links[1]).toHaveAttribute('href', expect.stringContaining('moment-a.mp4'));
  });

  it('leaves out the history entry that is the render on show, keeping the other version numbers', () => {
    render(<MomentsResult project={mkMoment({
      render: { jobId: 'b', status: 'done', percent: 100, stage: 'done', file: '/outputs/moment-b.mp4' },
      history: [
        { jobId: 'a', file: '/outputs/moment-a.mp4', createdAt: 1, seed: 1 },
        { jobId: 'b', file: '/outputs/moment-b.mp4', createdAt: 2, seed: 2 },
      ],
    })} {...handlers()} />);
    const links = screen.getAllByRole('link', { name: /version/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('moment-a.mp4'));
    expect(links[0]).toHaveTextContent(/version 1/i);
  });

  it('plays a widescreen Moment in a 16:9 frame and a portrait one in 9:16', () => {
    const done = { jobId: 'j', status: 'done' as const, percent: 100, stage: 'done', file: '/outputs/moment-x.mp4' };
    const { unmount } = render(<MomentsResult project={mkMoment({ shape: 'wide', render: done })} {...handlers()} />);
    expect(document.querySelector('video')!.className).toMatch(/aspect-video/);
    unmount();
    render(<MomentsResult project={mkMoment({ render: done })} {...handlers()} />);
    expect(document.querySelector('video')!.className).toMatch(/aspect-\[9\/16\]/);
  });
});
