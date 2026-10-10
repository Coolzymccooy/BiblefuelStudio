import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnimationPicker } from '../AnimationPicker';
import { api } from '../../../lib/api';

const catalogue = (libass: boolean) => ({
  ok: true,
  data: {
    ok: true,
    animations: [{ id: 'karaoke-pop', label: 'Karaoke Pop', description: 'Pop', presetId: 'karaoke-pop', renderable: true, unsupported: [] }],
    studioLooks: [{ id: 'studio-lagos-night', label: 'Lagos Night', description: 'Yellow brush hits' }],
    libass,
  },
});

afterEach(() => vi.restoreAllMocks());

describe('AnimationPicker Studio looks', () => {
  it('lists Studio looks only when asked to', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(catalogue(true) as any);
    const { unmount } = render(<AnimationPicker defaultOpen />);
    await screen.findByText('Karaoke Pop');
    expect(screen.queryByText('Lagos Night')).toBeNull();
    unmount();
    render(<AnimationPicker defaultOpen showStudio />);
    expect(await screen.findByText('Lagos Night')).toBeInTheDocument();
  });

  it('picking a Studio look reports its id', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'get').mockResolvedValue(catalogue(true) as any);
    const onChange = vi.fn();
    render(<AnimationPicker defaultOpen showStudio onChange={onChange} />);
    await user.click(await screen.findByRole('button', { name: /Lagos Night/ }));
    expect(onChange).toHaveBeenCalledWith('studio-lagos-night');
  });

  it('disables Studio looks where the server has no libass', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(catalogue(false) as any);
    render(<AnimationPicker defaultOpen showStudio />);
    expect(await screen.findByRole('button', { name: /Lagos Night/ })).toBeDisabled();
  });
});
