import { Card } from '../components/ui/Card';
import {
    HelpCircle,
    Zap,
    Repeat,
    Layers,
    Cpu,
    ShieldCheck,
    ExternalLink,
    MessageCircle,
    BookOpen,
    FileSpreadsheet,
    PlayCircle,
    Server,
    Archive
} from 'lucide-react';

export function HelpPage() {
    return (
        <div className="space-y-12 animate-fade-in max-w-5xl mx-auto pb-20">
            {/* Header */}
            <div className="relative">
                <div className="absolute -top-10 -left-10 w-48 h-48 bg-primary-500/10 rounded-full blur-3xl pointer-events-none"></div>
                <h2 className="text-5xl font-extrabold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white via-primary-100 to-primary-400">Mastering Biblefuel Studio</h2>
                <p className="text-gray-400 text-xl max-w-2xl leading-relaxed">
                    A comprehensive guide to automating your spiritual content creation, from initial seed ideas to final high-definition renders.
                </p>
            </div>

            {/* Step-by-Step Deep Dive */}
            <section className="space-y-6">
                <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                    <Layers className="text-primary-400" size={24} />
                    <h3 className="text-2xl font-bold text-white">The 6-Phase Automation Workflow</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[
                        {
                            phase: '01',
                            title: 'AI Scripting',
                            desc: 'Use the Scripts page to generate spiritual insights. You can choose different categories (Wisdom, Daily Devotional). If Gemini reaches its limit, the system gracefully uses sample high-quality scripts.',
                            icon: Zap
                        },
                        {
                            phase: '02',
                            title: 'Batch Queueing',
                            desc: 'The Queue is your central hub. Once a script is added here, it is auto-persisted to our database. You can export this as a CSV at any time for your records or team use.',
                            icon: Archive
                        },
                        {
                            phase: '03',
                            title: 'Visual Assets',
                            desc: 'In the Backgrounds page, search for keywords like "Nature", "Bible", or "Serene". Save your favorite videos. They become instantly available in the Timeline.',
                            icon: PlayCircle
                        },
                        {
                            phase: '04',
                            title: 'Voice Engineering',
                            desc: 'Generate professional narrations with ElevenLabs. Ensure you use the correct API key (XI-Key). You can listen and re-generate until the tone is exactly right.',
                            icon: Cpu
                        },
                        {
                            phase: '05',
                            title: 'The Timeline',
                            desc: 'This is where it all comes together. Pull in your queued scripts, saved backgrounds, and generated audio. Adjust the timing precisely using our drag-and-drop DAW interface.',
                            icon: Server
                        },
                        {
                            phase: '06',
                            title: 'Multi-Mode Render',
                            desc: 'Choose between standard Video rendering or animated Waveform backgrounds. Use "Render in Background" to send the job to our server-side queue.',
                            icon: Repeat
                        }
                    ].map((step) => (
                        <Card key={step.phase} className="h-full">
                            <div className="flex items-start gap-4">
                                <span className="text-4xl font-black text-white/5 select-none">{step.phase}</span>
                                <div>
                                    <h4 className="text-lg font-bold text-primary-300 flex items-center gap-2 mb-2">
                                        <step.icon size={18} /> {step.title}
                                    </h4>
                                    <p className="text-sm text-gray-400 leading-relaxed">{step.desc}</p>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            </section>

            {/* CSV Strategy Section */}
            <section className="bg-white/[0.02] border border-white/5 rounded-3xl p-8 space-y-8">
                <div className="flex flex-col md:flex-row gap-8 items-center">
                    <div className="flex-1 space-y-4">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-bold uppercase tracking-widest">
                            <FileSpreadsheet size={14} /> Data Strategy
                        </div>
                        <h3 className="text-3xl font-bold text-white">How to use your Exported CSV</h3>
                        <p className="text-gray-400 leading-relaxed">
                            The CSV isn't just a backup—it's a powerful tool for scaling your content. Here is how you should use it:
                        </p>
                        <ul className="space-y-4">
                            <li className="flex gap-4">
                                <div className="h-2 w-2 rounded-full bg-primary-500 mt-2 shrink-0" />
                                <p className="text-sm text-gray-300">
                                    <strong className="text-white block">Bulk Editing in Excel/Sheets</strong>
                                    Import the CSV into Google Sheets to perform spell-checks, translation, or to have a professional editor review your scripts before you render.
                                </p>
                            </li>
                            <li className="flex gap-4">
                                <div className="h-2 w-2 rounded-full bg-primary-500 mt-2 shrink-0" />
                                <p className="text-sm text-gray-300">
                                    <strong className="text-white block">Team Collaboration</strong>
                                    Share the CSV with your video editing team. They can use the Script ID column as a reference to match videos and audio files.
                                </p>
                            </li>
                            <li className="flex gap-4">
                                <div className="h-2 w-2 rounded-full bg-primary-500 mt-2 shrink-0" />
                                <p className="text-sm text-gray-300">
                                    <strong className="text-white block">Data Archiving</strong>
                                    Keep a permanent record of everything you've ever generated. Biblefuel persists your queue locally, but CSV is your external insurance.
                                </p>
                            </li>
                        </ul>
                    </div>
                    <div className="w-full md:w-80 bg-black/40 rounded-2xl border border-white/10 p-6 flex flex-col items-center justify-center text-center">
                        <FileSpreadsheet size={64} className="text-emerald-400/50 mb-4" />
                        <h4 className="text-white font-bold mb-2">Export Pro-Tip</h4>
                        <p className="text-xs text-gray-500 mb-6">Always export after a large generation session. Use the Script ID column as your master reference.</p>
                        <button className="w-full py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg text-sm font-bold">Download Sample CSV</button>
                    </div>
                </div>
            </section>

            {/* Pro Automation Tips */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-left">
                <Card title="Background Rendering" icon={Cpu}>
                    <p className="text-sm text-gray-400 mb-4">
                        Don't wait for renders to finish. By using background rendering, your browser remains free for other tasks.
                    </p>
                    <div className="p-4 bg-primary-500/5 rounded-xl border border-primary-500/10">
                        <h5 className="text-xs font-bold text-primary-400 uppercase tracking-widest mb-1">Status Tracking</h5>
                        <p className="text-[11px] text-gray-500 leading-normal">
                            Once a job is started, click the <strong>Jobs</strong> page. You'll see real-time progress bars and status updates (Pending, Processing, Completed).
                        </p>
                    </div>
                </Card>

                <Card title="Queue Management" icon={HelpCircle}>
                    <p className="text-sm text-gray-400 mb-4">
                        The Queue list can grow quickly during batch sessions. Keep it tidy to maintain focus on current projects.
                    </p>
                    <div className="p-4 bg-red-500/5 rounded-xl border border-red-500/10">
                        <h5 className="text-xs font-bold text-red-400 uppercase tracking-widest mb-1">Deleting Scripts</h5>
                        <p className="text-[11px] text-gray-500 leading-normal">
                            Use the trash icon in the Queue page to remove individual scripts after you've used them. Use <strong>Clear All</strong> to wipe the database for a new batch.
                        </p>
                    </div>
                </Card>
            </div>

            {/* API Troubleshooting */}
            <Card title="API Key Reliability" icon={ShieldCheck}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
                    <div className="space-y-2">
                        <h4 className="text-xs uppercase tracking-wider text-gray-500 font-bold border-b border-white/5 pb-2">Pexels Integration</h4>
                        <p className="text-xs text-gray-400 leading-relaxed">Ensure you use the <strong>API Key</strong> found in your Pexels Dashboard. Copy it exactly—avoid any leading or trailing spaces.</p>
                    </div>
                    <div className="space-y-2">
                        <h4 className="text-xs uppercase tracking-wider text-gray-500 font-bold border-b border-white/5 pb-2">ElevenLabs Voice</h4>
                        <p className="text-xs text-gray-400 leading-relaxed">Requires a valid XI-API-Key. Users often confuse this with OpenAI keys. XI keys usually start without 'sk_'.</p>
                    </div>
                    <div className="space-y-2">
                        <h4 className="text-xs uppercase tracking-wider text-gray-500 font-bold border-b border-white/5 pb-2">Server Resilience</h4>
                        <p className="text-xs text-gray-400 leading-relaxed">Our server features auto-reload. When you save your <code className="text-primary-400">.env</code> keys, the server restarts itself to apply the changes.</p>
                    </div>
                </div>
            </Card>

            {/* Footer Actions */}
            <div className="flex flex-col sm:flex-row gap-4">
                <a
                    href="https://github.com"
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 flex items-center justify-center gap-4 p-6 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 hover:border-white/20 transition-all group"
                >
                    <BookOpen className="text-primary-400 group-hover:scale-110 transition-transform" size={28} />
                    <div className="text-left">
                        <div className="text-lg font-bold text-white flex items-center gap-1">Online Documentation <ExternalLink size={14} className="text-gray-500" /></div>
                        <div className="text-sm text-gray-500">Access the full Biblefuel Wiki for power users.</div>
                    </div>
                </a>

                <button className="flex-1 flex items-center justify-center gap-4 p-6 bg-primary-500/10 border border-primary-500/20 rounded-2xl hover:bg-primary-500/20 transition-all group">
                    <MessageCircle className="text-primary-400 group-hover:scale-110 transition-transform" size={28} />
                    <div className="text-left">
                        <div className="text-lg font-bold text-white">Direct Support</div>
                        <div className="text-sm text-gray-500">Contact our team via Discord or Email.</div>
                    </div>
                </button>
            </div>
        </div>
    );
}
