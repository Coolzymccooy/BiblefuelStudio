import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { test, expect, vi } from 'vitest';
import { EditorShell } from '../EditorShell';
import { VisualTimelineCanvas } from '../../timeline/VisualTimelineCanvas';
import { buildWorshipDocumentaryProject, insertAssetOnTrack } from '../../../lib/timelineProject';

function phone() { const old = window.matchMedia; window.matchMedia = vi.fn().mockImplementation(q => ({matches:q.includes('max-width'),media:q,addEventListener:vi.fn(),removeEventListener:vi.fn()})); return () => {window.matchMedia=old;}; }
test('lane activation opens the corresponding sheet, including the already controlled tool after repeated dismissal', () => {
 const restore=phone();
 try {
 function Harness() {
  const [request,setRequest]=useState({id:'media',sequence:0});
  return <EditorShell compactMobile activeToolId={request.id} openToolRequest={request.sequence ? request : undefined} tools={[{id:'media',label:'Media',icon:'M'},{id:'music',label:'Music',icon:'A'}]} panels={{media:<p>Upload source</p>,music:<p>Music library</p>}} stage={null} strip={<><button onClick={()=>setRequest(r=>({id:'media',sequence:r.sequence+1}))}>Add footage</button><button onClick={()=>setRequest(r=>({id:'music',sequence:r.sequence+1}))}>Add music</button></>}/>;
 }
 render(<Harness/>);
 expect(screen.queryByRole('tabpanel')).toBeNull();
 for(const name of ['Add footage','Add footage','Add music','Add music']) {
  fireEvent.click(screen.getByRole('button',{name}));
  expect(screen.getByRole('tabpanel').id).toBe(name==='Add footage'?'panel-media':'panel-music');
  fireEvent.click(screen.getByRole('button',{name:'Hide panel'}));
 }
 } finally {restore();}
});
test('reserved navigation header slot is separate from the horizontally scrollable actions',()=>{
 const restore=phone();try {
 render(<EditorShell compactMobile reclaimMobileNavigation tools={[]} panels={{}} stage={null} topBar={<button>Render with a deliberately long label</button>}/>);
 const actions=screen.getByRole('button',{name:/Render/}).parentElement!;
 expect(actions.parentElement).toHaveAttribute('data-editor-header');
 expect(actions.parentElement?.lastElementChild).toHaveAttribute('data-editor-navigation-slot');
 expect(actions.style.minWidth).toBe('0px');
 }finally{restore();}
});
test('Classic phone can mute/unmute the selected clip and compact phone has only one replacement control',()=>{
 const restore=phone();try{
 const project=insertAssetOnTrack(buildWorshipDocumentaryProject({title:'Mute regression'}),{trackKind:'voiceover',asset:{id:'take',kind:'audio',source:'fish',label:'Original take',durationSec:10},startSec:0,durationSec:10});
 const changed=vi.fn();
 function Harness({compact=false}:{compact?:boolean}) {const [p,setP]=useState(project);return <VisualTimelineCanvas compact={compact} project={p} onProjectChange={next=>{setP(next);changed(next);}}/>;}
 const view=render(<Harness/>);
 fireEvent.click(screen.getByRole('button',{name:/^Original take Fish/}));
 fireEvent.click(screen.getByRole('button',{name:'Mute selected'}));
 expect(changed.mock.lastCall![0].tracks.find((t:any)=>t.kind==='voiceover').clips[0].muted).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Unmute selected'}));
 expect(changed.mock.lastCall![0].tracks.find((t:any)=>t.kind==='voiceover').clips[0].muted).toBe(false);
 view.unmount();render(<Harness compact/>);
 const picker=screen.getByLabelText('Select timeline clip') as HTMLSelectElement;
 fireEvent.change(picker,{target:{value:picker.options[1].value}});
 expect(screen.getAllByRole('button',{name:'Mute selected'})).toHaveLength(1);
 expect(document.querySelector('button[title="Mute clip"]')?.parentElement).toHaveClass('hidden');
 }finally{restore();}
});
