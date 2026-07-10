import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { RevealSection } from './RevealSection';

describe('RevealSection', () => {
    beforeEach(() => localStorage.clear());

    it('is collapsed by default and hides its content', () => {
        render(<RevealSection title="Audio treatment" storageKey="treatment"><p>BODY</p></RevealSection>);
        expect(screen.getByRole('button', { name: /audio treatment/i })).toBeInTheDocument();
        expect(screen.queryByText('BODY')).not.toBeInTheDocument();
    });

    it('toggles open on click and persists the open state', async () => {
        const user = userEvent.setup();
        const { unmount } = render(
            <RevealSection title="Audio treatment" storageKey="treatment"><p>BODY</p></RevealSection>,
        );
        await user.click(screen.getByRole('button', { name: /audio treatment/i }));
        expect(screen.getByText('BODY')).toBeInTheDocument();
        expect(localStorage.getItem('bf.reveal.treatment')).toBe('1');

        unmount();
        render(<RevealSection title="Audio treatment" storageKey="treatment"><p>BODY2</p></RevealSection>);
        expect(screen.getByText('BODY2')).toBeInTheDocument(); // remembered open
    });

    it('honours defaultOpen only when no stored value exists', () => {
        render(<RevealSection title="X" storageKey="x" defaultOpen><p>SHOWN</p></RevealSection>);
        expect(screen.getByText('SHOWN')).toBeInTheDocument();
    });
});
