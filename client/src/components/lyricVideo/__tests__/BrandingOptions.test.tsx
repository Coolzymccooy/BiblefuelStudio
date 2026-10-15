import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../../../lib/lyricVideoApi', () => ({ lyricVideoApi: { branding: vi.fn(), setBranding: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
import toast from 'react-hot-toast';
import { lyricVideoApi } from '../../../lib/lyricVideoApi';
import { BrandingOptions } from '../BrandingOptions';
import type { LyricBranding, LyricProject } from '../../../lib/lyricVideoTypes';

const project = { projectId: 'lv_1', title: 'My Time', artist: 'Ada', renders: [], lines: [] } as unknown as LyricProject;
const settings: LyricBranding = { logo: true, intro: true, endCard: false, hasLogo: true, logoFromSettings: true };

function show(opts: { project?: LyricProject; disabled?: boolean; onChange?: (p: LyricProject) => void } = {}) {
  return render(
    <MemoryRouter>
      <BrandingOptions project={opts.project ?? project} disabled={opts.disabled ?? false} onChange={opts.onChange ?? vi.fn()} />
    </MemoryRouter>,
  );
}
const box = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

describe('BrandingOptions', () => {
  beforeEach(() => vi.resetAllMocks());

  it('groups three checkboxes under a Branding legend, disabled while they load', async () => {
    vi.mocked(lyricVideoApi.branding).mockResolvedValue(settings);
    show();
    expect(screen.getByRole('group', { name: 'Branding' })).toBeTruthy();
    expect(box(/logo and artist name/i).disabled).toBe(true);
    expect(box(/intro credit/i).disabled).toBe(true);
    expect(box(/end card/i).disabled).toBe(true);
    await waitFor(() => expect(box(/logo and artist name/i).disabled).toBe(false));
  });

  it('shows the saved choices', async () => {
    vi.mocked(lyricVideoApi.branding).mockResolvedValue(settings);
    show();
    await waitFor(() => expect(box(/logo and artist name/i).checked).toBe(true));
    expect(lyricVideoApi.branding).toHaveBeenCalledWith('lv_1');
    expect(box(/intro credit/i).checked).toBe(true);
    expect(box(/end card/i).checked).toBe(false);
  });

  it('saves each change at once and hands the project back', async () => {
    const saved = { ...project, title: 'Saved' } as LyricProject;
    vi.mocked(lyricVideoApi.branding).mockResolvedValue(settings);
    vi.mocked(lyricVideoApi.setBranding).mockResolvedValue(saved);
    const onChange = vi.fn();
    show({ onChange });
    await waitFor(() => expect(box(/end card/i).disabled).toBe(false));
    fireEvent.click(box(/end card/i));
    await waitFor(() => expect(lyricVideoApi.setBranding).toHaveBeenCalledWith('lv_1', { endCard: true }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
    expect(box(/end card/i).checked).toBe(true);
    fireEvent.click(box(/intro credit/i));
    await waitFor(() => expect(lyricVideoApi.setBranding).toHaveBeenCalledWith('lv_1', { intro: false }));
    fireEvent.click(box(/logo and artist name/i));
    await waitFor(() => expect(lyricVideoApi.setBranding).toHaveBeenCalledWith('lv_1', { logo: false }));
  });

  it('disables the checkbox while its save runs', async () => {
    vi.mocked(lyricVideoApi.branding).mockResolvedValue(settings);
    let finish: (p: LyricProject) => void = () => undefined;
    vi.mocked(lyricVideoApi.setBranding).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    show();
    await waitFor(() => expect(box(/end card/i).disabled).toBe(false));
    fireEvent.click(box(/end card/i));
    expect(box(/end card/i).disabled).toBe(true);
    finish(project);
    await waitFor(() => expect(box(/end card/i).disabled).toBe(false));
  });

  it('puts the checkbox back and says why when the save fails', async () => {
    vi.mocked(lyricVideoApi.branding).mockResolvedValue(settings);
    vi.mocked(lyricVideoApi.setBranding).mockRejectedValue(new Error('The change was not saved.'));
    const onChange = vi.fn();
    show({ onChange });
    await waitFor(() => expect(box(/end card/i).disabled).toBe(false));
    fireEvent.click(box(/end card/i));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The change was not saved.'));
    await waitFor(() => expect(box(/end card/i).disabled).toBe(false));
    expect(box(/end card/i).checked).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables everything while a video is being made', async () => {
    vi.mocked(lyricVideoApi.branding).mockResolvedValue(settings);
    show({ disabled: true });
    await waitFor(() => expect(lyricVideoApi.branding).toHaveBeenCalled());
    await screen.findByRole('checkbox', { name: /intro credit/i });
    expect(box(/logo and artist name/i).disabled).toBe(true);
    expect(box(/intro credit/i).disabled).toBe(true);
    expect(box(/end card/i).disabled).toBe(true);
  });

  it('points to Settings when there is no logo yet', async () => {
    vi.mocked(lyricVideoApi.branding).mockResolvedValue({ ...settings, hasLogo: false });
    show();
    const link = await screen.findByRole('link', { name: /settings → branding/i });
    expect(link.getAttribute('href')).toBe('/app/settings');
    expect(screen.getByText(/no logo yet\. add one in/i)).toBeTruthy();
  });

  it('has no logo hint when a logo is uploaded', async () => {
    vi.mocked(lyricVideoApi.branding).mockResolvedValue(settings);
    show();
    await waitFor(() => expect(box(/end card/i).disabled).toBe(false));
    expect(screen.queryByText(/no logo yet/i)).toBeNull();
  });

  it('asks for the artist when the project has none', async () => {
    vi.mocked(lyricVideoApi.branding).mockResolvedValue(settings);
    show({ project: { ...project, artist: '  ' } as LyricProject });
    expect(await screen.findByText("Add the artist's name on the Song step to show it.")).toBeTruthy();
  });

  it('does not ask for the artist when there is one', async () => {
    vi.mocked(lyricVideoApi.branding).mockResolvedValue(settings);
    show();
    await waitFor(() => expect(box(/end card/i).disabled).toBe(false));
    expect(screen.queryByText(/add the artist/i)).toBeNull();
  });

  it('says so, and stays out of the way, when the options cannot be loaded', async () => {
    vi.mocked(lyricVideoApi.branding).mockRejectedValue(new Error('offline'));
    show();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('The branding options could not be loaded. The video uses your usual settings.');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
