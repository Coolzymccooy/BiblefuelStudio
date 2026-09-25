import { api, GENERATE_TIMEOUT_MS } from './api';
import type { LongformSection, StoryProject } from './storyTypes';

export interface LongformTemplateOption { id: string; label: string; kind: string; targetSec: number }

function unwrapProject(res: { ok: boolean; data?: any; error?: string }): StoryProject {
  if (!res.ok || !res.data?.project) throw new Error(res.error || res.data?.error || 'Request failed');
  return res.data.project as StoryProject;
}

export const longformApi = {
  async listTemplates(): Promise<LongformTemplateOption[]> {
    const res = await api.get('/api/longform/templates');
    if (!res.ok) throw new Error(res.error || 'Failed to load templates');
    return (res.data?.templates ?? []) as LongformTemplateOption[];
  },
  // Planning calls the LLM once per section; give it the long generate ceiling.
  // `script` is the operator's own text: parsed deterministically on the server
  // (no LLM), scripture fetched verbatim by reference.
  async draft(args: { idea?: string; audioPath?: string; script?: string; templateId?: string; targetSec?: number }): Promise<{ project: StoryProject; suggestion?: { templateId: string; reason: string } }> {
    const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== ''));
    const res = await api.post('/api/longform/draft', clean, undefined, { timeout: GENERATE_TIMEOUT_MS });
    return { project: unwrapProject(res), suggestion: res.data?.suggestion };
  },
  async saveSections(id: string, sections: LongformSection[]): Promise<StoryProject> {
    return unwrapProject(await api.patch(`/api/longform/${id}/sections`, { sections }));
  },
  async narrate(id: string, voiceId?: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/longform/${id}/narrate`, voiceId ? { voiceId } : {}));
  },
  /** After a failed narration: back to the outline (draft_script) with the error cleared. */
  async reopen(id: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/longform/${id}/reopen`, {}));
  },
};
