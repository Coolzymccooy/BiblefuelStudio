import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PanelSection } from '../PanelSection';

describe('PanelSection', () => {
  it('starts collapsed by default', () => {
    // An expanded stack recreates the scrolling wall this layout replaces.
    render(<PanelSection title="Music"><div>bed picker</div></PanelSection>);
    expect(screen.queryByText('bed picker')).not.toBeInTheDocument();
  });

  it('starts open when asked, for the section the tool is named after', () => {
    render(<PanelSection title="Music" defaultOpen><div>bed picker</div></PanelSection>);
    expect(screen.getByText('bed picker')).toBeInTheDocument();
  });

  it('toggles on click', async () => {
    const user = userEvent.setup();
    render(<PanelSection title="Music"><div>bed picker</div></PanelSection>);
    await user.click(screen.getByRole('button', { name: /music/i }));
    expect(screen.getByText('bed picker')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /music/i }));
    expect(screen.queryByText('bed picker')).not.toBeInTheDocument();
  });

  it('reports its state to assistive tech', async () => {
    const user = userEvent.setup();
    render(<PanelSection title="Music"><div>x</div></PanelSection>);
    const btn = screen.getByRole('button', { name: /music/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await user.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows the summary while collapsed, so the value is readable closed', () => {
    render(
      <PanelSection title="Music" summary="worship-bed.mp3">
        <div>bed picker</div>
      </PanelSection>,
    );
    expect(screen.getByText('worship-bed.mp3')).toBeInTheDocument();
  });

  it('hides the summary once open — the content says it better', async () => {
    const user = userEvent.setup();
    render(
      <PanelSection title="Music" summary="worship-bed.mp3">
        <div>bed picker</div>
      </PanelSection>,
    );
    await user.click(screen.getByRole('button', { name: /music/i }));
    expect(screen.queryByText('worship-bed.mp3')).not.toBeInTheDocument();
  });

  it('shows a count only when there is something to count', () => {
    const { rerender } = render(<PanelSection title="Clips" count={3}><div>x</div></PanelSection>);
    expect(screen.getByRole('button', { name: /clips/i })).toHaveTextContent('3');
    rerender(<PanelSection title="Clips" count={0}><div>x</div></PanelSection>);
    expect(screen.getByRole('button', { name: /clips/i })).not.toHaveTextContent('0');
  });
});
