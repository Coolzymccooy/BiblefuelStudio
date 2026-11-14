import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScheduledVideosPanel } from '../ScheduledVideosPanel';
import { useAuth } from '../../hooks/useAuth';
import { api } from '../../lib/api';
import { _resetUploadConfigCacheForTest, uploadMedia } from '../../lib/mediaUpload';
import { resumableUploadToSession } from '../../lib/resumableUpload';

vi.mock('../../hooks/useAuth', async () => {
  const { create } = await import('zustand');
  return { useAuth: create(() => ({ userId: 'owner-A' as string | null, token: 'fixture-A' as string | null, isLoading: false })) };
});
const originalAdapter = axios.defaults.adapter;
const config = { resumable: true, directMaxBytes: 1024, maxBytes: 4096, maxMb: 1 };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function response(request: InternalAxiosRequestConfig, data: unknown) { return { data, status: 200, statusText: 'OK', headers: {}, config: request }; }
function setIdentity(userId: string | null, token: string | null) { api.setToken(token); useAuth.setState({ userId, token, isLoading: false }); }
beforeEach(() => { localStorage.clear(); _resetUploadConfigCacheForTest(); setIdentity('owner-A', 'fixture-A'); });
afterEach(() => { axios.defaults.adapter = originalAdapter; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('real panel → uploadMedia → ApiClient session boundary', () => {
  it.each([
    ['account change', 1024], ['same-token logout/login ABA', 1024],
    ['account change', 1], ['same-token logout/login ABA', 1],
  ])('delayed upload config blocks bytes after %s (direct cap %s), with actual Authorization inspection', async (mode, directMaxBytes) => {
    const gate = deferred<void>(); const seen: { url: string; authorization: string }[] = [];
    axios.defaults.adapter = (async request => {
      seen.push({ url: request.url!, authorization: String(request.headers.get('Authorization') || '') });
      if (request.url === '/api/social/scheduled-posts') return response(request, { posts: [] });
      if (request.url === '/api/media/upload-config') { await gate.promise; return response(request, { ...config, directMaxBytes }); }
      throw new Error(`Unexpected network upload: ${request.url}`);
    }) satisfies AxiosAdapter;
    const xhr = vi.fn(); vi.stubGlobal('XMLHttpRequest', xhr);
    render(<ScheduledVideosPanel />);
    await waitFor(() => expect(screen.getByLabelText('Finished MP4 files')).toBeEnabled());
    const file = new File(['original-A'], 'final.mp4', { type: 'video/mp4' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('original-A').buffer });
    fireEvent.change(screen.getByLabelText('Finished MP4 files'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload originals' }));
    await waitFor(() => expect(seen.some(r => r.url === '/api/media/upload-config')).toBe(true));
    await act(async () => {
      if (mode === 'account change') setIdentity('owner-B', 'fixture-B');
      else { setIdentity(null, null); setIdentity('owner-A', 'fixture-A'); }
      gate.resolve(); await gate.promise;
    });
    await waitFor(() => expect(screen.queryByText(/Original uploaded:/)).not.toBeInTheDocument());
    expect(seen.filter(r => r.url.startsWith('/api/media/'))).toEqual([{ url: '/api/media/upload-config', authorization: 'Bearer fixture-A' }]);
    expect(xhr).not.toHaveBeenCalled();
    expect(screen.queryByText(/Original videos uploaded/)).not.toBeInTheDocument();
  });
});

describe('uploadMedia optional guard boundaries with real ApiClient', () => {
  it('checks the caller generation before every storage chunk, not only the first PUT', async () => {
    let current = true; const sends = vi.fn();
    class Xhr {
      upload = {}; status = 308; onload?: () => void;
      open(_method: string, url: string) { expect(url).toBe('http://127.0.0.1:9999/session'); }
      setRequestHeader() {} getResponseHeader() { return 'bytes=0-0'; }
      send() { sends(); queueMicrotask(() => { current = false; this.onload?.(); }); }
    }
    vi.stubGlobal('XMLHttpRequest', Xhr);
    await expect(resumableUploadToSession('http://127.0.0.1:9999/session', new Blob(['AAA']), { chunkSize: 1, isCurrent: () => current })).rejects.toMatchObject({ name: 'AbortError' });
    expect(sends).toHaveBeenCalledTimes(1);
  });
  it('pre-aborted signal makes zero network requests', async () => {
    const adapter = vi.fn(); axios.defaults.adapter = adapter;
    const controller = new AbortController(); controller.abort();
    await expect(uploadMedia(new Blob(['A']), 'a.mp4', 'source-video', undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(adapter).not.toHaveBeenCalled();
  });
  it('does not return a direct response after session invalidation (already sent bytes cannot be recalled)', async () => {
    const gate = deferred<void>(); let current = true; let uploadStarted = false;
    axios.defaults.adapter = (async request => {
      if (request.url?.endsWith('upload-config')) return response(request, config);
      uploadStarted = true;
      expect(request.headers.get('Authorization')).toBe('Bearer fixture-A');
      await gate.promise; return response(request, { file: '/media/stale.mp4' });
    }) satisfies AxiosAdapter;
    const pending = uploadMedia(new Blob(['A']), 'a.mp4', 'source-video', undefined, { isCurrent: () => current });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(uploadStarted).toBe(true)); current = false; api.setToken('fixture-B'); gate.resolve(); await rejected;
  });
  it('keeps existing callers without options working', async () => {
    const seen: string[] = [];
    axios.defaults.adapter = (async request => { seen.push(request.url!); return response(request, request.url?.endsWith('upload-config') ? config : { file: '/media/original.mp4' }); }) satisfies AxiosAdapter;
    expect(await uploadMedia(new Blob(['A']), 'a.mp4', 'source-video')).toEqual({ file: '/media/original.mp4' });
    expect(seen).toEqual(['/api/media/upload-config', '/api/media/upload-source-video?filename=a.mp4']);
  });
  it('guards cached config even across its await continuation', async () => {
    axios.defaults.adapter = (async request => response(request, config)) satisfies AxiosAdapter;
    const { getUploadConfig } = await import('../../lib/mediaUpload'); await getUploadConfig();
    const upload = vi.spyOn(api, 'uploadRaw'); let current = true;
    const pending = uploadMedia(new Blob(['A']), 'a.mp4', 'source-video', undefined, { isCurrent: () => current });
    current = false; await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(upload).not.toHaveBeenCalled();
  });
  it.each(['session', 'storage', 'finalize'])('stops after invalidation during %s without later network steps or returning stale media', async stage => {
    const gate = deferred<void>(); let current = true; const seen: string[] = []; const puts: string[] = [];
    axios.defaults.adapter = (async request => {
      seen.push(request.url!);
      if (request.url?.endsWith('upload-config')) return response(request, { ...config, directMaxBytes: 1 });
      if (request.url?.endsWith('upload-session')) { if (stage === 'session') await gate.promise; return response(request, { sessionUrl: 'http://127.0.0.1:9999/session', objectPath: 'fixture/object' }); }
      if (request.url?.endsWith('upload-finalize')) { await gate.promise; return response(request, { file: '/media/stale.mp4' }); }
      throw new Error('Unexpected request');
    }) satisfies AxiosAdapter;
    class Xhr {
      upload = {}; status = 200; onload?: () => void;
      open(_method: string, url: string) { puts.push(url); }
      setRequestHeader() {} getResponseHeader() { return null; }
      send() { if (stage === 'storage') void gate.promise.then(() => this.onload?.()); else queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('XMLHttpRequest', Xhr);
    const pending = uploadMedia(new Blob(['AAA']), 'a.mp4', 'source-video', undefined, { isCurrent: () => current });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => expect(stage === 'session' ? seen.includes('/api/media/upload-session') : stage === 'storage' ? puts.length > 0 : seen.includes('/api/media/upload-finalize')).toBe(true));
    current = false; api.setToken('fixture-B'); gate.resolve(); await rejected;
    expect(puts).toHaveLength(stage === 'session' ? 0 : 1);
    expect(seen.includes('/api/media/upload-finalize')).toBe(stage === 'finalize');
  });
});
