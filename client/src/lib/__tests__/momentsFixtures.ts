import type { MomentMeta, MomentProject } from '../momentsTypes';

export const META: MomentMeta = {
  occasions: [
    { id: 'birthday', label: 'Birthday', church: false, fields: ['name', 'milestone'], style: 'celebrate', energy: 0.8, song: 'library:gospel-fire' },
    { id: 'memorial', label: 'Memorial', church: true, fields: ['name', 'date', 'verse'], style: 'glow', energy: 0.15, song: 'library:prayer-piano' },
  ],
  styles: [
    { id: 'glow', label: 'Glow', description: 'Calm' }, { id: 'celebrate', label: 'Celebrate', description: 'Party' },
    { id: 'hype', label: 'Hype', description: 'Energy' }, { id: 'gallery', label: 'Gallery', description: 'Clean' },
  ],
  lengths: [15, 30, 60],
  limits: { statements: { 15: 3, 30: 5, 60: 8 }, maxStatements: 8, title: 40, statement: 60, detail: 80, minPhotos: 3, maxPhotos: 20 },
};

export function mkMoment(over: Partial<MomentProject> = {}): MomentProject {
  return {
    projectId: 'm1', createdAt: 0, updatedAt: 0, occasion: 'birthday', details: {}, photos: [], heroIndex: 0,
    sound: { song: { ref: 'library:gospel-fire', windowStartSec: null }, voiceover: null },
    title: '', statements: [], style: 'celebrate', energy: 0.8, lengthSec: 15, seed: 5, render: null, history: [], ...over,
  };
}
