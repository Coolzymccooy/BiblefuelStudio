import { useState, type ReactNode } from 'react';
import { CheckCircle2, Circle, X, ListChecks, HelpCircle } from 'lucide-react';
import { loadJson, saveJson } from '../../lib/storage';

export interface GuideStep {
    /** Short imperative label, e.g. "Generate a voice track". */
    label: ReactNode;
    /** Optional muted sub-line explaining the step. */
    detail?: ReactNode;
    /**
     * Drives the leading marker:
     *  - undefined → numbered badge (static onboarding guide)
     *  - 'done'     → green check (requirement met)
     *  - 'todo'     → hollow circle (still required)
     *  - 'optional' → dashed circle, muted (nice-to-have)
     */
    status?: 'done' | 'todo' | 'optional';
}

interface GuideStepsProps {
    /**
     * Stable localStorage key for the dismissed flag. When the user dismisses
     * the banner it collapses to a small "Show steps" pill and stays that way
     * across visits — first-timers get the guidance, veterans aren't nagged.
     */
    storageKey: string;
    title: string;
    steps: GuideStep[];
    /** Optional footer tip rendered below the steps. */
    tip?: ReactNode;
    className?: string;
}

/**
 * Lightweight onboarding / readiness banner used at the top of multi-step
 * pages (Voice & Audio, Render). Two modes in one component:
 *  - Static guide: steps with no `status` render as a numbered "how this
 *    works" list.
 *  - Live checklist: steps with a `status` render check / circle markers so
 *    the user can see at a glance what's still needed to proceed.
 */
export function GuideSteps({ storageKey, title, steps, tip, className = '' }: GuideStepsProps) {
    const flag = `bf_guide_dismissed_${storageKey}`;
    const [dismissed, setDismissed] = useState<boolean>(() => loadJson<boolean>(flag, false));

    const dismiss = () => {
        setDismissed(true);
        saveJson(flag, true);
    };
    const reopen = () => {
        setDismissed(false);
        saveJson(flag, false);
    };

    if (dismissed) {
        return (
            <button
                type="button"
                onClick={reopen}
                className="inline-flex items-center gap-1.5 text-[0.75rem] text-primary-300/90 hover:text-primary-200 transition-colors"
            >
                <HelpCircle size={13} />
                Show steps
            </button>
        );
    }

    return (
        <div
            className={`rounded-2xl border border-primary-500/20 bg-primary-500/[0.05] p-4 ${className}`}
        >
            <div className="flex items-start gap-2">
                <ListChecks size={16} className="text-primary-300 shrink-0 mt-0.5" />
                <h3 className="text-[0.875rem] font-semibold text-primary-100 flex-1">{title}</h3>
                <button
                    type="button"
                    onClick={dismiss}
                    className="p-1 -m-1 text-gray-400 hover:text-white transition-colors"
                    aria-label="Dismiss steps"
                >
                    <X size={15} />
                </button>
            </div>
            <ol className="mt-3 space-y-2">
                {steps.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                        <StepMarker status={step.status} index={idx} />
                        <div className="min-w-0 flex-1">
                            <span
                                className={`text-[0.8125rem] leading-snug ${
                                    step.status === 'done'
                                        ? 'text-gray-300'
                                        : step.status === 'optional'
                                            ? 'text-gray-400'
                                            : 'text-gray-100'
                                }`}
                            >
                                {step.label}
                                {step.status === 'optional' && (
                                    <span className="ml-1.5 text-[0.6875rem] uppercase tracking-wide text-gray-500">
                                        optional
                                    </span>
                                )}
                            </span>
                            {step.detail && (
                                <p className="text-[0.75rem] text-content-tertiary leading-snug mt-0.5">
                                    {step.detail}
                                </p>
                            )}
                        </div>
                    </li>
                ))}
            </ol>
            {tip && (
                <p className="mt-3 pt-3 border-t border-white/[0.06] text-[0.75rem] text-content-tertiary leading-relaxed">
                    {tip}
                </p>
            )}
        </div>
    );
}

function StepMarker({ status, index }: { status?: GuideStep['status']; index: number }) {
    if (status === 'done') {
        return <CheckCircle2 size={16} className="text-[#7fb5aa] shrink-0 mt-0.5" />;
    }
    if (status === 'todo') {
        return <Circle size={16} className="text-amber-300/80 shrink-0 mt-0.5" />;
    }
    if (status === 'optional') {
        return <Circle size={16} className="text-gray-500/60 shrink-0 mt-0.5" />;
    }
    // Static numbered guide.
    return (
        <span className="shrink-0 mt-0.5 w-[18px] h-[18px] rounded-full bg-primary-500/20 text-primary-200 text-[0.6875rem] font-bold flex items-center justify-center">
            {index + 1}
        </span>
    );
}
