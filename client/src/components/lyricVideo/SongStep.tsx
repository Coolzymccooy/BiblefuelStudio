import { useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { AUDIO_ACCEPT, AUDIO_ACCEPT_LIST } from '../../lib/audioAccept';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { formatSongLength } from '../../lib/lyricTiming';
import type { LyricProject } from '../../lib/lyricVideoTypes';
import { DropZone } from '../ui/DropZone';
import { dropZoneCls, panelCls } from '../story/formStyles';
import { messageOf } from './messageOf';

interface Props { project: LyricProject; onChange: (p: LyricProject) => void; onNext?: () => void }

// The extensions matter: on iOS, audio/* alone cannot pick a song saved in Files (see lib/audioAccept.ts).
const ACCEPT = `${AUDIO_ACCEPT},video/*,.mp4,.mov`;
const ACCEPT_LIST = [...AUDIO_ACCEPT_LIST, 'video/*', '.mp4', '.mov'];

/** Step 1: put the song in. The title and artist were chosen on the start screen. */
export function SongStep({ project, onChange, onNext }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploading = progress !== null;
  const { song } = project;
  const hadTiming = project.timing.status === 'done' || project.lines.some((l) => l.words && l.words.length > 0);

  const upload = async (file: File) => {
    setError(null);
    setProgress(0);
    try {
      const next = await lyricVideoApi.uploadSong(project.projectId, file, setProgress);
      onChange(next);
      onNext?.();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setProgress(null);
    }
  };

  const cover = song?.coverStill ? api.mediaUrl(song.coverStill) : '';
  return (
    <div className="space-y-4">
      <div>
        <p className="font-displaySerif text-[19px] font-semibold text-bf-cream">{project.title}</p>
        {project.artist && <p className="text-sm text-content-secondary">by {project.artist}</p>}
      </div>

      {song && (
        <div className={`${panelCls} flex items-center gap-3`}>
          {cover && <img src={cover} alt="Song cover" className="h-16 w-16 rounded-lg object-cover" />}
          <div>
            <p className="font-medium text-bf-cream">Song: {formatSongLength(song.durationSec)}</p>
            {hadTiming && <p className="text-xs text-content-secondary">If you upload a different song, the timing will be cleared.</p>}
          </div>
        </div>
      )}

      <DropZone
        onFiles={(files) => { if (files[0]) void upload(files[0]); }}
        accept={ACCEPT_LIST}
        multiple={false}
        disabled={uploading}
        overlayLabel="Drop your song"
      >
        <button type="button" disabled={uploading} onClick={() => input.current?.click()} className={`${dropZoneCls} py-8 disabled:opacity-60`}>
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
          {uploading
            ? (progress === 100 ? 'Checking your song…' : `Uploading… ${progress}%`)
            : song ? 'Upload a different song' : 'Upload your song (MP3, M4A, WAV or a video)'}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </DropZone>

      {error && <p role="alert" className="text-sm text-bf-danger">{error}</p>}
    </div>
  );
}
