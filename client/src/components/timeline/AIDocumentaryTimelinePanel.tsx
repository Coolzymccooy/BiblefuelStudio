import { Film, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import {
  buildWorshipDocumentaryProject,
  type TimelineProject,
} from '../../lib/timelineProject';

interface AIDocumentaryTimelinePanelProps {
  onCreateProject: (project: TimelineProject) => void;
}

const CAPABILITIES = [
  'CapCut-like scene tracks for video, B-roll, VO, music, captions and effects',
  'Veo-ready AI B-roll slots for worship atmosphere, light rays and chapter transitions',
  'Face-safe default framing with Chatterbox narration and real event audio rules',
];

export function AIDocumentaryTimelinePanel({ onCreateProject }: AIDocumentaryTimelinePanelProps) {
  const handleCreate = () => {
    onCreateProject(buildWorshipDocumentaryProject({
      title: 'Worship Documentary Timeline',
      aspect: '16:9',
      targetDurationSec: 270,
    }));
  };

  return (
    <Card
      title="AI Documentary Timeline"
      tooltip="Build a structured worship-documentary edit plan that can grow into a CapCut-like multi-track timeline. Veo clips become normal B-roll assets; Chatterbox remains the default narration voice."
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-primary-500/20 bg-primary-500/5 p-3">
          <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-500/15 text-primary-200">
            <Wand2 size={18} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-100">Next-level church video workflow</p>
            <p className="mt-1 text-xs leading-relaxed text-content-secondary">
              Start with an under-5-minute worship-documentary structure, then add real footage,
              AI B-roll, scene voice-over, captions, music and effects as separate tracks.
            </p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {CAPABILITIES.map((item, idx) => (
            <div key={item} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 flex items-center gap-2 text-primary-200">
                {idx === 0 ? <Film size={14} /> : <Sparkles size={14} />}
                <span className="text-[11px] font-semibold uppercase tracking-wide">Layer {idx + 1}</span>
              </div>
              <p className="text-xs leading-relaxed text-content-secondary">{item}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-help">
            First slice: creates the project/scene backbone. Rendering continues through the existing FFmpeg pipeline while Veo is wired as a provider.
          </p>
          <Button onClick={handleCreate} className="shrink-0">
            <Sparkles size={16} className="mr-2" />
            Create worship documentary timeline
          </Button>
        </div>
      </div>
    </Card>
  );
}
