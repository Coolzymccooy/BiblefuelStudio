import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

test('phone uses one contextual icon row and timing is an explicitly opened dismissible sheet',()=>{
 const previous=window.matchMedia;
 window.matchMedia=vi.fn().mockImplementation(query=>({matches:query.includes('max-width'),media:query,addEventListener:vi.fn(),removeEventListener:vi.fn()}));
 try {
  const {container,unmount}=render(<VisualTimelineCanvas compact project={fixture()} onProjectChange={vi.fn()}/>);
  expect(container.querySelector('.timeline-toolbar')).not.toBeInTheDocument();
  expect(container.querySelectorAll('.timeline-mobile-tools')).toHaveLength(1);
  expect(screen.queryByLabelText('Start (s)')).not.toBeInTheDocument();
  const picker=screen.getByLabelText('Select timeline clip') as HTMLSelectElement;
  fireEvent.change(picker,{target:{value:picker.options[1].value}});
  fireEvent.click(screen.getByRole('button',{name:'Timing'}));
  expect(screen.getByRole('dialog',{name:'Clip timing'})).toBeInTheDocument();
  expect(screen.getByLabelText('Start (s)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Close timing'}));
  expect(screen.queryByRole('dialog',{name:'Clip timing'})).not.toBeInTheDocument();
  expect(container.querySelectorAll('.timeline-lane-menu > button svg')).toHaveLength(5);
  expect(screen.getByRole('button', { name: 'Add B-roll layer' })).toBeInTheDocument();
  unmount();
 } finally {window.matchMedia=previous;}
});
import { VisualTimelineCanvas } from '../VisualTimelineCanvas';
import { buildWorshipDocumentaryProject, insertAssetOnTrack, type TimelineTrackKind } from '../../../lib/timelineProject';
function fixture(){return insertAssetOnTrack(buildWorshipDocumentaryProject({title:'Touch timing'}),{trackKind:'voiceover',asset:{id:'voice',kind:'audio',source:'fish',label:'Voice take',durationSec:20},startSec:10,durationSec:10});}
test.each(['video', 'broll', 'music', 'captions', 'effects'] as TimelineTrackKind[])('unsupported %s timing is inspectable with a reason, cannot submit, and leaves existing mute available', (kind) => {
  const p = insertAssetOnTrack(buildWorshipDocumentaryProject({ title: 'Unsupported timing' }), {
    trackKind: kind, startSec: 10, durationSec: 10,
    asset: { id: 'unsupported', kind: kind === 'music' ? 'audio' : 'video', source: 'upload', label: 'Unsupported take', durationSec: 20, path: 'take.mp4' },
  });
  const changed = vi.fn();
  const { container } = render(<VisualTimelineCanvas compact project={p} onProjectChange={changed} />);
  const picker = screen.getByLabelText('Select timeline clip') as HTMLSelectElement;
  fireEvent.change(picker, { target: { value: p.tracks.find((t) => t.kind === kind)!.clips[0].id } });
  fireEvent.click(screen.getByRole('button', { name: 'Timing' }));
  expect(screen.getByText(/Timing is not available for this track/)).toBeInTheDocument();
  for (const label of ['Start (s)', 'Source in (s)', 'Duration (s)']) expect(screen.getByLabelText(label)).toBeDisabled();
  const apply = screen.getByRole('button', { name: 'Apply timing' });
  expect(apply).toBeDisabled();
  // Even a programmatic submit must not bypass the capability gate.
  fireEvent.submit(apply.closest('form')!);
  expect(changed).not.toHaveBeenCalled();
  expect(container.querySelector('select')).toBeEnabled();
  const mute = screen.getByRole('button', { name: 'Mute selected' });
  expect(mute).toBeEnabled();
  fireEvent.click(mute);
  expect(changed.mock.lastCall![0].tracks.find((t: { kind: string }) => t.kind === kind).clips[0].muted).toBe(true);
});
test('selecting a tiny clip from accessible picker, editing atomically and muting uses parent project',()=>{
  const changed=vi.fn();
  function Harness(){const [p,setP]=useState(fixture);return <VisualTimelineCanvas compact project={p} onProjectChange={next=>{changed(next);setP(next);}}/>;}
  render(<Harness/>);
  const id=fixture().tracks.find(t=>t.kind==='voiceover')!.clips[0].id;
  // IDs are generated; select the real option rather than a fabricated ID.
  const picker=screen.getByLabelText('Select timeline clip') as HTMLSelectElement;
  expect(id).toBeTruthy();fireEvent.change(picker,{target:{value:picker.options[1].value}});
  fireEvent.click(screen.getByRole('button',{name:'Timing'}));
  fireEvent.change(screen.getByLabelText('Start (s)'),{target:{value:'12.25'}});
  fireEvent.change(screen.getByLabelText('Source in (s)'),{target:{value:'2'}});
  fireEvent.change(screen.getByLabelText('Duration (s)'),{target:{value:'6'}});
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Apply timing'}));
  expect(changed.mock.lastCall![0].tracks.find((t:any)=>t.kind==='voiceover').clips[0]).toMatchObject({startSec:12.25,sourceStartSec:2,durationSec:6});
  fireEvent.click(screen.getByRole('button',{name:'Mute selected'}));
  expect(changed.mock.lastCall![0].tracks.find((t:any)=>t.kind==='voiceover').clips[0]).toMatchObject({muted:true,startSec:12.25,sourceStartSec:2});
});
test('locked selection is inspectable but Apply, split, mute and remove are disabled',()=>{
 const p=fixture();p.tracks.find(t=>t.kind==='voiceover')!.locked=true;
 render(<VisualTimelineCanvas compact project={p} onProjectChange={vi.fn()}/>);
 const picker=screen.getByLabelText('Select timeline clip') as HTMLSelectElement;fireEvent.change(picker,{target:{value:picker.options[1].value}});
 fireEvent.click(screen.getByRole('button',{name:'Timing'}));
 for(const name of ['Apply timing','Split clip','Remove clip','Mute selected'])expect(screen.getByRole('button',{name})).toBeDisabled();
});
test.each(['hidden', 'sidecar'] as const)('%s VO timing remains read-only with no submit callback', (state) => {
 const p = fixture(); const track = p.tracks.find((t) => t.kind === 'voiceover')!;
 if (state === 'hidden') track.hidden = true; else track.clips[0].id = 'clip-sidecar-sync-voiceover-0';
 const changed = vi.fn(); render(<VisualTimelineCanvas compact project={p} onProjectChange={changed} />);
 const picker = screen.getByLabelText('Select timeline clip');
 fireEvent.change(picker, { target: { value: track.clips[0].id } });
 fireEvent.click(screen.getByRole('button', { name: 'Timing' }));
 expect(screen.getByText(/Timing is read-only: this lane is locked\/hidden/)).toBeInTheDocument();
 const apply = screen.getByRole('button', { name: 'Apply timing' });
 expect(apply).toBeDisabled();
 fireEvent.submit(apply.closest('form')!);
 expect(changed).not.toHaveBeenCalled();
});
test('timeline scrubber stays independently available and forwards fractional seconds',()=>{
 const seek=vi.fn();render(<VisualTimelineCanvas compact project={fixture()} timeSec={12.5} onTimeChange={seek}/>);
 fireEvent.change(screen.getByLabelText('Timeline playhead'),{target:{value:'13.75'}});expect(seek).toHaveBeenCalledWith(13.75);
 expect(screen.getByText('0:13 / 4:30')).toBeInTheDocument();
});
