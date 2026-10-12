import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { MusicPicker } from '../MusicPicker';
import { momentsApi } from '../../lib/momentsApi';
import { api } from '../../lib/api';
import { toastError } from '../../lib/errors';
import { STORY_VOICES } from '../../lib/storyScript';
import type { MomentPatch } from '../../lib/momentsTypes';
import type { MomentStepProps } from '../../pages/MomentsPage';
import { fieldLabelCls, inputCls, panelCls, primaryBtnCls, secondaryBtnCls } from '../story/formStyles';

const MIN_SCRIPT_CHARS = 3;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function MomentsSoundStep({ project, meta, refresh, busy, setBusy }: MomentStepProps) {
  const song = project.sound.song;
  const vo = project.sound.voiceover;
  const [script, setScript] = useState('');
  const [voiceId, setVoiceId] = useState(vo?.voiceId || STORY_VOICES[0].id);
  const [making, setMaking] = useState(false);
  const { data, error } = useQuery({
    queryKey: ['moment-song-window', project.projectId, song?.ref, song?.windowStartSec, project.lengthSec],
    queryFn: () => momentsApi.songWindow(project.projectId),
    enabled: Boolean(song),
    // Keep the slider on screen while a nudge on the SAME song is saved and re-read; a different song
    // (key index 2 is the song ref) shows no slider until its own analysis lands.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === song?.ref ? prev : undefined),
  });
  // A query that was disabled by "No music" can still hold the old song's data or error.
  const win = song ? data : undefined;
  const winError = song ? error : null;
  const [start, setStart] = useState(0);
  /** The slider's own save is running: it stays enabled so the keyboard focus is not lost on every arrow press. */
  const [nudging, setNudging] = useState(false);
  useEffect(() => { if (win) setStart(win.windowStartSec); }, [win]);

  const save = async (patch: MomentPatch) => {
    setBusy(true);
    try {
      await momentsApi.update(project.projectId, patch);
      refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const makeVoice = async (body: { script?: string; idea?: string }) => {
    setMaking(true);
    setBusy(true);
    try {
      await momentsApi.voiceover(project.projectId, { ...body, voiceId });
      setScript('');
      refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setMaking(false);
      setBusy(false);
    }
  };

  const maxStart = win ? Math.max(0, Math.floor(win.durationSec - project.lengthSec)) : 0;
  const commitStart = async () => {
    if (!song || !win || nudging || start === (song.windowStartSec ?? win.autoStartSec)) return;
    setNudging(true);
    try {
      await save({ sound: { song: { ref: song.ref, windowStartSec: start } } });
    } finally {
      setNudging(false);
    }
  };
  const scriptTooShort = script.trim().length < MIN_SCRIPT_CHARS;

  return (
    <div className="space-y-4">
      <div className={panelCls}>
        <div className="field-label">Song</div>
        <MusicPicker
          value={{ path: song?.ref ?? null, volume: 1 }}
          onChange={(next) => {
            // The picker also reports Vol and Autoduck edits; only a different track changes the song.
            if ((next.path ?? null) === (song?.ref ?? null)) return;
            save({ sound: { song: next.path ? { ref: next.path, windowStartSec: null } : null } });
          }}
          busy={busy}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={secondaryBtnCls} disabled={busy || !song} onClick={() => save({ sound: { song: null } })}>No music</button>
          {win && (
            <label className={`${fieldLabelCls} flex-1`}>
              Start at {fmt(start)}{win.tempo ? ` · ${Math.round(win.tempo)} BPM` : ''}
              <input
                type="range"
                min={0}
                max={maxStart}
                step={1}
                value={Math.min(start, maxStart)}
                disabled={busy && !nudging}
                aria-busy={nudging}
                onChange={(e) => setStart(Number(e.target.value))}
                onMouseUp={commitStart}
                onTouchEnd={commitStart}
                onKeyUp={commitStart}
                className="w-full"
              />
            </label>
          )}
          {win && song && song.windowStartSec !== null && (
            <button
              type="button"
              disabled={busy}
              className="text-xs text-content-tertiary hover:text-bf-cream disabled:opacity-50"
              onClick={() => save({ sound: { song: { ref: song.ref, windowStartSec: null } } })}
            >
              Auto ({fmt(win.autoStartSec)})
            </button>
          )}
        </div>
        {song && winError ? (
          <p role="alert" className="text-help mt-2">{winError instanceof Error ? winError.message : 'Could not read the song.'}</p>
        ) : (
          <p className="text-help mt-2">We pick the liveliest {project.lengthSec} seconds of the song for you.</p>
        )}
      </div>

      <div className={panelCls}>
        <div className="field-label">Voiceover (optional)</div>
        {vo && (
          <div className="mb-3 space-y-2">
            <audio controls src={api.mediaUrl(vo.file)} className="w-full" />
            <p className="text-help">“{vo.script}”</p>
            <button type="button" className={secondaryBtnCls} disabled={busy} onClick={() => save({ sound: { voiceover: null } })}>Remove voiceover</button>
          </div>
        )}
        <label className={fieldLabelCls}>
          Voiceover script
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={3}
            maxLength={meta.limits.scriptMax}
            placeholder="Type what to say, or describe it and let the AI write it."
            className={inputCls}
          />
        </label>
        <label className={fieldLabelCls}>
          Voice
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={inputCls}>
            {STORY_VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <div className="mt-3 flex gap-2">
          <button type="button" className={primaryBtnCls} disabled={busy || making || scriptTooShort} onClick={() => makeVoice({ script: script.trim() })}>
            {making ? <Loader2 size={16} className="animate-spin" /> : null} Make voiceover
          </button>
          <button type="button" className={secondaryBtnCls} disabled={busy || making || scriptTooShort} onClick={() => makeVoice({ idea: script.trim() })}>
            Write it for me
          </button>
        </div>
        <p className="text-help mt-2">With a song, the music dips under your voice.</p>
      </div>
    </div>
  );
}
