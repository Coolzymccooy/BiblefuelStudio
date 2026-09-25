import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { AmbientMotionPanel } from '../AmbientMotionPanel';
import { ambientApi } from '../../../lib/ambientApi';
import type { AmbientProject } from '../../../lib/ambientTypes';

const project = (motion: 'still' | 'drift' = 'still') => ({
  projectId: 'p1', targetSec: 7200, motion,
} as AmbientProject);

beforeEach(() => vi.restoreAllMocks());

describe('AmbientMotionPanel', () => {
  it('offers still or gentle drift, with the current choice selected', () => {
    render(<AmbientMotionPanel project={project('still')} locked={false} refresh={() => {}} />);
    expect(screen.getByRole('radio', { name: /still/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /gentle drift/i })).not.toBeChecked();
  });

  it('says what each costs in render time for this session', () => {
    render(<AmbientMotionPanel project={project('still')} locked={false} refresh={() => {}} />);
    expect(screen.getByRole('radio', { name: /still/i })).toHaveAccessibleDescription(/40 minutes/);
    expect(screen.getByRole('radio', { name: /gentle drift/i })).toHaveAccessibleDescription(/50 minutes/);
  });

  it('saves the choice and refreshes', async () => {
    const set = vi.spyOn(ambientApi, 'setMotion').mockResolvedValue(project('drift'));
    const refresh = vi.fn();
    render(<AmbientMotionPanel project={project('still')} locked={false} refresh={refresh} />);
    await userEvent.click(screen.getByRole('radio', { name: /gentle drift/i }));
    expect(set).toHaveBeenCalledWith('p1', 'drift');
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('a failed save is reported, not swallowed', async () => {
    vi.spyOn(ambientApi, 'setMotion').mockRejectedValue(new Error('this session is rendering'));
    const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
    render(<AmbientMotionPanel project={project('still')} locked={false} refresh={() => {}} />);
    await userEvent.click(screen.getByRole('radio', { name: /gentle drift/i }));
    await waitFor(() => expect(error).toHaveBeenCalledWith('this session is rendering'));
  });

  it('works like a radio group from the keyboard: one tab stop, arrows move the choice', async () => {
    const set = vi.spyOn(ambientApi, 'setMotion').mockResolvedValue(project('drift'));
    render(<AmbientMotionPanel project={project('still')} locked={false} refresh={() => {}} />);
    const still = screen.getByRole('radio', { name: /still/i });
    const drift = screen.getByRole('radio', { name: /gentle drift/i });
    expect(still).toHaveAttribute('tabindex', '0');
    expect(drift).toHaveAttribute('tabindex', '-1');
    still.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(drift).toHaveFocus();
    expect(set).toHaveBeenCalledWith('p1', 'drift');
  });

  it("can't be changed while a stage is running", () => {
    render(<AmbientMotionPanel project={project('still')} locked refresh={() => {}} />);
    expect(screen.getByRole('radio', { name: /gentle drift/i })).toBeDisabled();
  });
});
