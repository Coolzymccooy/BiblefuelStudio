import { Link } from 'react-router-dom';
import { Mic, Film, Image, Video, List, ChevronRight, type LucideIcon } from 'lucide-react';
import { ScreenHeader } from '../components/ui/ScreenHeader';

interface Tool {
    to: string;
    icon: LucideIcon;
    title: string;
    desc: string;
}

const tools: Tool[] = [
    { to: '/app/voice-audio', icon: Mic, title: 'Voice & Audio', desc: 'Generate, record, treat, and score.' },
    { to: '/app/timeline', icon: Film, title: 'Timeline', desc: 'Arrange clips and crossfades.' },
    { to: '/app/backgrounds', icon: Image, title: 'Backgrounds', desc: 'Find and save footage.' },
    { to: '/app/render', icon: Video, title: 'Render', desc: 'Export and share your MP4.' },
];

export function StudioHubPage() {
    return (
        <div className="space-y-6">
            <ScreenHeader
                eyebrow="Studio"
                title={<>Shape the <em>final</em><br />cut.</>}
                subtitle="Voice, arrange, dress, and render — all in one place."
            />
            <div className="grid grid-cols-2 gap-3">
                {tools.map(({ to, icon: Icon, title, desc }) => (
                    <Link
                        key={to}
                        to={to}
                        className="group flex flex-col rounded-bf border border-[rgba(216,184,120,0.12)] bg-bf-card p-4 transition-colors hover:border-[rgba(216,184,120,0.28)]"
                    >
                        <div className="flex h-11 w-11 items-center justify-center rounded-[13px] border border-[rgba(216,184,120,0.22)] bg-[rgba(216,184,120,0.08)]">
                            <Icon size={20} className="text-bf-gold" />
                        </div>
                        <div className="mt-3 font-semibold text-[14px] text-bf-cream">{title}</div>
                        <div className="text-[11px] leading-snug text-content-secondary mt-1">{desc}</div>
                    </Link>
                ))}
            </div>
            <Link
                to="/app/queue"
                className="group flex items-center gap-3 rounded-bf border border-[rgba(216,184,120,0.12)] bg-bf-card px-4 py-3.5 transition-colors hover:border-[rgba(216,184,120,0.28)]"
            >
                <List size={19} className="text-bf-goldDeep" />
                <span className="font-medium text-sm text-bf-cream">Publishing queue</span>
                <ChevronRight size={18} className="ml-auto text-bf-faint transition-transform group-hover:translate-x-0.5" />
            </Link>
        </div>
    );
}
