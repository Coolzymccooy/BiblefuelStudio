import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { buildWorshipDocumentaryProject, loadTimelineProject, saveTimelineProject } from '../../lib/timelineProject';
import { TimelinePage } from '../TimelinePage';
const mocks=vi.hoisted(()=>({get:vi.fn(),upload:vi.fn(),browser:vi.fn(),save:vi.fn()}));
vi.mock('../../lib/api',async original=>{const mod=await original<typeof import('../../lib/api')>();return {...mod,api:{...mod.api,get:mocks.get},timelineApi:{...mod.timelineApi,listProjects:async()=>({ok:true,data:{projects:[]}}),saveProject:mocks.save}};});
vi.mock('../../lib/mediaUpload',()=>({uploadMedia:mocks.upload}));
vi.mock('../../lib/timelineSourceInsertion',async original=>({...await original<object>(),browserSourceInfo:mocks.browser}));
vi.mock('../../components/timeline/SourceMediaPanel',()=>({SourceMediaPanel:(p:any)=><><button onClick={()=>p.onUpload(new File(['fixture'],'original.mov',{type:'video/quicktime'}))}>Upload fixture</button><button onClick={p.onInsertSourceMedia}>Insert fixture</button><output data-testid="proxy-state">{p.sourceMediaProxyStatus}</output></>}));
vi.mock('../VoiceAudioPage',()=>({VoiceLab:()=>null}));
vi.mock('../RenderPage',()=>({RenderLab:()=>null}));
vi.mock('../../components/timeline/LivePreviewStage',()=>({LivePreviewStage:()=>null}));
vi.mock('../../components/timeline/useSourceVocalRemoval',()=>({useSourceVocalRemoval:()=>({available:false})}));
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();localStorage.setItem('bf.timeline.editorLayout','true');saveTimelineProject(buildWorshipDocumentaryProject({title:'Original metadata regression'}));mocks.save.mockResolvedValue({ok:true});mocks.get.mockResolvedValue({ok:true,data:{}});mocks.upload.mockResolvedValue({file:'original.mov',proxyPath:'proxy.mp4',proxyStatus:'pending'});mocks.browser.mockRejectedValue(new Error('Original codec unsupported (deterministic fixture)'));});
async function mount(){render(<MemoryRouter><TimelinePage/></MemoryRouter>);fireEvent.click(screen.getByRole('button',{name:'Upload fixture'}));await waitFor(()=>expect(screen.getByTestId('proxy-state').textContent).toBe('pending'));}
function video(){return Object.values(loadTimelineProject()!.assets).find(a=>a.path==='original.mov');}
test('unsupported original browser codec inserts genuine server dimensions and full duration, not proxy geometry',async()=>{
 await mount();mocks.get.mockImplementation(async(url:string)=>url.includes('audio-adv/info')?{ok:true,data:{durationSec:61.4667,width:1080,height:1920}}:{ok:true,data:{}});
 fireEvent.click(screen.getByRole('button',{name:'Insert fixture'}));
 await waitFor(()=>expect(video()).toMatchObject({durationSec:61.4667,width:1080,height:1920}));
 expect(mocks.browser).not.toHaveBeenCalled();expect(loadTimelineProject()!.aspect).toBe('9:16');
 expect(loadTimelineProject()!.tracks.find(t=>t.kind==='video')!.clips[0]).toMatchObject({sourceStartSec:0,sourceDurationSec:61.4667,durationSec:61.4667});
});
test('proxy becoming ready during metadata await commits ready status instead of stale pending',async()=>{
 await mount();let resolveInfo!:(value:any)=>void;let resolveProxy!:(value:any)=>void;
 mocks.get.mockImplementation((url:string)=>url.includes('audio-adv/info')?new Promise(r=>{resolveInfo=r;}):url.includes('proxy-status')?new Promise(r=>{resolveProxy=r;}):Promise.resolve({ok:true,data:{}}));
 fireEvent.click(screen.getByRole('button',{name:'Insert fixture'}));
 // The real poll, not an extracted callback; use a short fake interval only after mounting.
 await act(async()=>{await new Promise(r=>setTimeout(r,5100));});
 expect(resolveProxy).toBeTypeOf('function');
 await act(async()=>{resolveProxy({ok:true,data:{status:'ready',proxyPath:'proxy.mp4'}});});
 expect(screen.getByTestId('proxy-state').textContent).toBe('ready');
 await act(async()=>{resolveInfo({ok:true,data:{durationSec:61.4667,width:1080,height:1920}});});
 await waitFor(()=>expect(video()).toMatchObject({proxyPath:'proxy.mp4',proxyStatus:'ready'}));
},15000);
