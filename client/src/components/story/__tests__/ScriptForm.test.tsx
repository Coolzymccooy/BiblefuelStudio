import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScriptForm } from '../ScriptForm';

describe('ScriptForm', () => {
  it('disables Generate until the idea has text', async () => {
    render(<ScriptForm onGenerate={vi.fn()} busy={false} />);
    const btn = screen.getByRole('button', { name: /generate voiceover/i });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/your idea/i), 'trust God in hard times');
    expect(btn).toBeEnabled();
  });

  it('calls onGenerate with idea, default template, and default voice', async () => {
    const onGenerate = vi.fn();
    render(<ScriptForm onGenerate={onGenerate} busy={false} />);
    await userEvent.type(screen.getByLabelText(/your idea/i), 'hope in the morning');
    await userEvent.click(screen.getByRole('button', { name: /generate voiceover/i }));
    expect(onGenerate).toHaveBeenCalledWith('hope in the morning', 'devotional-30', 'en-US-GuyNeural');
  });

  it('Generate is disabled while busy', () => {
    render(<ScriptForm onGenerate={vi.fn()} busy={true} />);
    expect(screen.getByRole('button', { name: /generating|generate voiceover/i })).toBeDisabled();
  });
});
