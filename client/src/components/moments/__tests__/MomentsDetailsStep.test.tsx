import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MomentsDetailsStep } from '../MomentsDetailsStep';
import { momentsApi } from '../../../lib/momentsApi';
import * as errors from '../../../lib/errors';
import { META, mkMoment } from '../../../lib/__tests__/momentsFixtures';

const stepProps = () => ({ project: mkMoment(), meta: META, refresh: vi.fn(), busy: false, setBusy: vi.fn(), track: vi.fn(), commit: vi.fn() });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(errors, 'toastError').mockImplementation(() => {});
});

describe('MomentsDetailsStep', () => {
  it("shows the occasion's fields and saves a detail on blur", async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsDetailsStep {...stepProps()} />);
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Age or milestone')).toBeInTheDocument();
    expect(screen.queryByLabelText('Venue')).toBeNull();
    await userEvent.type(screen.getByLabelText('Name'), 'Tolu');
    await userEvent.tab();
    expect(update).toHaveBeenCalledWith('m1', { details: { name: 'Tolu' } });
  });

  it('a refetch mid-typing does not overwrite what is being typed', async () => {
    const p = stepProps();
    const { rerender } = render(<MomentsDetailsStep {...p} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Tol');
    rerender(<MomentsDetailsStep {...p} project={mkMoment({ details: {} })} />);
    expect(screen.getByLabelText('Name')).toHaveValue('Tol');
  });

  it('does not save when a field is left unchanged', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    render(<MomentsDetailsStep {...stepProps()} />);
    await userEvent.click(screen.getByLabelText('Name'));
    await userEvent.tab();
    expect(update).not.toHaveBeenCalled();
  });

  it('changing the occasion saves only the occasion', async () => {
    const update = vi.spyOn(momentsApi, 'update').mockResolvedValue(mkMoment());
    const p = stepProps();
    render(<MomentsDetailsStep {...p} />);
    await userEvent.selectOptions(screen.getByLabelText(/occasion/i), 'memorial');
    expect(update).toHaveBeenCalledWith('m1', { occasion: 'memorial' });
    await waitFor(() => expect(p.refresh).toHaveBeenCalled());
  });

  it('a refused save is toasted', async () => {
    const failure = new Error('Details must be strings.');
    vi.spyOn(momentsApi, 'update').mockRejectedValue(failure);
    render(<MomentsDetailsStep {...stepProps()} />);
    await userEvent.selectOptions(screen.getByLabelText(/occasion/i), 'memorial');
    await waitFor(() => expect(errors.toastError).toHaveBeenCalledWith(failure));
  });
});
