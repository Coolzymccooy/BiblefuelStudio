import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api } from '../../../lib/api';
import { OutlineEditor } from '../OutlineEditor';

beforeEach(() => vi.restoreAllMocks());

const project: any = {
  projectId: 'p1', title: 'Psalms for Rest', status: 'draft_script',
  longform: { templateId: 'sleep-30', sections: [
    { heading: 'Welcome', reference: null, verseText: '', text: 'rest now', targetSec: 60 },
    { heading: 'Psalm 23', reference: 'Psalm 23:1', verseText: 'The LORD is my shepherd.', text: 'Psalm 23:1. The LORD is my shepherd. rest.', targetSec: 300 },
  ] },
};

// A section that HAS verseText but whose stored `text` was never built from
// that verse prefix (e.g. hand-edited, or produced by an older planner). The
// editor must not assume the prefix is there — matching it naively and
// stripping/re-adding it would duplicate the scripture on the next save.
const projectMismatchedPrefix: any = {
  projectId: 'p2', title: 'Psalms for Rest', status: 'draft_script',
  longform: { templateId: 'sleep-30', sections: [
    { heading: 'Psalm 23', reference: 'Psalm 23:1', verseText: 'The LORD is my shepherd.', text: 'just a reflection', targetSec: 300 },
  ] },
};

describe('OutlineEditor', () => {
  it('shows every section, saves edits and starts narration with the chosen voice', async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ok: true, data: { project } } as any);
    const onSaved = vi.fn(); const onNarrate = vi.fn();
    render(<OutlineEditor project={project} onSaved={onSaved} onNarrate={onNarrate} busy={false} />);
    expect(screen.getByText('Psalm 23')).toBeInTheDocument();
    expect(screen.getByText(/The LORD is my shepherd/)).toBeInTheDocument();
    const welcome = screen.getAllByRole('textbox')[0];
    await user.clear(welcome);
    await user.type(welcome, 'edited welcome');
    await user.click(screen.getByRole('button', { name: /save outline/i }));
    expect(patch).toHaveBeenCalledWith('/api/longform/p1/sections', expect.objectContaining({ sections: expect.arrayContaining([expect.objectContaining({ text: 'edited welcome' })]) }));
    expect(onSaved).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /generate narration/i }));
    expect(onNarrate).toHaveBeenCalledWith(expect.any(String));
  });

  it('shows text verbatim (no blockquote, no prefix stripped) when it does not start with the verse prefix, and saves the edit with no prefix prepended', async () => {
    const user = userEvent.setup();
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ok: true, data: { project: projectMismatchedPrefix } } as any);
    const onSaved = vi.fn(); const onNarrate = vi.fn();
    render(<OutlineEditor project={projectMismatchedPrefix} onSaved={onSaved} onNarrate={onNarrate} busy={false} />);
    // No scripture prefix in `text`, so the blockquote (which would otherwise
    // repeat the verse) is suppressed and the textarea shows the raw text.
    expect(screen.queryByText(/The LORD is my shepherd/)).not.toBeInTheDocument();
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('just a reflection');
    await user.clear(textarea);
    await user.type(textarea, 'edited reflection');
    await user.click(screen.getByRole('button', { name: /save outline/i }));
    expect(patch).toHaveBeenCalledWith('/api/longform/p2/sections', expect.objectContaining({ sections: expect.arrayContaining([expect.objectContaining({ text: 'edited reflection' })]) }));
  });
});
