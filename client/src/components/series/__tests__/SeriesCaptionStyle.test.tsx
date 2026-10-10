import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeriesCaptionStyle } from '../SeriesCaptionStyle';
import { api } from '../../../lib/api';

afterEach(() => vi.restoreAllMocks());

const mockCatalogue = () =>
  vi.spyOn(api, 'get').mockResolvedValue({
    ok: true,
    data: { ok: true, studioLooks: [{ id: 'studio-gospel-gold', label: 'Gospel Gold' }], libass: true },
  } as any);

describe('SeriesCaptionStyle', () => {
  it('defaults to the scripture style and offers Studio looks', async () => {
    mockCatalogue();
    const onChange = vi.fn();
    render(<SeriesCaptionStyle value="" onChange={onChange} energy="lively" onEnergyChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Caption style' });
    expect(select).toHaveValue('');
    await screen.findByRole('option', { name: 'Gospel Gold' });
    await userEvent.setup().selectOptions(select, 'studio-gospel-gold');
    expect(onChange).toHaveBeenCalledWith('studio-gospel-gold');
  });

  it('a Studio look shows Energy and no Shuffle (each part gets its own mix)', async () => {
    mockCatalogue();
    const onEnergyChange = vi.fn();
    render(<SeriesCaptionStyle value="studio-gospel-gold" onChange={vi.fn()} energy="lively" onEnergyChange={onEnergyChange} />);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Energy' }), 'calm');
    expect(onEnergyChange).toHaveBeenCalledWith('calm');
    expect(screen.queryByRole('button', { name: /shuffle effects/i })).toBeNull();
  });

  it('a saved Studio look on a server without libass shows a disabled Energy and says why', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      ok: true,
      data: { ok: true, studioLooks: [{ id: 'studio-gospel-gold', label: 'Gospel Gold' }], libass: false },
    } as any);
    render(<SeriesCaptionStyle value="studio-gospel-gold" onChange={vi.fn()} energy="lively" onEnergyChange={vi.fn()} />);
    expect(await screen.findByText(/Studio effects unavailable on this server/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Energy' })).toBeDisabled();
  });
});
