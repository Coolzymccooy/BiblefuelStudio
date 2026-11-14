import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScheduledVideosPanel } from '../ScheduledVideosPanel';
import { api } from '../../lib/api';
import { uploadMedia } from '../../lib/mediaUpload';
import { londonToUtc, parseCampaign } from '../../lib/scheduledPosts';
const auth = vi.hoisted(() => ({ userId: 'owner-A' as string | null, isLoading: false }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: Object.assign((selector: (s: typeof auth) => unknown) => selector(auth), { getState: () => auth, subscribe: () => () => {} }) }));
vi.mock('../../lib/mediaUpload', () => ({ uploadMedia: vi.fn() }));
const future = '2099-11-18T08:00';
function file(name = 'final.mp4') {
  const f = new File(['finished'], name, { type: 'video/mp4' });
  Object.defineProperty(f, 'arrayBuffer', { value: async () => new TextEncoder().encode('finished').buffer });
  return f;
}
async function attach() { await waitFor(() => expect(screen.getByLabelText('Finished MP4 files')).toBeEnabled()); fireEvent.change(screen.getByLabelText('Finished MP4 files'), { target: { files: [file()] } }); }
async function prepare() {
  await    await attach(); fireEvent.change(screen.getByLabelText('London date and time 1'), { target: { value: future } });
  fireEvent.click(screen.getByText('TikTok — Public to everyone'));
  fireEvent.click(screen.getByRole('button', { name: 'Upload originals' }));
  await screen.findByText(/Original uploaded:/);
  fireEvent.click(screen.getByLabelText(/I reviewed/));
}
beforeEach(() => {
  localStorage.clear(); auth.userId = 'owner-A'; auth.isLoading = false;
  vi.restoreAllMocks(); vi.mocked(uploadMedia).mockReset().mockResolvedValue({ file: '/media/original.mp4', proxyPath: '/media/proxy.mp4' });
  vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { posts: [] } });
});
describe('Durable owner-scoped submissions', () => {
  const key = 'BF_FINITE_SUBMISSION_V1:owner-A';
  const hash = createHash('sha256').update('finished').digest('hex');
  const clickSchedule = () => fireEvent.click(screen.getByRole('button', { name: 'Schedule 2 posts' }));
  it('remount reconciles a committed POST with lost response without a second POST or upload', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation(async (_url, body) => {
      const saved = (body as { posts: object[] }).posts.map((p, i) => ({ ...p, id: String(i), status: 'queued', mediaSha256: hash, bytes: 8 }));
      vi.mocked(api.get).mockResolvedValue({ ok: true, status: 200, data: { posts: saved } });
      throw new Error('Response lost after commit');
    });
    const first = render(<ScheduledVideosPanel />); await prepare(); clickSchedule();
    await screen.findByRole('alert'); const persisted = JSON.parse(localStorage.getItem(key)!);
    expect(persisted.payload).toHaveLength(2); expect(persisted.rows[0]).not.toHaveProperty('file');
    first.unmount(); render(<ScheduledVideosPanel />);
    await screen.findByText(/Scheduled posts confirmed/);
    expect(post).toHaveBeenCalledTimes(1); expect(uploadMedia).toHaveBeenCalledTimes(1); expect(localStorage.getItem(key)).toBeNull();
  });
  it('remount and explicit retry retain exact uploaded URL, IDs, integrity and request without File objects', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 504, error: 'Timeout' });
    const first = render(<ScheduledVideosPanel />); await prepare(); clickSchedule(); await screen.findByRole('alert');
    const original = post.mock.calls[0]; first.unmount(); render(<ScheduledVideosPanel />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry same request' })).toBeEnabled());
    expect(post).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('Finished MP4 files')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2)); expect(post.mock.calls[1]).toEqual(original); expect(JSON.stringify(post.mock.calls[1])).toBe(JSON.stringify(original));
    expect(uploadMedia).toHaveBeenCalledTimes(1);
  });
  it('mount with mismatching queue bytes holds for review without any automatic mutation', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 504, error: 'Timeout' });
    const first = render(<ScheduledVideosPanel />); await prepare(); clickSchedule(); await screen.findByRole('alert');
    const payload = JSON.parse(localStorage.getItem(key)!).payload as object[];
    first.unmount();
    vi.mocked(api.get).mockResolvedValue({ ok: true, status: 200, data: { posts: payload.map((p, i) => ({ ...p, id: String(i), status: 'queued', mediaSha256: '0'.repeat(64), bytes: 8 })) } });
    render(<ScheduledVideosPanel />); expect(await screen.findByRole('alert')).toHaveTextContent('Critical');
    expect(post).toHaveBeenCalledTimes(1); expect(screen.getByLabelText('Finished MP4 files')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry same request' })).toBeDisabled(); expect(localStorage.getItem(key)).not.toBeNull();
  });
  it('storage write failure sends zero POSTs and retains a locked recoverable draft', async () => {
    const post = vi.spyOn(api, 'post'); render(<ScheduledVideosPanel />); await prepare();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage quota exceeded'); });
    clickSchedule(); expect(await screen.findByRole('alert')).toHaveTextContent('Storage quota');
    expect(post).not.toHaveBeenCalled(); expect(screen.getByLabelText('Finished MP4 files')).toBeDisabled();
    expect(screen.getByLabelText('Title 1')).toHaveValue('final');
  });
  it('queue GET failure after reload blocks new campaigns and retries until successful reconciliation', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 504, error: 'Timeout' });
    const first = render(<ScheduledVideosPanel />); await prepare(); clickSchedule(); await screen.findByRole('alert'); first.unmount();
    vi.mocked(api.get).mockResolvedValue({ ok: false, status: 503, error: 'Queue offline' }); render(<ScheduledVideosPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Queue offline');
    expect(screen.getByRole('button', { name: 'Retry same request' })).toBeDisabled();
    expect(screen.getByLabelText('Import campaign draft (JSON)')).toBeDisabled(); expect(post).toHaveBeenCalledTimes(1);
    vi.mocked(api.get).mockResolvedValue({ ok: true, status: 200, data: { posts: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh queue' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry same request' })).toBeEnabled());
    expect(post).toHaveBeenCalledTimes(1);
  });
  it.each(['{broken', JSON.stringify({ version: 999 }), JSON.stringify({ version: 1, owner: 'owner-A', reviewed: true, rows: [], payload: [] })])('corrupt or unknown journal fails closed without auto POST (%s)', async raw => {
    localStorage.setItem(key, raw); const post = vi.spyOn(api, 'post'); render(<ScheduledVideosPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('operator');
    expect(screen.getByLabelText('Finished MP4 files')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh queue' }));
    await waitFor(() => expect(screen.getByLabelText('Import campaign draft (JSON)')).toBeDisabled());
    expect(post).not.toHaveBeenCalled(); expect(localStorage.getItem(key)).toBe(raw);
  });
  it('account switch never displays or retries another owner journal and ignores stale upload completion', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 504, error: 'Timeout' });
    const view = render(<ScheduledVideosPanel />); await prepare(); clickSchedule(); await screen.findByRole('alert');
    auth.userId = 'owner-B'; view.rerender(<ScheduledVideosPanel />);
    await waitFor(() => expect(screen.getByLabelText('Finished MP4 files')).toBeEnabled());
    expect(screen.queryByLabelText('Title 1')).not.toBeInTheDocument(); expect(screen.queryByText('Retry same request')).not.toBeInTheDocument();
    expect(localStorage.getItem(key)).not.toBeNull(); expect(post).toHaveBeenCalledTimes(1);
    let finish!: (value: { file: string }) => void;
    vi.mocked(uploadMedia).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await attach(); fireEvent.click(screen.getByRole('button', { name: 'Upload originals' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    auth.userId = 'owner-C'; view.rerender(<ScheduledVideosPanel />);
    await act(async () => { finish({ file: '/media/owner-B.mp4' }); });
    expect(screen.queryByText(/owner-B.mp4/)).not.toBeInTheDocument(); expect(localStorage.getItem('BF_FINITE_SUBMISSION_V1:owner-C')).toBeNull();
  });
  it('upload substitution still POSTs selected A hash/bytes and rejection creates no queue records', async () => {
    vi.mocked(uploadMedia).mockResolvedValue({ file: '/media/other-owned-B.mp4' });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 400, error: 'Original integrity mismatch' });
    render(<ScheduledVideosPanel />); await prepare(); clickSchedule();
    expect(await screen.findByRole('alert')).toHaveTextContent('integrity mismatch');
    expect(post.mock.calls[0][1]).toEqual({ posts: expect.arrayContaining([expect.objectContaining({ videoUrl: '/media/other-owned-B.mp4', expectedSha256: hash, expectedBytes: 8 })]) });
    expect(screen.queryByText('Queued')).not.toBeInTheDocument(); expect(JSON.parse(localStorage.getItem(key)!).payload[0].expectedSha256).toBe(hash);
  });
});

describe('London clock and campaign', () => {
  it('converts independently of browser zone, rejects past, DST folds and gaps', () => {
    expect(londonToUtc(future, 0)).toBe('2099-11-18T08:00:00.000Z');
    expect(londonToUtc('2027-06-01T08:00', 0)).toBe('2027-06-01T07:00:00.000Z');
    expect(() => londonToUtc('2027-03-28T01:30', 0)).toThrow(/daylight/);
    expect(() => londonToUtc('2027-10-31T01:30', 0)).toThrow(/daylight/);
    expect(() => londonToUtc('2000-01-01T08:00')).toThrow(/future/);
  });
  it('preserves pending approval and ignores local paths', () => {
    const rows = parseCampaign({ version: 1, rows: [{ filename: 'final.mp4', localPath: 'C:/private.mp4', title: 'Final', caption: 'Caption', timezone: 'Europe/London', scheduledAt: null, timeApproved: false, destinations: ['youtube', 'tiktok'], youtubePrivacyStatus: 'public', tiktokPrivacyStatus: 'PUBLIC_TO_EVERYONE' }] });
    expect(rows[0].scheduledAt).toBeNull(); expect(rows[0]).not.toHaveProperty('localPath');
  });
});
describe('Scheduled videos real callbacks', () => {
  it('uploads original only, explicitly requests public per destination, and confirms with GET', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation(async (_url, body) => {
      const payload = (body as { posts: unknown[] }).posts;
      vi.mocked(api.get).mockResolvedValue({ ok: true, status: 200, data: { posts: payload.map((p, i) => ({ ...p as object, id: String(i), status: 'queued', mediaSha256: createHash('sha256').update('finished').digest('hex'), bytes: 8 })) } });
      return { ok: true, status: 200, data: { posts: [] } };
    });
    render(<ScheduledVideosPanel />); await prepare(); fireEvent.click(screen.getByRole('button', { name: 'Schedule 2 posts' }));
    await screen.findByText(/Scheduled posts confirmed/);
    const [url, body] = post.mock.calls[0]; expect(url).toBe('/api/social/scheduled-posts');
    expect(body).toEqual({ posts: [expect.objectContaining({ videoUrl: '/media/original.mp4', title: 'final', caption: 'final', timezone: 'Europe/London', destination: 'youtube', privacyStatus: 'public' }), expect.objectContaining({ destination: 'tiktok', privacyStatus: 'PUBLIC_TO_EVERYONE' })] });
    expect(api.get).toHaveBeenCalledTimes(2);
  });
  it('retains exact IDs/payload on ambiguous failure; no webhook or automatic retry', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 504, error: 'Timeout' });
    render(<ScheduledVideosPanel />); await prepare(); fireEvent.click(screen.getByRole('button', { name: 'Schedule 2 posts' }));
    await screen.findByRole('alert'); expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Title 1')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
    expect(post.mock.calls.every(([u]) => u === '/api/social/scheduled-posts')).toBe(true);
  });
  it('upload failure keeps draft; retry never schedules, then original upload succeeds', async () => {
    const post = vi.spyOn(api, 'post'); vi.mocked(uploadMedia).mockRejectedValueOnce(new Error('Upload failed'));
    render(<ScheduledVideosPanel />); await    await attach(); fireEvent.click(screen.getByRole('button', { name: 'Upload originals' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed'); expect(screen.getByLabelText('Title 1')).toHaveValue('final');
    fireEvent.click(screen.getByRole('button', { name: 'Upload originals' })); await screen.findByText(/Original uploaded/); expect(post).not.toHaveBeenCalled();
  });
  it('holds blank and past dates and refuses a proxy returned as original', async () => {
    const post = vi.spyOn(api, 'post'); render(<ScheduledVideosPanel />); await    await attach();
    vi.mocked(uploadMedia).mockResolvedValueOnce({ file: '/media/proxy.mp4', proxyPath: '/media/proxy.mp4' });
    fireEvent.click(screen.getByRole('button', { name: 'Upload originals' })); expect(await screen.findByRole('alert')).toHaveTextContent('original video');
    fireEvent.click(screen.getByRole('button', { name: 'Upload originals' })); await screen.findByText(/Original uploaded/);
    fireEvent.click(screen.getByLabelText(/I reviewed/)); fireEvent.click(screen.getByRole('button', { name: 'Schedule 1 posts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('date and time');
    fireEvent.change(screen.getByLabelText('London date and time 1'), { target: { value: '2000-01-01T08:00' } }); fireEvent.click(screen.getByLabelText(/I reviewed/)); fireEvent.click(screen.getByRole('button', { name: 'Schedule 1 posts' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('future')); expect(post).not.toHaveBeenCalled();
  });
  it('campaign attachment requires exact filename and verified hash/bytes before upload', async () => {
    const manifest = { version: 1, rows: [{ filename: 'final.mp4', title: 'Final', caption: 'Caption', timezone: 'Europe/London', scheduledAt: '2099-11-18T08:00:00Z', destinations: ['youtube','tiktok'], youtubePrivacyStatus: 'public', tiktokPrivacyStatus: 'PUBLIC_TO_EVERYONE', sha256: '0'.repeat(64), bytes: 8 }] };
    render(<ScheduledVideosPanel />); await waitFor(() => expect(screen.getByLabelText('Import campaign draft (JSON)')).toBeEnabled());
    const json = new File([], 'campaign.json'); Object.defineProperty(json, 'text', { value: async () => JSON.stringify(manifest) });
    fireEvent.change(screen.getByLabelText('Import campaign draft (JSON)'), { target: { files: [json] } });
    await screen.findByText(/Draft imported only/);
    fireEvent.change(screen.getByLabelText('Finished MP4 files'), { target: { files: [file('wrong.mp4')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('exactly match');
    await    await attach(); fireEvent.click(screen.getByRole('button', { name: 'Upload originals' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('SHA-256 does not match'); expect(uploadMedia).not.toHaveBeenCalled();
  });
  it('keeps draft when successful POST has no independent readback', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { posts: [] } });
    render(<ScheduledVideosPanel />); await prepare(); fireEvent.click(screen.getByRole('button', { name: 'Schedule 2 posts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('readback'); expect(screen.getByLabelText('Title 1')).toHaveValue('final');
  });
  it('schedules only included approved rows and keeps pending manifest times blank after readback', async () => {
    const hash = createHash('sha256').update('finished').digest('hex');
    const base = { title: 'Final', caption: 'Caption', timezone: 'Europe/London', destinations: ['youtube','tiktok'], youtubePrivacyStatus: 'public', tiktokPrivacyStatus: 'PUBLIC_TO_EVERYONE', sha256: hash, bytes: 8 };
    const manifest = { version: 1, rows: [{ ...base, filename: 'final.mp4', scheduledAt: '2099-11-18T08:00:00Z', timeApproved: true }, { ...base, filename: 'night.mp4', scheduledAt: null, timeApproved: false }] };
    const post = vi.spyOn(api, 'post').mockImplementation(async (_url, body) => {
      const posts = (body as { posts: object[] }).posts.map((p, i) => ({ ...p, id: String(i), status: 'queued', mediaSha256: hash, bytes: 8 }));
      vi.mocked(api.get).mockResolvedValue({ ok: true, status: 200, data: { posts } }); return { ok: true, status: 200 };
    });
    render(<ScheduledVideosPanel />); await waitFor(() => expect(screen.getByLabelText('Import campaign draft (JSON)')).toBeEnabled()); const json = new File([], 'campaign.json'); Object.defineProperty(json, 'text', { value: async () => JSON.stringify(manifest) });
    fireEvent.change(screen.getByLabelText('Import campaign draft (JSON)'), { target: { files: [json] } }); await screen.findByText(/Draft imported only/);
    expect(screen.getByLabelText('Include video 2 in batch')).not.toBeChecked(); expect(screen.getByLabelText('London date and time 2')).toHaveValue('');
    await    await attach(); fireEvent.click(screen.getByRole('button', { name: 'Upload originals' })); await screen.findByText(/Original uploaded/);
    fireEvent.click(screen.getByLabelText(/I reviewed/)); fireEvent.click(screen.getByRole('button', { name: 'Schedule 2 posts' })); await screen.findByText(/Scheduled posts confirmed/);
    expect(uploadMedia).toHaveBeenCalledTimes(1); expect(post).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1. night.mp4')).toBeInTheDocument(); expect(screen.getByLabelText('London date and time 1')).toHaveValue('');
  });
  it('retains draft and cancels only its exact queued records if readback has different original bytes', async () => {
    let saved: object[] = [];
    const post = vi.spyOn(api, 'post').mockImplementation(async (url, body) => {
      if (url.endsWith('/cancel')) {
        const id = url.split('/').at(-2);
        saved = saved.map(p => (p as { id: string }).id === id ? { ...p, status: 'cancelled' } : p);
      } else {
        saved = (body as { posts: object[] }).posts.map((p, i) => ({ ...p, id: String(i), status: 'queued', mediaSha256: '0'.repeat(64), bytes: 8 }));
      }
      vi.mocked(api.get).mockResolvedValue({ ok: true, status: 200, data: { posts: saved } }); return { ok: true, status: 200 };
    });
    render(<ScheduledVideosPanel />); await prepare(); fireEvent.click(screen.getByRole('button', { name: 'Schedule 2 posts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('does not match'); expect(screen.getByLabelText('Title 1')).toHaveValue('final');
    expect(saved).toHaveLength(2); expect(saved.every(p => (p as { status: string }).status === 'cancelled')).toBe(true);
    expect(post.mock.calls.filter(([url]) => url.endsWith('/cancel')).map(([url]) => url)).toEqual(['/api/social/scheduled-posts/0/cancel', '/api/social/scheduled-posts/1/cancel']);
  });
  it('shows honest terminal states and only queued cancellation with readback', async () => {
    const posts = ['queued','published','accepted','draft','needs_review','failed'].map((status, i) => ({ id: String(i), status, title: status, scheduledAt: future, timezone: 'Europe/London', privacyStatus: 'public', destination: 'youtube' }));
    vi.mocked(api.get).mockResolvedValue({ ok: true, status: 200, data: { posts } });
    const post = vi.spyOn(api, 'post').mockImplementation(async () => { vi.mocked(api.get).mockResolvedValue({ ok: true, status: 200, data: { posts: posts.map(p => ({ ...p, status: p.id === '0' ? 'cancelled' : p.status })) } }); return { ok: true, status: 200 }; });
    render(<ScheduledVideosPanel />); const cancel = await screen.findByRole('button', { name: 'Cancel queued post' }); expect(screen.getAllByRole('button', { name: 'Cancel queued post' })).toHaveLength(1);
    expect(screen.getByText(/inbox draft — not public/)).toBeInTheDocument(); expect(screen.getByText(/publication not confirmed/)).toBeInTheDocument(); expect(screen.getByText(/outcome uncertain/)).toBeInTheDocument();
    fireEvent.click(cancel); await screen.findByText('Cancellation confirmed.'); expect(post).toHaveBeenCalledWith('/api/social/scheduled-posts/0/cancel', {});
  });
});
