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
  async draft(args: { idea: string; templateId: string; targetSec?: number }): Promise<StoryProject> {
    return unwrapProject(await api.post('/api/longform/draft', args, undefined, { timeout: GENERATE_TIMEOUT_MS }));
  },
  async saveSections(id: string, sections: LongformSection[]): Promise<StoryProject> {
    return unwrapProject(await api.patch(`/api/longform/${id}/sections`, { sections }));
  },
  async narrate(id: string, voiceId?: string): Promise<StoryProject> {
    return unwrapProject(await api.post(`/api/longform/${id}/narrate`, voiceId ? { voiceId } : {}));
  },
};
