import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../api';
import { storyApi } from '../storyApi';

const fakeProject = { projectId: 'p', title: 'T', status: 'draft', scenes: [] };

beforeEach(() => { vi.restoreAllMocks(); });

describe('storyApi', () => {
  it('createProject posts title+style and returns the project', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, project: fakeProject } });
    const p = await storyApi.createProject('T', 'cinematic-bible');
    expect(spy).toHaveBeenCalledWith('/api/story', { title: 'T', style: 'cinematic-bible' });
    expect(p.projectId).toBe('p');
  });

  it('getProject GETs by id', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ ok: true, status: 200, data: { ok: true, project: fakeProject } });
    await storyApi.getProject('p');
    expect(spy).toHaveBeenCalledWith('/api/story/p');
  });

  it('transcribe posts the mediaPath with the long timeout', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, project: fakeProject } });
    await storyApi.transcribe('p', '/out/a.mp3');
    expect(spy).toHaveBeenCalledWith('/api/story/p/transcribe', { mediaPath: '/out/a.mp3' }, undefined, expect.objectContaining({ timeout: expect.any(Number) }));
  });

  it('patchScene PATCHes the scene fields', async () => {
    const spy = vi.spyOn(api, 'patch').mockResolvedValue({ ok: true, status: 200, data: { ok: true, project: fakeProject } });
    await storyApi.patchScene('p', 'scene-001', { imagePrompt: 'new' });
    expect(spy).toHaveBeenCalledWith('/api/story/p/scenes/scene-001', { imagePrompt: 'new' });
  });

  it('throws the server error message on failure', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 400, error: 'no transcript to segment' });
    await expect(storyApi.segment('p')).rejects.toThrow('no transcript to segment');
  });

  it('uploadAudio returns the server file path', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, file: '/out/user-audio-1.mp3' } });
    const file = await storyApi.uploadAudio('data:audio/mp3;base64,AAA', 'sermon.mp3', () => {});
    expect(file).toBe('/out/user-audio-1.mp3');
    expect(spy).toHaveBeenCalled();
  });

  it('deleteProject DELETEs by id', async () => {
    const spy = vi.spyOn(api, 'delete').mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    await storyApi.deleteProject('p1');
    expect(spy).toHaveBeenCalledWith('/api/story/p1');
  });

  it('deleteProject throws the server error on failure', async () => {
    vi.spyOn(api, 'delete').mockResolvedValue({ ok: false, status: 404, error: 'project not found' });
    await expect(storyApi.deleteProject('nope')).rejects.toThrow('project not found');
  });

  it('scriptToAudio posts idea/template/voice and returns the audio file path', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true, file: '/out/story-tts-1.mp3', script: 'hi' } });
    const file = await storyApi.scriptToAudio('an idea', 'devotional-30', 'en-US-GuyNeural');
    expect(spy).toHaveBeenCalledWith('/api/story/script-to-audio', { idea: 'an idea', templateId: 'devotional-30', voiceId: 'en-US-GuyNeural' }, undefined, expect.objectContaining({ timeout: expect.any(Number) }));
    expect(file).toBe('/out/story-tts-1.mp3');
  });

  it('scriptToAudio throws the server error on failure', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: false, status: 502, error: 'voice synthesis failed' });
    await expect(storyApi.scriptToAudio('x', 'custom', 'v')).rejects.toThrow('voice synthesis failed');
  });

  it('setMusic PATCHes the project music', async () => {
    const spy = vi.spyOn(api, 'patch').mockResolvedValue({ ok: true, status: 200, data: { ok: true, project: { projectId: 'p' } } });
    await storyApi.setMusic('p', { path: '/m.mp3', volume: 0.3, autoDuck: true });
    expect(spy).toHaveBeenCalledWith('/api/story/p/music', { path: '/m.mp3', volume: 0.3, autoDuck: true });
  });

  it('process posts the mediaPath to /process', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, status: 200, data: { ok: true } });
    await storyApi.process('p', '/out/a.mp3');
    expect(spy).toHaveBeenCalledWith('/api/story/p/process', { mediaPath: '/out/a.mp3' }, undefined, expect.objectContaining({ timeout: expect.any(Number) }));
  });
});
