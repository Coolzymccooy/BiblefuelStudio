import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { describeCron } from '../../lib/cronDescribe';
import { SCHEDULE_PRESETS, SCHEDULE_TIMEZONE, type SocialSchedule } from '../../lib/socialSchedules';

interface ScheduleCardProps {
    schedule: SocialSchedule;
    webhooks: Array<{ id?: string; name: string }>;
    profileIds: string[];
    /** The card differs from what the server has. */
    unsaved: boolean;
    saving: boolean;
    onChange: (patch: Partial<SocialSchedule>) => void;
    onSave: () => void;
    onRemove: () => void;
}

/**
 * One auto-post schedule, with its own Save. The only Save used to sit at the
 * top of the list, a long scroll away on a phone, so a schedule switched to
 * Disabled looked paused but came back Enabled on refresh.
 */
export function ScheduleCard({ schedule: s, webhooks, profileIds, unsaved, saving, onChange, onSave, onRemove }: ScheduleCardProps) {
    const name = s.name.trim() || 'schedule';
    return (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                <Input
                    value={s.name}
                    onChange={(e) => onChange({ name: e.target.value })}
                    placeholder="Schedule name"
                    aria-label={`Name of ${name}`}
                />
                <Select
                    value={s.type}
                    onChange={(e) => onChange({ type: e.target.value as SocialSchedule['type'] })}
                    title="Replay reposts a fixed URL. Auto-Generate creates a brand new video every tick."
                    aria-label={`Type of ${name}`}
                >
                    <option value="replay">Replay URL</option>
                    <option value="auto_generate">Auto-Generate</option>
                </Select>
                <Input
                    value={s.cron}
                    onChange={(e) => onChange({ cron: e.target.value })}
                    placeholder="0 6 * * *"
                    title="Cron expression. Use the preset buttons below for common times."
                    aria-label={`Cron time for ${name}`}
                />
                <Input
                    value={s.timezone}
                    onChange={(e) => onChange({ timezone: e.target.value })}
                    placeholder="UTC"
                    aria-label={`Time zone for ${name}`}
                />
                <Select
                    value={s.enabled ? 'true' : 'false'}
                    onChange={(e) => onChange({ enabled: e.target.value === 'true' })}
                    aria-label={`Status of ${name}`}
                >
                    <option value="true">Enabled</option>
                    <option value="false">Disabled (paused)</option>
                </Select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-help">Presets:</span>
                {SCHEDULE_PRESETS.map((p) => (
                    <Button
                        key={p.key}
                        variant={s.cron === p.cron ? 'primary' : 'secondary'}
                        className="text-xs h-7 px-2"
                        title={p.hint}
                        onClick={() => onChange({ cron: p.cron, timezone: SCHEDULE_TIMEZONE })}
                    >
                        {p.label}
                    </Button>
                ))}
                <span className="text-help ml-auto">{describeCron(s.cron, s.timezone)}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Select
                    value={s.destination}
                    onChange={(e) => onChange({ destination: e.target.value as SocialSchedule['destination'] })}
                    aria-label={`Destination for ${name}`}
                >
                    <option value="webhook">Webhook</option>
                    <option value="buffer">Buffer</option>
                    <option value="youtube">YouTube</option>
                </Select>
                {s.destination === 'webhook' && (
                    <Select value={s.webhookId || ''} onChange={(e) => onChange({ webhookId: e.target.value })} aria-label={`Webhook for ${name}`}>
                        <option value="">Select webhook...</option>
                        {webhooks.map((w, idx) => (
                            <option key={w.id || idx} value={w.id || ''}>{w.name || `Webhook ${idx + 1}`}</option>
                        ))}
                    </Select>
                )}
                {s.destination === 'buffer' && (
                    <Select value={s.profileId || ''} onChange={(e) => onChange({ profileId: e.target.value })} aria-label={`Buffer profile for ${name}`}>
                        <option value="">Select profile...</option>
                        {profileIds.map((pid) => (
                            <option key={pid} value={pid}>{pid}</option>
                        ))}
                    </Select>
                )}
                {s.destination === 'youtube' && (
                    <Select
                        value={s.privacyStatus || 'private'}
                        onChange={(e) => onChange({ privacyStatus: e.target.value as SocialSchedule['privacyStatus'] })}
                        aria-label={`YouTube privacy for ${name}`}
                    >
                        <option value="private">YouTube Private</option>
                        <option value="unlisted">YouTube Unlisted</option>
                        <option value="public">YouTube Public</option>
                    </Select>
                )}
            </div>
            {s.type === 'replay' ? (
                <>
                    <Input value={s.videoUrl} onChange={(e) => onChange({ videoUrl: e.target.value })} placeholder="Video URL or /outputs/video-xxx.mp4" aria-label={`Video URL for ${name}`} />
                    <Input value={s.caption} onChange={(e) => onChange({ caption: e.target.value })} placeholder="Caption for scheduled post" aria-label={`Caption for ${name}`} />
                </>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <Input
                        value={s.backgroundQuery || ''}
                        onChange={(e) => onChange({ backgroundQuery: e.target.value })}
                        placeholder="Background filter (optional, e.g. 'sunset')"
                        aria-label={`Background filter for ${name}`}
                    />
                    <Select value={s.aspect || 'portrait'} onChange={(e) => onChange({ aspect: e.target.value })} aria-label={`Shape for ${name}`}>
                        <option value="portrait">Portrait (9:16)</option>
                        <option value="landscape">Landscape (16:9)</option>
                        <option value="square">Square (1:1)</option>
                    </Select>
                    <Input
                        type="number"
                        value={s.durationSec ?? 20}
                        onChange={(e) => onChange({ durationSec: Number(e.target.value) || 20 })}
                        placeholder="Duration (s)"
                        aria-label={`Length in seconds for ${name}`}
                    />
                    <Select value={s.ctaStyle || 'save'} onChange={(e) => onChange({ ctaStyle: e.target.value })} aria-label={`Call to action for ${name}`}>
                        <option value="save">CTA: save</option>
                        <option value="follow">CTA: follow</option>
                        <option value="share">CTA: share</option>
                        <option value="comment">CTA: comment</option>
                    </Select>
                </div>
            )}
            {s.type === 'auto_generate' && (
                <p className="text-help">
                    On each cron tick this generates a new script, voice and video and posts it to the destination above. Requires at least one background in your Library.
                </p>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                {unsaved && <span className="text-help mr-auto" role="status">Unsaved changes</span>}
                <Button variant="secondary" className="text-xs h-9 px-3" onClick={onRemove} aria-label={`Remove ${name}`}>
                    Remove
                </Button>
                <Button
                    variant={unsaved ? 'primary' : 'secondary'}
                    className="text-xs h-9 px-4"
                    onClick={onSave}
                    disabled={!unsaved}
                    isLoading={saving}
                    aria-label={`Save ${name}`}
                >
                    Save
                </Button>
            </div>
        </div>
    );
}
