import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LaneActionsMenu } from '../LaneActionsMenu';
import { VisualTimelineCanvas } from '../VisualTimelineCanvas';
import { buildWorshipDocumentaryProject, insertAssetOnTrack } from '../../../lib/timelineProject';

function Harness({ action = vi.fn() }: { action?: () => void }) {
  const [id, setId] = useState<string | null>(null);
  return <>{['Captions', 'Music'].map(label => <LaneActionsMenu key={label} phone label={label} icon="icon" open={id === label} onOpenChange={open => setId(open ? label : null)}><button onClick={event => { event.stopPropagation(); action(); }}>Hide {label}</button></LaneActionsMenu>)}<button>Outside</button></>;
}
const tap = (name: string) => {
  const button = screen.getByRole('button', { name });
  fireEvent.pointerDown(button);
  fireEvent.click(button, { detail: 1 });
};
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('touch lane disclosure', () => {
  test('tap opens, fades at 3 seconds and unmounts after 200ms', () => {
    vi.useFakeTimers(); render(<Harness />); tap('Captions lane actions');
    expect(screen.getByRole('group')).toHaveStyle({ opacity: '1' });
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('group')).toHaveStyle({ opacity: '1' });
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('group')).toHaveStyle({ opacity: '0', transition: 'opacity 200ms ease' });
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
  test('outside, switching, and action selection close without swallowing callbacks', () => {
    const action = vi.fn(); render(<Harness action={action} />);
    tap('Captions lane actions'); tap('Music lane actions');
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Hide Captions' })).not.toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText('Outside'));
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    tap('Captions lane actions'); tap('Hide Captions');
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
  test('keyboard interaction suspends expiry, Tab can leave, Escape restores trigger focus', () => {
    vi.useFakeTimers(); render(<Harness />); tap('Captions lane actions');
    const trigger = screen.getByRole('button', { name: 'Captions lane actions' });
    fireEvent.keyDown(trigger, { key: 'Tab' });
    screen.getByText('Hide Captions').focus();
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('group')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger, { detail: 0 });
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('group')).toBeInTheDocument();
    act(() => screen.getByText('Outside').focus());
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
  test('pointer activity restarts expiry and unmount clears timers/listeners', () => {
    vi.useFakeTimers(); const view = render(<Harness />); tap('Captions lane actions');
    act(() => vi.advanceTimersByTime(2500));
    fireEvent.pointerDown(screen.getByRole('group'));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('group')).toHaveStyle({ opacity: '1' });
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
    fireEvent.keyDown(document, { key: 'Escape' });
  });
  test('desktop actions remain inline without timers/disclosure', () => {
    vi.useFakeTimers(); render(<LaneActionsMenu phone={false} label="Captions" icon="icon" open={false} onOpenChange={vi.fn()}><button>Hide Captions</button></LaneActionsMenu>);
    expect(screen.getByText('Hide Captions')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Captions lane actions' })).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('mobile progressive B-roll row', () => {
  function mobile() {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  }
  test('empty row starts absent, add/remove are cosmetic and do not generate', () => {
    mobile(); const change = vi.fn(), generate = vi.fn();
    const project = buildWorshipDocumentaryProject({ title: 'B-roll' });
    render(<VisualTimelineCanvas project={project} compact onProjectChange={change} onRequestVeoBroll={generate} />);
    expect(screen.queryByLabelText('Track lane: AI B-roll / GFX')).not.toBeInTheDocument();
    tap('Add B-roll layer');
    expect(screen.getByLabelText('Track lane: AI B-roll / GFX')).toBeInTheDocument();
    tap('AI B-roll / GFX lane actions'); tap('Remove empty B-roll row');
    expect(screen.queryByLabelText('Track lane: AI B-roll / GFX')).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  test('populated row is always visible on mount and cannot be cosmetically removed', () => {
    mobile(); const project = insertAssetOnTrack(buildWorshipDocumentaryProject({ title: 'B-roll' }), { trackKind: 'broll', asset: { id: 'b', kind: 'image', source: 'upload', label: 'Sky' }, startSec: 0, durationSec: 5 });
    render(<VisualTimelineCanvas project={project} compact />);
    expect(screen.getByLabelText('Track lane: AI B-roll / GFX')).toBeInTheDocument();
    tap('AI B-roll / GFX lane actions');
    expect(screen.queryByRole('button', { name: 'Remove empty B-roll row' })).not.toBeInTheDocument();
  });
});
