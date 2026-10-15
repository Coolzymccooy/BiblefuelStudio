import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useLyricProject } from '../hooks/useLyricProject';
import type { LyricProject } from '../lib/lyricVideoTypes';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { GuideSteps, type GuideStep } from '../components/ui/GuideSteps';
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

const GUIDE_STEPS: GuideStep[] = [
  { label: 'Upload your song', detail: "An MP3, M4A or WAV file, or a video. A video's sound is used." },
  { label: 'Paste your lyrics', detail: 'One line per line. Put section names in square brackets, like [CHORUS]. Put a crowd reply in round brackets at the end of the line it answers, like (AMEN!).' },
  { label: 'Time the lyrics', detail: 'Press Time the lyrics and wait under a minute. Then check any line marked “Check this line”.' },
  { label: 'Choose the look', detail: 'Pick a style and energy, set an effect for any line, or press Shuffle effects for a new mix.' },
  { label: 'Render and download', detail: 'Choose portrait, landscape or square, then render.' },
];

/** Keeps its children mounted but out of sight, and stops any sound they were making while it is away. */
function KeptWhileAway({ away, children }: { away: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (away) box.current?.querySelectorAll('video, audio').forEach((m) => (m as HTMLMediaElement).pause());
  }, [away]);
  return <div ref={box} hidden={away}>{children}</div>;
}

/** The five steps for a loaded project. It opens on the first step that needs something, once, and then only the user moves it. */
function LyricSteps({ project, error, onRetry }: { project: LyricProject; error: unknown; onRetry: () => void }) {
  const qc = useQueryClient();
  // Settled when the project first arrives. A project reopened while timing runs stays on Timing
  // when it finishes, so the lines to check are seen, instead of jumping on to the Look step.
  const [step, setStep] = useState<LyricStepId>(() => firstOpenStep(project));
  // The render step keeps its progress, so once opened it stays mounted (hidden) while other steps show.
  const [renderOpened, setRenderOpened] = useState(() => step === 'render');
  const onChange = (next: LyricProject) => qc.setQueryData(['lyric-project', project.projectId], next);
  const goTo = (next: LyricStepId) => { setStep(next); if (next === 'render') setRenderOpened(true); };

  return (
    <div className="space-y-6">
      {error != null && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-bf-danger">
          <span>{messageOf(error)}</span>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>Check again</button>
        </div>
      )}
      <LyricStepper project={project} step={step} onStep={goTo} />
      {step === 'song' && <SongStep project={project} onChange={onChange} onNext={() => goTo('lyrics')} />}
      {step === 'lyrics' && <LyricsStep project={project} onChange={onChange} onNext={() => goTo('timing')} />}
      {step === 'timing' && <TimingStep project={project} onChange={onChange} />}
      {step === 'look' && <LookStep project={project} onChange={onChange} />}
      {(step === 'render' || renderOpened) && (
        <KeptWhileAway away={step !== 'render'}><RenderStep project={project} onChange={onChange} /></KeptWhileAway>
      )}
    </div>
  );
}

/** One song, step by step: loads the project, then hands it to the steps. */
function LyricProjectView({ projectId }: { projectId: string }) {
  const { data: project, error, isLoading, refetch } = useLyricProject(projectId);
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
  return <LyricSteps project={project} error={error} onRetry={() => void refetch()} />;
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
      {/* On the start screen too, so a first-timer sees the whole route before uploading. */}
      <GuideSteps storageKey="lyric-video" title="How to make a lyric video" steps={GUIDE_STEPS} tip="You can go back to any step. Edited lyrics are saved when you press Read lyrics." />
      {projectId
        ? <LyricProjectView key={projectId} projectId={projectId} />
        : <LyricStart onCreated={opened} />}
      {/* The preview's word drawing ships open-source libraries whose licences ask to be credited. */}
      <p className="text-xs text-content-secondary">
        <a href="/third-party-notices.txt" target="_blank" rel="noopener noreferrer" className="underline">Open-source credits</a>
      </p>
    </div>
  );
}
