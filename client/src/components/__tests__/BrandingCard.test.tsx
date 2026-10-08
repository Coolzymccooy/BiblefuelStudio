import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrandingCard, previewLogoStyle, type Branding } from '../BrandingCard';
import { api } from '../../lib/api';

const NONE: Branding = { enabled: false, position: 'top-right', size: 'medium', opacity: 0.85, hasLogo: false, logoDataUrl: null };
const WITH_LOGO: Branding = { ...NONE, enabled: true, hasLogo: true, logoDataUrl: 'data:image/png;base64,AAAA' };

beforeEach(() => { vi.restoreAllMocks(); });

describe('BrandingCard', () => {
  it('asks for a logo first, and the on switch waits for one', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { branding: NONE } });
    render(<BrandingCard />);
    expect(await screen.findByText(/no logo yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /upload logo/i })).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /add my logo/i }) as HTMLInputElement).disabled).toBe(true);
  });

  it('uploads the chosen image and shows it in the preview', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { branding: NONE } });
    const upload = vi.spyOn(api, 'uploadRaw').mockResolvedValue({ ok: true, status: 200, data: { branding: WITH_LOGO } });
    render(<BrandingCard />);
    await screen.findByText(/no logo yet/i);
    const file = new File(['png'], 'logo.png', { type: 'image/png' });
    await userEvent.upload(screen.getByTestId('logo-file'), file);
    await waitFor(() => expect(upload).toHaveBeenCalledWith('/api/branding/logo', file));
    expect(await screen.findByAltText('Your logo')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: /add my logo/i }) as HTMLInputElement).checked).toBe(true);
  });

  it('saves a new corner and moves the preview logo there', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { branding: WITH_LOGO } });
    const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => (
      { ok: true, status: 200, data: { branding: { ...WITH_LOGO, ...(body as Partial<Branding>) } } }
    ));
    render(<BrandingCard />);
    await screen.findByAltText('Your logo');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /corner/i }), 'bottom-left');
    expect(put).toHaveBeenCalledWith('/api/branding', { position: 'bottom-left' });
    const img = screen.getByAltText('Your logo') as HTMLImageElement;
    await waitFor(() => expect(img.style.bottom).toBe('4.5%'));
    expect(img.style.left).toBe('3.5%');
  });

  it('turning branding off hides the logo from the preview', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { branding: WITH_LOGO } });
    vi.spyOn(api, 'put').mockResolvedValue({ ok: true, status: 200, data: { branding: { ...WITH_LOGO, enabled: false } } });
    render(<BrandingCard />);
    await screen.findByAltText('Your logo');
    await userEvent.click(screen.getByRole('checkbox', { name: /add my logo/i }));
    await waitFor(() => expect(screen.queryByAltText('Your logo')).toBeNull());
  });

  it('a failed save puts the previous setting back', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { branding: WITH_LOGO } });
    vi.spyOn(api, 'put').mockResolvedValue({ ok: false, status: 500, error: 'nope' });
    render(<BrandingCard />);
    await screen.findByAltText('Your logo');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /size/i }), 'large');
    await waitFor(() => expect((screen.getByRole('combobox', { name: /size/i }) as HTMLSelectElement).value).toBe('medium'));
  });
});

describe('previewLogoStyle', () => {
  it('matches the renderer\'s corners and sizes', () => {
    expect(previewLogoStyle({ position: 'top-right', size: 'medium', opacity: 0.85 }))
      .toEqual({ width: '8%', opacity: 0.85, top: '4.5%', right: '3.5%' });
    expect(previewLogoStyle({ position: 'bottom-left', size: 'large', opacity: 1 }).width).toBe('10.4%');
  });
});
