import { Video, AudioLines } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Field } from '../ui/Field';

/**
 * How the render runs and the buttons that start it: background vs instant,
 * kinetic captions (with the ElevenLabs voice ID it needs), and the two
 * render actions.
 *
 * Extracted from RenderPage so the editor shell and the classic layout render
 * the SAME controls from one definition. Props-driven: the page keeps the
 * state and the render logic.
 */

export interface RenderDeliveryPanelProps {
  renderInBackground: boolean;
  onRenderInBackgroundChange: (next: boolean) => void;
  /** 60s+ renders must run in the background; the checkbox locks on. */
  isLongRender: boolean;
  kineticCaptions: boolean;
  onKineticCaptionsChange: (next: boolean) => void;
  ttsVoiceId: string;
  onTtsVoiceIdChange: (next: string) => void;
  renderEnabled: boolean;
  isRendering: boolean;
  onRenderVideo: () => void;
  onRenderWaveform: () => void;
  /** First blocker message per mode, surfaced as the button tooltip. */
  videoBlockerMessage?: string;
  waveformBlockerMessage?: string;
}

export function RenderDeliveryPanel({
  renderInBackground,
  onRenderInBackgroundChange,
  isLongRender,
  kineticCaptions,
  onKineticCaptionsChange,
  ttsVoiceId,
  onTtsVoiceIdChange,
  renderEnabled,
  isRendering,
  onRenderVideo,
  onRenderWaveform,
  videoBlockerMessage,
  waveformBlockerMessage,
}: RenderDeliveryPanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="background"
          checked={renderInBackground}
          onChange={(e) => onRenderInBackgroundChange(e.target.checked)}
          className="rounded border-white/10 bg-black/50 checked:bg-primary-500"
          disabled={isLongRender || kineticCaptions}
        />
        <label htmlFor="background" className="text-[0.875rem] text-gray-300">
          Render in background
        </label>
        {isLongRender && (
          <span className="text-[0.6875rem] text-yellow-300/90">Required for 60s+</span>
        )}
        {kineticCaptions && (
          <span className="text-[0.6875rem] text-amber-300/90">Forced on by kinetic captions</span>
        )}
      </div>

      <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-4 space-y-3">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={kineticCaptions}
            onChange={(e) => onKineticCaptionsChange(e.target.checked)}
            className="mt-0.5 rounded border-white/10 bg-black/50 checked:bg-amber-500"
          />
          <div className="flex-1 min-w-0">
            <div className="text-[0.9375rem] font-semibold text-white">Kinetic captions</div>
            <p className="text-help mt-0.5 leading-relaxed">
              Word-by-word reveal synced to voice. Generates audio from your script
              via ElevenLabs and highlights each word as it's spoken. Overrides the
              voice track above.
            </p>
          </div>
        </label>
        {kineticCaptions && (
          <div className="pl-6">
            <Field label="ElevenLabs voice ID" badge="Optional">
              <Input
                value={ttsVoiceId}
                onChange={(e) => onTtsVoiceIdChange(e.target.value)}
                placeholder="Leave blank to use the server default (Sarah)"
                className="font-mono text-[0.8125rem]"
              />
            </Field>
            <p className="field-help">
              Auto-fills from the voice saved on the Voice & Audio page. If blank,
              falls back to <code className="text-gray-400 bg-white/[0.04] px-1 py-0.5 rounded">ELEVENLABS_VOICE_ID</code> in
              <code className="text-gray-400 bg-white/[0.04] px-1 py-0.5 rounded ml-1">.env</code>, then to ElevenLabs' default.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Button
          onClick={onRenderVideo}
          isLoading={isRendering}
          className="w-full h-12 text-md"
          disabled={!renderEnabled || (isLongRender && !renderInBackground)}
          title={videoBlockerMessage || 'Render the video'}
          aria-label="Render the video"
        >
          <Video size={18} className="mr-2" />
          {renderInBackground ? 'Queue Video Render' : 'Start Instant Render'}
        </Button>
        <Button
          onClick={onRenderWaveform}
          isLoading={isRendering}
          variant="secondary"
          className="w-full h-12 text-md"
          disabled={!renderEnabled || (isLongRender && !renderInBackground)}
          title={waveformBlockerMessage || 'Render a waveform video'}
          aria-label="Render a waveform video"
        >
          <AudioLines size={18} className="mr-2" />
          {renderInBackground ? 'Queue Waveform Render' : 'Render Waveform MP4'}
        </Button>
      </div>
    </div>
  );
}
