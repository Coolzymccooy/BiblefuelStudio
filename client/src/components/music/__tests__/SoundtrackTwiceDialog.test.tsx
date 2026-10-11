import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SoundtrackTwiceDialog } from '../SoundtrackTwiceDialog';

describe('SoundtrackTwiceDialog keyboard', () => {
  it('Escape keeps it out while focus is on a button', async () => {
    const user = userEvent.setup();
    const onKeepOut = vi.fn();
    render(<SoundtrackTwiceDialog onKeepOut={onKeepOut} onAddAnyway={vi.fn()} />);
    await user.keyboard('{Escape}');
    expect(onKeepOut).toHaveBeenCalledTimes(1);
  });

  it('Escape still keeps it out after clicking the message text (focus on the page, not a button)', async () => {
    const user = userEvent.setup();
    const onKeepOut = vi.fn();
    const onAddAnyway = vi.fn();
    render(<SoundtrackTwiceDialog onKeepOut={onKeepOut} onAddAnyway={onAddAnyway} />);
    await user.click(screen.getByText(/this looks like your soundtrack/i));
    expect(screen.getByRole('button', { name: 'Keep it out' })).not.toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onKeepOut).toHaveBeenCalledTimes(1);
    expect(onAddAnyway).not.toHaveBeenCalled();
  });

  it('Tab with focus outside the dialog brings it back inside', async () => {
    const user = userEvent.setup();
    render(<SoundtrackTwiceDialog onKeepOut={vi.fn()} onAddAnyway={vi.fn()} />);
    await user.click(screen.getByText(/this looks like your soundtrack/i));
    await user.tab();
    expect(screen.getByRole('alertdialog')).toContainElement(document.activeElement as HTMLElement);
  });

  it('Tab cycles between the two buttons', async () => {
    const user = userEvent.setup();
    render(<SoundtrackTwiceDialog onKeepOut={vi.fn()} onAddAnyway={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Keep it out' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add anyway' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Keep it out' })).toHaveFocus();
  });

  it('stops listening for Escape once unmounted', async () => {
    const user = userEvent.setup();
    const onKeepOut = vi.fn();
    const { unmount } = render(<SoundtrackTwiceDialog onKeepOut={onKeepOut} onAddAnyway={vi.fn()} />);
    unmount();
    await user.keyboard('{Escape}');
    expect(onKeepOut).not.toHaveBeenCalled();
  });
});
