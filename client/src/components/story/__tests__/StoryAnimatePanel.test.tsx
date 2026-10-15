import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoryAnimatePanel, confirmSceneSpend, CONFIRM_ABOVE_USD } from '../StoryAnimatePanel';
import { storyApi } from '../../../lib/storyApi';
import type { AnimateEstimate, StoryProject } from '../../../lib/storyTypes';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

function est(over: Partial<AnimateEstimate> = {}): AnimateEstimate {
  return {
    configured: true, quality: 'standard', running: false, clips: 6, seconds: 60, usd: 1.25, usdPerSecond: 0.0756,
    model: 'dreamina-seedance-2-0-mini-260615', resolution: '720p', sceneIds: [], month: '2026-10',
    spentUsd: 4.2, reservedUsd: 0, capUsd: 30, monthClips: 12, ...over,
  };
}
function project(over: Partial<StoryProject> = {}): StoryProject {
  return { projectId: 'p1', scenes: [], ...over } as unknown as StoryProject;
}

afterEach(() => vi.restoreAllMocks());

describe('StoryAnimatePanel', () => {
  it('shows the price and the month spend', () => {
    render(<StoryAnimatePanel project={project()} estimate={est()} quality="standard" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} />);
    expect(screen.getByRole('button', { name: /animate all 6 scenes/i })).toHaveTextContent('≈ $1.25');
    expect(screen.getByText('October: $4.20 of $30.00 used')).toBeInTheDocument();
  });

  it('starts without asking when the batch is $2 or less', async () => {
    const animate = vi.spyOn(storyApi, 'animate').mockResolvedValue(project());
    const confirm = vi.spyOn(window, 'confirm');
    const onChanged = vi.fn();
    render(<StoryAnimatePanel project={project()} estimate={est()} quality="standard" onQualityChange={vi.fn()} onChanged={onChanged} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: /animate all/i }));
    expect(confirm).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledWith('p1', 'standard');
    expect(onChanged).toHaveBeenCalled();
  });

  it('asks first above $2, and does nothing when declined', async () => {
    const animate = vi.spyOn(storyApi, 'animate').mockResolvedValue(project());
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<StoryAnimatePanel project={project()} estimate={est({ usd: 2.4 })} quality="standard" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: /animate all/i }));
    expect(window.confirm).toHaveBeenCalledWith('Animate 6 scenes for about $2.40? This is charged to your BytePlus balance.');
    expect(animate).not.toHaveBeenCalled();
  });

  it('says "scene" in the confirmation when only one is left', async () => {
    vi.spyOn(storyApi, 'animate').mockResolvedValue(project());
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<StoryAnimatePanel project={project()} estimate={est({ clips: 1, usd: 2.4 })} quality="standard" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: /animate the 1 scene left/i }));
    expect(window.confirm).toHaveBeenCalledWith('Animate 1 scene for about $2.40? This is charged to your BytePlus balance.');
  });

  it('while a new price loads, Animate is disabled with the same label, so a stale price cannot skip the question', async () => {
    const animate = vi.spyOn(storyApi, 'animate').mockResolvedValue(project());
    const confirm = vi.spyOn(window, 'confirm');
    const { rerender } = render(<StoryAnimatePanel project={project()} estimate={est()} quality="high" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} refreshing />);
    const btn = screen.getByRole('button', { name: /animate all 6 scenes/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Animate all 6 scenes · ≈ $1.25');
    await userEvent.click(btn);
    expect(confirm).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
    rerender(<StoryAnimatePanel project={project()} estimate={est()} quality="high" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} refreshing={false} />);
    expect(screen.getByRole('button', { name: /animate all 6 scenes/i })).toBeEnabled();
  });

  it('the quality select uses the shared field style, with its focus ring', () => {
    render(<StoryAnimatePanel project={project()} estimate={est()} quality="standard" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} />);
    const select = screen.getByLabelText('AI motion quality');
    expect(select.className.split(' ')).toContain('input');
    expect(select.className).not.toContain('mt-1.5');
  });

  it('while clips are being made it offers Stop instead', async () => {
    const cancel = vi.spyOn(storyApi, 'cancelAnimation').mockResolvedValue(project());
    const animating = project({ scenes: [{ id: 's', aiVideoStatus: 'generating' }] as unknown as StoryProject['scenes'] });
    render(<StoryAnimatePanel project={animating} estimate={est()} quality="standard" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: /stop ordering clips/i }));
    expect(cancel).toHaveBeenCalledWith('p1');
  });

  it('changing quality reports it', async () => {
    const onQualityChange = vi.fn();
    render(<StoryAnimatePanel project={project()} estimate={est()} quality="standard" onQualityChange={onQualityChange} onChanged={vi.fn()} busy={false} />);
    await userEvent.selectOptions(screen.getByLabelText('AI motion quality'), 'high');
    expect(onQualityChange).toHaveBeenCalledWith('high');
  });

  it('with every scene animated there is nothing to start', () => {
    render(<StoryAnimatePanel project={project()} estimate={est({ clips: 0, usd: 0 })} quality="standard" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} />);
    expect(screen.getByRole('button', { name: /every scene is animated/i })).toBeDisabled();
  });

  it('a server that is not set up shows nothing', () => {
    const { container } = render(<StoryAnimatePanel project={project()} estimate={est({ configured: false })} quality="standard" onQualityChange={vi.fn()} onChanged={vi.fn()} busy={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('confirmSceneSpend', () => {
  it('goes ahead without asking at $2 or less', () => {
    const confirm = vi.spyOn(window, 'confirm');
    expect(confirmSceneSpend(3, 0.91)).toBe(true);
    expect(confirmSceneSpend(3, CONFIRM_ABOVE_USD)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before a High-quality 12 s scene, and a no means no request', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmSceneSpend(4, 0.3744 * 12)).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith('Animate scene 4 for about $4.49? This is charged to your BytePlus balance.');
  });

  it('a yes goes ahead', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(confirmSceneSpend(1, 2.01)).toBe(true);
  });
});
