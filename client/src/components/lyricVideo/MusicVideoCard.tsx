import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { storyApi } from '../../lib/storyApi';
import { ASPECTS } from '../../lib/lyricRenderOptions';
import { musicVideoEstimate, musicVideoEstimateText, planMusicScenes } from '../../lib/musicVideoPlan';
import type { LyricProject, RenderAspect } from '../../lib/lyricVideoTypes';
import { checkboxCls, fieldLabelCls, inputCls, panelCls, primaryBtnCls, secondaryBtnCls } from '../story/formStyles';
import { messageOf } from './messageOf';

interface Props { project: LyricProject; onChange: (p: LyricProject) => void }

const CHARACTER_MAX = 300;
const storyLink = (id: string) => `/app/story?project=${encodeURIComponent(id)}`;

/**
 * "AI music video" on the Look step (super admins only), once the lyrics are timed: the song's
 * sections become a Story video of AI pictures, animated within the month's budget, and the
 * finished video can come back here as the background under the lyrics.
 */
export function MusicVideoCard({ project, onChange }: Props) {
  const isSuperAdmin = useAuth((s) => s.isSuperAdmin);
  if (!isSuperAdmin || project.timing?.status !== 'done') return null;
  return <MusicVideoPanel project={project} onChange={onChange} />;
}

/** Whether the linked Story project's video has been rendered; it is read again whenever the page comes back. */
function useStoryVideoReady(storyProjectId: string | null): boolean {
  const story = useQuery({
    queryKey: ['story-project', storyProjectId],
    queryFn: () => storyApi.getProject(storyProjectId as string),
    enabled: storyProjectId !== null,
  });
  return story.data?.render?.status === 'done';
}

function MusicVideoPanel({ project, onChange }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [character, setCharacter] = useState('');
  const [aspect, setAspect] = useState<RenderAspect>('portrait');
  const [animate, setAnimate] = useState(true);
  const [making, setMaking] = useState(false);
  const [using, setUsing] = useState(false);
  const rates = useQuery({ queryKey: ['story-animate-rates'], queryFn: () => storyApi.animateRates() });
  const linked = project.musicVideo?.storyProjectId ?? null;
  const videoReady = useStoryVideoReady(linked);

  const scenes = useMemo(
    () => planMusicScenes({
      sections: project.sections, lines: project.lines,
      durationSec: project.song?.durationSec ?? 0, audibleEnd: project.timing?.audibleEnd,
    }),
    [project.sections, project.lines, project.song?.durationSec, project.timing?.audibleEnd],
  );
  const canAnimate = rates.data?.configured === true;
  const estimate = rates.data ? musicVideoEstimateText(musicVideoEstimate(scenes, rates.data.usdPerSecond.standard)) : null;

  const make = async () => {
    setMaking(true);
    try {
      const id = await lyricVideoApi.toStory(project.projectId, { aspect, character: character.trim(), aiMotion: canAnimate && animate });
      // The song now links to the new Story project; read it again for when the user comes back.
      void qc.invalidateQueries({ queryKey: ['lyric-project', project.projectId] });
      navigate(storyLink(id));
    } catch (e) {
      toast.error(messageOf(e));
      setMaking(false);
    }
  };

  const useAsBackground = async () => {
    setUsing(true);
    try {
      onChange(await lyricVideoApi.useStoryVideo(project.projectId));
      toast.success('The AI music video is now the background.');
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setUsing(false);
    }
  };

  return (
    <section className={`${panelCls} space-y-3`} aria-labelledby="music-video-heading">
      <h3 id="music-video-heading" className="section-title">AI music video</h3>
      <p className="text-sm text-content-secondary">
        Makes a Story video with an AI picture for each part of the song ({scenes.length} {scenes.length === 1 ? 'scene' : 'scenes'}).
        The song plays as it is. Render it in Story Video, then use it here as the background, and the lyrics go on top.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="music-video-character" className={fieldLabelCls}>How the singer looks (optional)</label>
          <input
            id="music-video-character"
            className={inputCls}
            value={character}
            maxLength={CHARACTER_MAX}
            disabled={making}
            placeholder="For example: a man in his late twenties, short hair, plain olive shirt"
            onChange={(e) => setCharacter(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="music-video-shape" className={fieldLabelCls}>Shape</label>
          <select id="music-video-shape" className={inputCls} value={aspect} disabled={making} onChange={(e) => setAspect(e.target.value as RenderAspect)}>
            {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
      </div>

      {canAnimate && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-content-secondary">
            <input type="checkbox" className={checkboxCls} checked={animate} disabled={making} onChange={(e) => setAnimate(e.target.checked)} />
            Animate the scenes
          </label>
          {estimate && <span className="text-help tabular-nums">{estimate}</span>}
        </div>
      )}
      {rates.data && !canAnimate && (
        <p className="text-xs text-content-secondary">AI motion is not set up on the server, so the scenes will be still pictures.</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {linked && <Link to={storyLink(linked)} className={primaryBtnCls}>Open in Story Video</Link>}
        {linked && videoReady && (
          <button type="button" className={secondaryBtnCls} disabled={using} onClick={() => void useAsBackground()}>
            {using && <Loader2 size={16} className="animate-spin" aria-hidden />}
            Use as lyric background
          </button>
        )}
        <button type="button" className={linked ? secondaryBtnCls : primaryBtnCls} disabled={making || scenes.length === 0} onClick={() => void make()}>
          {making && <Loader2 size={16} className="animate-spin" aria-hidden />}
          {making ? 'Planning the scenes…' : linked ? 'Make a new AI music video' : 'Make AI music video'}
        </button>
      </div>
    </section>
  );
}
