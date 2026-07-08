import { Link } from 'react-router-dom';
import { Wand2, FileText, Clapperboard, BookOpen, ChevronRight, type LucideIcon } from 'lucide-react';
import { ScreenHeader } from '../components/ui/ScreenHeader';

interface Tool {
    to: string;
    icon: LucideIcon;
    title: string;
    desc: string;
}

const tools: Tool[] = [
    { to: '/app/wizard', icon: Wand2, title: 'Wizard', desc: 'Guided end-to-end: script, voice, timeline, render.' },
    { to: '/app/scripts', icon: FileText, title: 'Scripts', desc: 'Write or generate a hook, verse, reflection, and CTA.' },
    { to: '/app/story', icon: Clapperboard, title: 'Story Video', desc: 'Turn a passage into cinematic, captioned scenes.' },
    { to: '/app/series', icon: BookOpen, title: 'Series', desc: 'Build multi-part collections from a book or theme.' },
];

export function CreateHubPage() {
    return (
        <div className="space-y-6">
            <ScreenHeader
                eyebrow="Create"
                title={<>Begin something<br />worth <em>sharing</em>.</>}
                subtitle="Start from a verse, a script, or your own voice."
            />
            <div className="flex flex-col gap-3">
                {tools.map(({ to, icon: Icon, title, desc }) => (
                    <Link
                        key={to}
                        to={to}
                        className="group flex items-center gap-4 rounded-bf border border-[rgba(216,184,120,0.12)] bg-bf-card p-4 transition-colors hover:border-[rgba(216,184,120,0.28)]"
                    >
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] border border-[rgba(216,184,120,0.22)] bg-[rgba(216,184,120,0.08)]">
                            <Icon size={22} className="text-bf-gold" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="font-semibold text-[15px] text-bf-cream">{title}</div>
                            <div className="text-help mt-0.5">{desc}</div>
                        </div>
                        <ChevronRight size={20} className="shrink-0 text-bf-faint transition-transform group-hover:translate-x-0.5 group-hover:text-bf-goldDeep" />
                    </Link>
                ))}
            </div>
        </div>
    );
}
