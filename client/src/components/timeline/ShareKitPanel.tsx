import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { toOutputUrl } from '../../lib/storage';
import { RenderSharePanel, type PostDestination, type YoutubePrivacy } from '../render/RenderSharePanel';

/**
 * Self-contained Share Kit: the Render page's share state and wiring
 * (social config, rendered-video list, post) around the extracted
 * RenderSharePanel, so the Timeline editor's Output tool carries the same
 * sharing without a page hop. Same API calls, same behaviour.
 */

export interface ShareKitPanelProps {
  /** Caption source - one line per caption. */
  lines: string;
  latestRenderFile?: string;
}

export function ShareKitPanel({ lines, latestRenderFile }: ShareKitPanelProps) {
  const [postDestination, setPostDestination] = useState<PostDestination>('webhook');
  const [youtubePrivacy, setYoutubePrivacy] = useState<YoutubePrivacy>('private');
  const [webhookOptions, setWebhookOptions] = useState<{ id: string; name: string }[]>([]);
  const [selectedWebhook, setSelectedWebhook] = useState('');
  const [bufferProfiles, setBufferProfiles] = useState<string[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [jobVideoOptions, setJobVideoOptions] = useState<{ id: string; label: string; path: string }[]>([]);
  const [shareVideoPath, setShareVideoPath] = useState(latestRenderFile || '');
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    if (latestRenderFile) setShareVideoPath(latestRenderFile);
  }, [latestRenderFile]);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/social/config').then((res) => {
      if (cancelled || !res.ok || !res.data) return;
      setWebhookOptions(res.data.webhooks || []);
      setSelectedWebhook(res.data.webhooks?.[0]?.id || '');
      setBufferProfiles(res.data.buffer?.profileIds || []);
      setSelectedProfile(res.data.buffer?.profileIds?.[0] || '');
    }).catch(() => { /* config is optional */ });
    return () => { cancelled = true; };
  }, []);

  const loadJobVideos = async () => {
    const items: { id: string; label: string; path: string }[] = [];
    const seen = new Set<string>();
    const res = await api.get('/api/jobs');
    if (res.ok && res.data?.jobs) {
      for (const j of res.data.jobs as any[]) {
        if (j.status !== 'done' || j.type !== 'render_video' || !j.result?.outFile) continue;
        const key = String(j.result.outFile);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({ id: j.id, label: `${String(j.id).slice(0, 8)} • ${new Date(j.createdAt).toLocaleString()}`, path: key });
      }
    }
    const media = await api.get('/api/media/video-list');
    if (media.ok && media.data?.items) {
      for (const entry of media.data.items as any[]) {
        const mediaPath = String(entry?.path || '').trim();
        if (!mediaPath || seen.has(mediaPath)) continue;
        seen.add(mediaPath);
        items.push({ id: `media_${entry?.name || mediaPath}`, label: `media • ${entry?.name || mediaPath.split(/[\\/]/).pop()}`, path: mediaPath });
      }
    }
    setJobVideoOptions(items);
    setShareVideoPath((prev) => prev || latestRenderFile || items[0]?.path || '');
  };

  useEffect(() => { loadJobVideos(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleShare = async () => {
    if (isSharing) return;
    const effectivePath = shareVideoPath || latestRenderFile;
    const fileUrl = effectivePath ? toOutputUrl(effectivePath, api.mediaBaseUrl) : '';
    if (!fileUrl) { toast.error('Render a video first'); return; }
    const caption = lines.split('\n').filter(Boolean).join(' ');
    if (!caption) { toast.error('Caption is empty'); return; }
    const payload: Record<string, unknown> = { destination: postDestination, caption, videoUrl: fileUrl };
    if (postDestination === 'webhook') payload.webhookId = selectedWebhook;
    if (postDestination === 'buffer') payload.profileIds = [selectedProfile];
    if (postDestination === 'youtube') payload.privacyStatus = youtubePrivacy;
    setIsSharing(true);
    try {
      const res = await api.post('/api/social/post', payload);
      if (res.ok) toast.success('Share triggered');
      else toast.error(res.error || 'Share failed');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <RenderSharePanel
      lines={lines}
      latestRenderFile={latestRenderFile}
      jobVideoOptions={jobVideoOptions}
      shareVideoPath={shareVideoPath}
      onShareVideoPathChange={setShareVideoPath}
      onRefreshVideos={loadJobVideos}
      postDestination={postDestination}
      onPostDestinationChange={setPostDestination}
      selectedWebhook={selectedWebhook}
      onSelectedWebhookChange={setSelectedWebhook}
      webhookOptions={webhookOptions}
      selectedProfile={selectedProfile}
      onSelectedProfileChange={setSelectedProfile}
      bufferProfiles={bufferProfiles}
      youtubePrivacy={youtubePrivacy}
      onYoutubePrivacyChange={setYoutubePrivacy}
      onShare={handleShare}
      isSharing={isSharing}
    />
  );
}
