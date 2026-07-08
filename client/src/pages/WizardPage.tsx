import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { FileText, Mic, Film, Video } from 'lucide-react';

const steps = [
    {
        id: 'scripts',
        title: 'Generate Scripts',
        description: 'Create hooks, verses, reflections, and CTA in one click.',
        action: '/app/scripts',
        icon: FileText,
    },
    {
        id: 'voice',
        title: 'Voice and Audio',
        description: 'Pick a voice, generate TTS, or record/upload your own.',
        action: '/app/voice-audio',
        icon: Mic,
    },
    {
        id: 'timeline',
        title: 'Timeline',
        description: 'Sequence clips, trim, and preview with background.',
        action: '/app/timeline',
        icon: Film,
    },
    {
        id: 'render',
        title: 'Render',
        description: 'Render MP4 or waveform video, or queue a job.',
        action: '/app/render',
        icon: Video,
    },
];

export function WizardPage() {
    const navigate = useNavigate();
    const [activeStep, setActiveStep] = useState(0);
    const current = useMemo(() => steps[activeStep], [activeStep]);

    return (
        <div className="space-y-6 animate-fade-in">
            <div>
                <div className="bf-eyebrow">Create</div>
                <h2 className="font-displaySerif text-[28px] leading-[1.08] font-semibold text-bf-cream mt-1.5">Start to <em className="italic font-medium text-bf-gold">finish</em>.</h2>
                <p className="text-help mt-2">A guided flow for fast creation. Jump to any step, any time.</p>
            </div>

            <Card>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-2">
                    {steps.map((step, index) => {
                        const Icon = step.icon;
                        const isActive = index === activeStep;
                        return (
                            <button
                                key={step.id}
                                onClick={() => setActiveStep(index)}
                                className={`text-left p-4 rounded-xl border transition-all ${isActive
                                    ? 'border-primary-500/40 bg-primary-500/10 text-white'
                                    : 'border-white/10 bg-black/20 text-content-secondary hover:border-primary-500/20'
                                    }`}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <Icon size={18} className={isActive ? 'text-primary-300' : 'text-content-tertiary'} />
                                    <span className="text-sm font-semibold">{index + 1}. {step.title}</span>
                                </div>
                                <p className="text-xs">{step.description}</p>
                            </button>
                        );
                    })}
                </div>
            </Card>

            <Card title="Current Step">
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{current.title}</h3>
                    <p className="text-help">{current.description}</p>
                    <div className="flex gap-2">
                        <Button onClick={() => navigate(current.action)}>
                            Go to {current.title}
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
                            disabled={activeStep === 0}
                        >
                            Back
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => setActiveStep(Math.min(steps.length - 1, activeStep + 1))}
                            disabled={activeStep === steps.length - 1}
                        >
                            Next
                        </Button>
                    </div>
                </div>
            </Card>
        </div>
    );
}
