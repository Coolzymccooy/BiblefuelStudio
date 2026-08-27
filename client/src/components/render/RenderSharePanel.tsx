import toast from 'react-hot-toast';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

/**
 * The Share Kit: pick a rendered video, copy the caption, and auto-post via
 * webhook / Buffer / YouTube / Instagram / TikTok.
 *
 * Extracted from RenderPage so the editor shell and the classic layout render
 * the SAME controls from one definition. Props-driven: the page keeps the
 * state and the posting logic.
 */

export type PostDestination = 'webhook' | 'buffer' | 'youtube' | 'instagram' | 'tiktok';
export type YoutubePrivacy = 'private' | 'unlisted' | 'public';

export interface RenderSharePanelProps {
  /** Caption source — the overlay lines, one caption per line. */
  lines: string;
  latestRenderFile?: string;
  jobVideoOptions: { id: string; label: string; path: string }[];
  shareVideoPath: string;
  onShareVideoPathChange: (next: string) => void;
  onRefreshVideos: () => void;
  postDestination: PostDestination;
  onPostDestinationChange: (next: PostDestination) => void;
  selectedWebhook: string;
  onSelectedWebhookChange: (next: string) => void;
  webhookOptions: { id: string; name: string }[];
  selectedProfile: string;
  onSelectedProfileChange: (next: string) => void;
  bufferProfiles: string[];
  youtubePrivacy: YoutubePrivacy;
  onYoutubePrivacyChange: (next: YoutubePrivacy) => void;
  onShare: () => void;
  isSharing: boolean;
}

export function RenderSharePanel({
  lines,
  latestRenderFile,
  jobVideoOptions,
  shareVideoPath,
  onShareVideoPathChange,
  onRefreshVideos,
  postDestination,
  onPostDestinationChange,
  selectedWebhook,
  onSelectedWebhookChange,
  webhookOptions,
  selectedProfile,
  onSelectedProfileChange,
  bufferProfiles,
  youtubePrivacy,
  onYoutubePrivacyChange,
  onShare,
  isSharing,
}: RenderSharePanelProps) {
  const caption = lines.split('\n').filter(Boolean).join(' ');
  return (
    <div className="space-y-3">
      <p className="text-help">
        Copy your caption and upload the rendered file to TikTok/IG/YouTube Shorts.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <label className="field-label">Video to share</label>
          <Select value={shareVideoPath} onChange={(e) => onShareVideoPathChange(e.target.value)}>
            {latestRenderFile && <option value={latestRenderFile}>Latest Instant Render</option>}
            {jobVideoOptions.length > 0 && (
              <optgroup label="Completed Jobs">
                {jobVideoOptions.map((item) => (
                  <option key={item.id} value={item.path}>{item.label}</option>
                ))}
              </optgroup>
            )}
            {!latestRenderFile && jobVideoOptions.length === 0 && (
              <option value="">No rendered videos found</option>
            )}
          </Select>
        </div>
        <div>
          <label className="field-label">Or paste a path</label>
          <Input
            value={shareVideoPath}
            onChange={(e) => onShareVideoPathChange(e.target.value)}
            placeholder="outputs/video-xyz.mp4"
            className="bg-black/20"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          className="text-xs h-8"
          onClick={onRefreshVideos}
        >
          Refresh Rendered Videos
        </Button>
      </div>
      <div className="bg-black/30 border border-white/10 rounded-lg p-3 text-xs text-gray-200 whitespace-pre-wrap">
        {caption}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          className="text-xs h-8 w-full sm:w-auto"
          onClick={() => {
            navigator.clipboard.writeText(caption);
            toast.success('Caption copied');
          }}
        >
          Copy Caption
        </Button>
      </div>

      <div className="pt-2 border-t border-white/10 space-y-2">
        <div className="text-[0.8125rem] font-medium text-gray-300">Auto-post</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Select value={postDestination} onChange={(e) => onPostDestinationChange(e.target.value as PostDestination)}>
            <option value="webhook">Webhook (Zapier/Make)</option>
            <option value="buffer">Buffer (Legacy)</option>
            <option value="youtube">YouTube (Direct)</option>
            <option value="instagram">Instagram (Direct)</option>
            <option value="tiktok">TikTok (Direct)</option>
          </Select>
          {postDestination === 'webhook' ? (
            <Select value={selectedWebhook} onChange={(e) => onSelectedWebhookChange(e.target.value)}>
              <option value="">Select webhook...</option>
              {webhookOptions.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          ) : postDestination === 'buffer' ? (
            <Select value={selectedProfile} onChange={(e) => onSelectedProfileChange(e.target.value)}>
              <option value="">Select profile...</option>
              {bufferProfiles.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </Select>
          ) : postDestination === 'youtube' ? (
            <Select value={youtubePrivacy} onChange={(e) => onYoutubePrivacyChange(e.target.value as YoutubePrivacy)}>
              <option value="private">YouTube Private</option>
              <option value="unlisted">YouTube Unlisted</option>
              <option value="public">YouTube Public</option>
            </Select>
          ) : (
            <div className="text-[10px] text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded-md px-2 py-1">
              Direct API requires OAuth setup
            </div>
          )}
          <Button onClick={onShare} isLoading={isSharing} disabled={isSharing} className="text-xs h-8">
            {isSharing ? 'Sharing…' : 'Share Now'}
          </Button>
        </div>
      </div>
    </div>
  );
}
