import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useLyricProject } from '../hooks/useLyricProject';
import type { LyricProject } from '../lib/lyricVideoTypes';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { LyricStart } from '../components/lyricVideo/LyricStart';
import { LyricStepper } from '../components/lyricVideo/LyricStepper';
import { firstOpenStep, type LyricStepId } from '../lib/lyricSteps';
import { SongStep } from '../components/lyricVideo/SongStep';
import { LyricsStep } from '../components/lyricVideo/LyricsStep';
import { TimingStep } from '../components/lyricVideo/TimingStep';
import { LookStep } from '../components/lyricVideo/LookStep';
import { RenderStep } from '../components/lyricVideo/RenderStep';
import { messageOf } from '../components/lyricVideo/messageOf';

const header = (
  <ScreenHeader eyebrow="Studio" title={<>Lyric <em>video</em></>} subtitle="Turn your song into a lyric video." />
);

/** One song, step by step. The project lives in the query cache; each step hands back the project it changed. */
function LyricProjectView({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: project, error, isLoading, refetch } = useLyricProject(projectId);
  // The step the user picked; until they pick one, the first step that still needs something.
  const [picked, setPicked] = useState<LyricStepId | null>(null);
  // The render step keeps its progress, so once opened it stays mounted (hidden) while other steps show.
  const [renderOpened, setRenderOpened] = useState(false);

  if (isLoading) {
    return <div role="status" className="flex items-center gap-2 text-content-secondary"><Loader2 className="animate-spin" size={18} aria-hidden /> Opening your song…</div>;
  }
  if (!project) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-bf-danger">{messageOf(error)}</p>
        <Link to="/app/lyric-video" className="btn btn-secondary">Back to your songs</Link>
      </div>
    );
  }

  const step = picked ?? firstOpenStep(project);
  const onChange = (next: LyricProject) => qc.setQueryData(['lyric-project', projectId], next);
  const goTo = (next: LyricStepId) => { setPicked(next); if (next === 'render') setRenderOpened(true); };

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-bf-danger">
          <span>{messageOf(error)}</span>
          <button type="button" className="btn btn-secondary" onClick={() => void refetch()}>Check again</button>
        </div>
      )}
      <LyricStepper project={project} step={step} onStep={goTo} />
      {step === 'song' && <SongStep project={project} onChange={onChange} onNext={() => goTo('lyrics')} />}
      {step === 'lyrics' && <LyricsStep project={project} onChange={onChange} onNext={() => goTo('timing')} />}
      {step === 'timing' && <TimingStep project={project} onChange={onChange} />}
      {step === 'look' && <LookStep project={project} onChange={onChange} />}
      {(step === 'render' || renderOpened) && (
        <div hidden={step !== 'render'}><RenderStep project={project} onChange={onChange} /></div>
      )}
    </div>
  );
}

/** Studio > Lyric video: start a song, or carry on with one. */
export function LyricVideoPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const opened = (p: LyricProject) => {
    qc.setQueryData(['lyric-project', p.projectId], p);
    navigate(`/app/lyric-video/${p.projectId}`);
  };
  return (
    <div className="space-y-6">
      {header}
      {projectId
        ? <LyricProjectView key={projectId} projectId={projectId} />
        : <LyricStart onCreated={opened} />}
    </div>
  );
}
