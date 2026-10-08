import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import toast from 'react-hot-toast';
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

describe('BrandingCard, when things go wrong', () => {
  it('a settings reply without the image keeps the preview showing', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { branding: WITH_LOGO } });
    const { logoDataUrl: _omit, ...withoutImage } = WITH_LOGO;
    vi.spyOn(api, 'put').mockResolvedValue({ ok: true, status: 200, data: { branding: { ...withoutImage, size: 'large' } } });
    render(<BrandingCard />);
    await screen.findByAltText('Your logo');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /size/i }), 'large');
    await waitFor(() => expect((screen.getByAltText('Your logo') as HTMLImageElement).style.width).toBe('10.4%'));
  });

  it('opacity is saved once the slider settles, however it was moved', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { branding: WITH_LOGO } });
    const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => (
      { ok: true, status: 200, data: { branding: { ...WITH_LOGO, ...(body as Partial<Branding>) } } }
    ));
    render(<BrandingCard />);
    await screen.findByAltText('Your logo');
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '60' } });
    fireEvent.change(slider, { target: { value: '50' } });
    expect(screen.getByText(/opacity 50%/i)).toBeTruthy();
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/branding', { opacity: 0.5 }));
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('closing the page mid-drag still saves the last opacity', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { branding: WITH_LOGO } });
    const put = vi.spyOn(api, 'put').mockResolvedValue({ ok: true, status: 200, data: { branding: WITH_LOGO } });
    const { unmount } = render(<BrandingCard />);
    await screen.findByAltText('Your logo');
    fireEvent.change(screen.getByRole('slider'), { target: { value: '40' } });
    unmount();
    expect(put).toHaveBeenCalledWith('/api/branding', { opacity: 0.4 });
  });

  it('a failed load offers to try again instead of spinning forever', async () => {
    const get = vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ ok: false, status: 500, error: 'down' })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { branding: NONE } });
    render(<BrandingCard />);
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));
    expect(await screen.findByText(/no logo yet/i)).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('a logo over 5 MB is refused before uploading', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { branding: NONE } });
    const upload = vi.spyOn(api, 'uploadRaw');
    const error = vi.spyOn(toast, 'error').mockImplementation(() => '');
    render(<BrandingCard />);
    await screen.findByText(/no logo yet/i);
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await userEvent.upload(screen.getByTestId('logo-file'), big);
    expect(upload).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/over 5 MB/));
  });
});

describe('previewLogoStyle', () => {
  it('matches the renderer\'s corners and sizes', () => {
    expect(previewLogoStyle({ position: 'top-right', size: 'medium', opacity: 0.85 }))
      .toEqual({ width: '8%', opacity: 0.85, top: '4.5%', right: '3.5%' });
    expect(previewLogoStyle({ position: 'bottom-left', size: 'large', opacity: 1 }).width).toBe('10.4%');
  });
});
