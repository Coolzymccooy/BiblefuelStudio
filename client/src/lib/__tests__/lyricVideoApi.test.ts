import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({
  api: { get: vi.fn(), getText: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../mediaUpload', () => ({ uploadMedia: vi.fn() }));

import { api } from '../api';
import { uploadMedia } from '../mediaUpload';
import { lyricVideoApi } from '../lyricVideoApi';

const project = { projectId: 'lv_1', title: 'T', lines: [] };
const reply = (data: unknown) => ({ ok: true, status: 200, data });

describe('lyricVideoApi', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates a project', async () => {
    vi.mocked(api.post).mockResolvedValue(reply({ project }));
    await expect(lyricVideoApi.create('T', 'A')).resolves.toEqual(project);
    expect(api.post).toHaveBeenCalledWith('/api/lyric-video', { title: 'T', artist: 'A' });
  });

  it('lists projects', async () => {
    const projects = [{ projectId: 'lv_1', title: 'T', artist: '', updatedAt: 'x', hasRender: false }];
    vi.mocked(api.get).mockResolvedValue(reply({ projects }));
    await expect(lyricVideoApi.list()).resolves.toEqual(projects);
    expect(api.get).toHaveBeenCalledWith('/api/lyric-video');
  });

  it('lists every video made, from the renders route', async () => {
    const renders = [{ projectId: 'lv_1', title: 'T', artist: '', jobId: 'j', aspect: 'portrait', quality: '720p', status: 'done', at: 'x' }];
    vi.mocked(api.get).mockResolvedValue(reply({ renders }));
    await expect(lyricVideoApi.renders()).resolves.toEqual(renders);
    expect(api.get).toHaveBeenCalledWith('/api/lyric-video/renders');
  });

  it('gets and removes a project', async () => {
    vi.mocked(api.get).mockResolvedValue(reply({ project }));
    vi.mocked(api.delete).mockResolvedValue(reply({}));
    await expect(lyricVideoApi.get('lv_1')).resolves.toEqual(project);
    expect(api.get).toHaveBeenCalledWith('/api/lyric-video/lv_1');
    await expect(lyricVideoApi.remove('lv_1')).resolves.toBeUndefined();
    expect(api.delete).toHaveBeenCalledWith('/api/lyric-video/lv_1');
  });

  it('reads and saves the artist preference', async () => {
    vi.mocked(api.get).mockResolvedValue(reply({ artist: 'Ada' }));
    vi.mocked(api.put).mockResolvedValue(reply({ artist: 'Ada' }));
    await expect(lyricVideoApi.prefs()).resolves.toEqual({ artist: 'Ada' });
    expect(api.get).toHaveBeenCalledWith('/api/lyric-video/prefs');
    await lyricVideoApi.setPrefs('Ada');
    expect(api.put).toHaveBeenCalledWith('/api/lyric-video/prefs', { artist: 'Ada' });
  });

  it('throws the server message', async () => {
    vi.mocked(api.put).mockResolvedValue({ ok: false, status: 400, error: 'Paste the lyrics, one line per line.' });
    await expect(lyricVideoApi.setSheet('lv_1', ' ')).rejects.toThrow('Paste the lyrics');
  });

  it('throws a plain sentence when the server gave none', async () => {
    vi.mocked(api.put).mockResolvedValue({ ok: false, status: 500 });
    await expect(lyricVideoApi.setSheet('lv_1', 'x')).rejects.toThrow('Something went wrong');
  });

  it('turns the daily-limit refusal into a friendly sentence', async () => {
    vi.mocked(api.post).mockResolvedValue({
      ok: false, status: 429, error: 'QUOTA_EXCEEDED', data: { error: 'QUOTA_EXCEEDED', bucket: 'render', used: 3, limit: 3 },
    });
    await expect(lyricVideoApi.render('lv_1', 'portrait', '720p')).rejects.toThrow(
      "You've used today's free renders — upgrade to Premium or come back tomorrow.",
    );
    await expect(lyricVideoApi.align('lv_1')).rejects.toThrow(/today's free renders/);
  });

  it("shows the server's own sentence for a refusal that is not the daily limit", async () => {
    vi.mocked(api.post).mockResolvedValue({
      ok: false, status: 429, error: 'You already have a video being made — wait for it to finish.',
    });
    await expect(lyricVideoApi.render('lv_1', 'portrait', '720p')).rejects.toThrow('You already have a video being made');
  });

  it('turns raw network messages into a plain sentence', async () => {
    const plain = "Couldn't reach the server — check your connection and try again.";
    vi.mocked(api.get).mockResolvedValue({ ok: false, status: 500, error: 'Network Error' });
    await expect(lyricVideoApi.get('lv_1')).rejects.toThrow(plain);
    vi.mocked(api.get).mockResolvedValue({ ok: false, status: 500, error: 'timeout of 15000ms exceeded' });
    await expect(lyricVideoApi.get('lv_1')).rejects.toThrow(plain);
  });

  it('never shows a raw "Request failed with status code" message', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: false, status: 429, error: 'Request failed with status code 429' });
    await expect(lyricVideoApi.align('lv_1')).rejects.toThrow('Something went wrong');
  });

  it('turns raw upload failures into plain sentences', async () => {
    const f = new File(['x'], 'song.mp3');
    vi.mocked(uploadMedia).mockRejectedValue(new Error('Network Error'));
    await expect(lyricVideoApi.uploadSong('lv_1', f)).rejects.toThrow("Couldn't reach the server — check your connection and try again.");
    vi.mocked(uploadMedia).mockRejectedValue(new Error('timeout of 600000ms exceeded'));
    await expect(lyricVideoApi.uploadBackground('lv_1', f)).rejects.toThrow("Couldn't reach the server");
    vi.mocked(uploadMedia).mockRejectedValue(new Error('Request failed with status code 413'));
    await expect(lyricVideoApi.uploadSong('lv_1', f)).rejects.toThrow('That file is too big to upload.');
    vi.mocked(uploadMedia).mockRejectedValue(new Error('File is 2000 MB. The maximum is 1024 MB.'));
    await expect(lyricVideoApi.uploadSong('lv_1', f)).rejects.toThrow('File is 2000 MB. The maximum is 1024 MB.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('uploads the song then attaches it', async () => {
    vi.mocked(uploadMedia).mockResolvedValue({ file: '/app/outputs/source-video-1.mp4' });
    vi.mocked(api.post).mockResolvedValue(reply({ project }));
    const f = new File(['x'], 'song.mp4', { type: 'video/mp4' });
    await lyricVideoApi.uploadSong('lv_1', f);
    expect(uploadMedia).toHaveBeenCalledWith(f, 'song.mp4', 'source-video', undefined);
    expect(api.post).toHaveBeenCalledWith(
      '/api/lyric-video/lv_1/song', { path: '/app/outputs/source-video-1.mp4' }, undefined, { timeout: 60_000 },
    );
  });

  it('forwards upload progress', async () => {
    vi.mocked(uploadMedia).mockResolvedValue({ file: '/o/s.mp3' });
    vi.mocked(api.post).mockResolvedValue(reply({ project }));
    const f = new File(['x'], 'song.mp3', { type: 'audio/mpeg' });
    const onProgress = vi.fn();
    await lyricVideoApi.uploadSong('lv_1', f, onProgress);
    expect(uploadMedia).toHaveBeenCalledWith(f, 'song.mp3', 'audio', onProgress);
  });

  it('uploads a sound file as audio and a video as video, by type or else by name', async () => {
    vi.mocked(uploadMedia).mockResolvedValue({ file: '/o/s' });
    vi.mocked(api.post).mockResolvedValue(reply({ project }));
    const cases: Array<[File, string]> = [
      [new File(['x'], 'song.wav', { type: 'audio/wav' }), 'audio'],
      [new File(['x'], 'memo.m4a', { type: 'audio/x-m4a' }), 'audio'],
      [new File(['x'], 'memo.M4A'), 'audio'],
      [new File(['x'], 'bounce.aiff'), 'audio'],
      [new File(['x'], 'clip.mp4', { type: 'video/mp4' }), 'source-video'],
      [new File(['x'], 'clip.mov'), 'source-video'],
    ];
    for (const [file, kind] of cases) {
      vi.mocked(uploadMedia).mockClear();
      await lyricVideoApi.uploadSong('lv_1', file);
      expect(uploadMedia, file.name).toHaveBeenCalledWith(file, file.name, kind, undefined);
    }
  });

  it('judges a file with a generic or unrecognised type by its name', async () => {
    vi.mocked(uploadMedia).mockResolvedValue({ file: '/o/s' });
    vi.mocked(api.post).mockResolvedValue(reply({ project }));
    const generic = 'application/octet-stream';
    const cases: Array<[File, string]> = [
      [new File(['x'], 'bounce.caf', { type: generic }), 'audio'],
      [new File(['x'], 'take.aiff', { type: generic }), 'audio'],
      [new File(['x'], 'master.FLAC', { type: generic }), 'audio'],
      [new File(['x'], 'memo.m4a', { type: generic }), 'audio'],
      [new File(['x'], 'song.mp3', { type: 'application/x-unknown' }), 'audio'],
      [new File(['x'], 'clip.mov', { type: generic }), 'source-video'],
      [new File(['x'], 'clip.mp4', { type: generic }), 'source-video'],
      [new File(['x'], 'clip.webm', { type: generic }), 'source-video'],
      [new File(['x'], 'mystery.bin', { type: generic }), 'source-video'],
      [new File(['x'], 'noext', { type: generic }), 'source-video'],
    ];
    for (const [file, kind] of cases) {
      vi.mocked(uploadMedia).mockClear();
      await lyricVideoApi.uploadSong('lv_1', file);
      expect(uploadMedia, `${file.name} (${file.type})`).toHaveBeenCalledWith(file, file.name, kind, undefined);
    }
  });

  it('trusts an explicit video type over an audio-looking name', async () => {
    vi.mocked(uploadMedia).mockResolvedValue({ file: '/o/s' });
    vi.mocked(api.post).mockResolvedValue(reply({ project }));
    const f = new File(['x'], 'clip.m4a', { type: 'video/mp4' });
    await lyricVideoApi.uploadSong('lv_1', f);
    expect(uploadMedia).toHaveBeenCalledWith(f, 'clip.m4a', 'source-video', undefined);
  });

  it('does not attach a song that failed to upload', async () => {
    vi.mocked(uploadMedia).mockResolvedValue({ file: '' });
    const f = new File(['x'], 'song.mp3');
    await expect(lyricVideoApi.uploadSong('lv_1', f)).rejects.toThrow('did not upload');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sets the sheet and starts timing', async () => {
    vi.mocked(api.put).mockResolvedValue(reply({ project }));
    vi.mocked(api.post).mockResolvedValue(reply({ project }));
    await lyricVideoApi.setSheet('lv_1', 'la la');
    expect(api.put).toHaveBeenCalledWith('/api/lyric-video/lv_1/sheet', { sheet: 'la la' });
    await lyricVideoApi.align('lv_1');
    expect(api.post).toHaveBeenCalledWith('/api/lyric-video/lv_1/align', {});
  });

  it('patches a line', async () => {
    vi.mocked(api.patch).mockResolvedValue(reply({ project }));
    await lyricVideoApi.patchLine('lv_1', 'l3', { start: 12.4 });
    expect(api.patch).toHaveBeenCalledWith('/api/lyric-video/lv_1/lines/l3', { start: 12.4 });
  });

  it('sets the look', async () => {
    vi.mocked(api.put).mockResolvedValue(reply({ project }));
    await lyricVideoApi.setLook('lv_1', { energy: 'calm', seed: 4 });
    expect(api.put).toHaveBeenCalledWith('/api/lyric-video/lv_1/look', { energy: 'calm', seed: 4 });
  });

  it('sets and clears the background', async () => {
    vi.mocked(api.put).mockResolvedValue(reply({ project }));
    await lyricVideoApi.setBackground('lv_1', '/o/b.jpg', 'cover');
    expect(api.put).toHaveBeenCalledWith(
      '/api/lyric-video/lv_1/background', { path: '/o/b.jpg', fit: 'cover' }, undefined, { timeout: 60_000 },
    );
    await lyricVideoApi.setBackground('lv_1', null);
    expect(api.put).toHaveBeenLastCalledWith('/api/lyric-video/lv_1/background', { path: null }, undefined, { timeout: 60_000 });
  });

  it('uploads a background then attaches it', async () => {
    vi.mocked(uploadMedia).mockResolvedValue({ file: '/o/bg.mp4', kind: 'video' });
    vi.mocked(api.put).mockResolvedValue(reply({ project }));
    const f = new File(['x'], 'bg.mp4', { type: 'video/mp4' });
    await lyricVideoApi.uploadBackground('lv_1', f);
    expect(uploadMedia).toHaveBeenCalledWith(f, 'bg.mp4', 'background', undefined);
    expect(api.put).toHaveBeenCalledWith('/api/lyric-video/lv_1/background', { path: '/o/bg.mp4' }, undefined, { timeout: 60_000 });
  });

  it('builds the captions link and reads the captions as text', async () => {
    expect(lyricVideoApi.captionsUrl('lv_1', 720, 1280)).toBe('/api/lyric-video/lv_1/captions.ass?w=720&h=1280');
    vi.mocked(api.getText).mockResolvedValue('[Script Info]');
    await expect(lyricVideoApi.captions('lv_1', 720, 1280)).resolves.toBe('[Script Info]');
    expect(api.getText).toHaveBeenCalledWith('/api/lyric-video/lv_1/captions.ass?w=720&h=1280');
  });

  it('starts a render and returns the job id', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, status: 202, data: { jobId: 'job-9' } });
    await expect(lyricVideoApi.render('lv_1', 'portrait', '720p')).resolves.toBe('job-9');
    expect(api.post).toHaveBeenCalledWith('/api/lyric-video/lv_1/render', { aspect: 'portrait', quality: '720p', shortsTrim: false });
  });

  it('sends the Shorts trim with the render when asked', async () => {
    vi.mocked(api.post).mockResolvedValue({ ok: true, status: 202, data: { jobId: 'job-9' } });
    await lyricVideoApi.render('lv_1', 'portrait', '720p', true);
    expect(api.post).toHaveBeenCalledWith('/api/lyric-video/lv_1/render', { aspect: 'portrait', quality: '720p', shortsTrim: true });
  });

  it('reads the branding options', async () => {
    const branding = { logo: true, intro: false, endCard: true, hasLogo: false, logoFromSettings: true };
    vi.mocked(api.get).mockResolvedValue(reply({ branding }));
    await expect(lyricVideoApi.branding('lv_1')).resolves.toEqual(branding);
    expect(api.get).toHaveBeenCalledWith('/api/lyric-video/lv_1/branding');
  });

  it('saves a branding change and returns the project', async () => {
    vi.mocked(api.put).mockResolvedValue(reply({ project }));
    await expect(lyricVideoApi.setBranding('lv_1', { intro: false })).resolves.toEqual(project);
    expect(api.put).toHaveBeenCalledWith('/api/lyric-video/lv_1/branding', { intro: false });
  });

  it('reads a render job and cancels it', async () => {
    const job = { jobId: 'job-9', status: 'running', progress: 40, error: null, file: null };
    vi.mocked(api.get).mockResolvedValue(reply({ job }));
    vi.mocked(api.post).mockResolvedValue(reply({}));
    await expect(lyricVideoApi.renderStatus('lv_1', 'job-9')).resolves.toEqual(job);
    expect(api.get).toHaveBeenCalledWith('/api/lyric-video/lv_1/render/job-9');
    await lyricVideoApi.cancelRender('lv_1', 'job-9');
    expect(api.post).toHaveBeenCalledWith('/api/lyric-video/lv_1/render/job-9/cancel', {});
  });
});
