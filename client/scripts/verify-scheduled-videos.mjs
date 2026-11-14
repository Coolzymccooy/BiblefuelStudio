// Provider-free actual-component browser regression. No backend or live account.
// Usage: node scripts/verify-scheduled-videos.mjs <playwright-module-path> <evidence-dir>
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
const root = process.cwd();
const [playwrightPath, output] = process.argv.slice(2);
if (!playwrightPath || !output) throw new Error('Supply an existing Playwright module path and evidence directory.');
const { chromium } = await import(pathToFileURL(playwrightPath).href);
await fs.mkdir(output, { recursive: true });
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom'; import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {DonePanel} from './src/pages/StoryVideoPage'; import {ScheduledVideosPanel} from './src/components/ScheduledVideosPanel';
import {api} from './src/lib/api'; import './src/index.css';
window.calls=JSON.parse(sessionStorage.getItem('fixtureCalls')||'[]'); window.saved=JSON.parse(sessionStorage.getItem('fixtureSaved')||'[]'); window.failSave=sessionStorage.getItem('fixtureFailed')!=='true';
const record=(c)=>{window.calls.push(c);sessionStorage.setItem('fixtureCalls',JSON.stringify(window.calls));};
api.get=async(url)=>{ record({method:'GET',url});
 if(url==='/api/social/scheduled-posts')return {ok:true,data:{posts:window.saved}};
 if(url==='/api/social/tiktok/status')return {ok:true,data:{connected:true,username:'synthetic'}};
 if(url==='/api/media/upload-config')return {ok:true,data:{resumable:false,directMaxBytes:1000000,maxBytes:1000000}};
 if(url==='/api/music/library')return {ok:true,data:[]};
 if(url.includes('playlist'))return {ok:true,data:{playlists:[]}};
 return {ok:false,error:'Synthetic fixture: unsupported read'}; };
api.uploadRaw=async(url,blob)=>{record({method:'UPLOAD',url,bytes:blob.size});window.mediaHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');window.mediaBytes=blob.size;return {ok:true,data:{file:'/outputs/source-video-11111111-1111-4111-8111-111111111111.mp4',proxyPath:'/outputs/proxy.mp4'}}};
api.post=async(url,body)=>{record({method:'POST',url,body});
 if(url==='/api/social/post')return {ok:true,data:{results:[{destination:'tiktok',ok:true,draft:true}]}};
 if(url==='/api/social/scheduled-posts'){if(window.failSave){window.failSave=false;sessionStorage.setItem('fixtureFailed','true');if(innerWidth===390){window.saved=body.posts.map((p,i)=>({...p,id:String(i),status:'queued',mediaSha256:p.expectedSha256,bytes:p.expectedBytes}));sessionStorage.setItem('fixtureSaved',JSON.stringify(window.saved));}return {ok:false,error:'Synthetic timeout; outcome uncertain'}};window.saved=body.posts.map((p,i)=>({...p,id:String(i),status:'queued',mediaSha256:p.expectedSha256,bytes:p.expectedBytes}));sessionStorage.setItem('fixtureSaved',JSON.stringify(window.saved));return {ok:true,data:{posts:window.saved}};}
 return {ok:false,error:'Synthetic fixture: unsupported write'};};
const project={projectId:'synthetic-story',title:'Synthetic Story',scenes:[],music:{path:null}};
const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
createRoot(document.getElementById('root')).render(<MemoryRouter><QueryClientProvider client={qc}><main style={{padding:16,maxWidth:1000,margin:'auto'}}>{location.hash==='#story'?<DonePanel project={project}/>:<ScheduledVideosPanel/>}</main></QueryClientProvider></MemoryRouter>);`;
const result = await build({ root, configFile: false, mode: 'production', logLevel: 'warn', esbuild: { jsx: 'automatic', jsxDev: false }, define: { 'process.env.NODE_ENV': JSON.stringify('production') }, plugins: [{ name: 'synthetic-only', enforce: 'pre', resolveId(id) { if (id.endsWith('finite-harness.tsx')) return path.join(root,'finite-harness.tsx'); if (/hooks\/useAuth(?:\.ts)?$/.test(id)) return '\0synthetic-auth'; }, load(id) { if(id.endsWith('finite-harness.tsx')) return entry; if(id==='\0synthetic-auth')return 'const state={userId: "synthetic-owner",isLoading:false,isSuperAdmin:true,emailVerified:true};export const useAuth=Object.assign((select)=>select?select(state):state,{getState:()=>state});'; } }], build: { write: false, reportCompressedSize: false, lib: { entry: 'finite-harness.tsx', formats: ['iife'], name: 'SyntheticProof' } } });
const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => r.output);
const code = outputs.find(x => x.type === 'chunk').code;
const css = outputs.filter(x => x.type === 'asset' && x.fileName.endsWith('.css')).map(x => String(x.source)).join('\n');
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${code.replaceAll('</script','<\\/script')}</script>`;
const server = http.createServer((_req,res) => {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const port = server.address().port; let browser;
const evidence = { synthetic: true, providerCalls: 0, viewports: [], errors: [] };
function assert(ok, message) { if (!ok) throw new Error(message); }
try {
 browser = await chromium.launch({headless:true, ...(process.env.BF_TEST_CHROMIUM ? { executablePath: process.env.BF_TEST_CHROMIUM } : {})});
 const context = await browser.newContext({ serviceWorkers:'block' });
 await context.routeWebSocket('**/*', socket => socket.close());
 await context.route('**/*', route => new URL(route.request().url()).origin === `http://127.0.0.1:${port}` && route.request().isNavigationRequest() ? route.continue() : route.abort());
 const page = await context.newPage(); page.on('pageerror',e => evidence.errors.push(e.message));
 for(const width of [320,390,1280]) {
  await page.setViewportSize({width,height:900}); await page.goto(`http://127.0.0.1:${port}/story#story`);
  const button=page.getByRole('button',{name:'Post to TikTok',exact:true}); await button.waitFor(); await button.scrollIntoViewIfNeeded();
  const hit=await button.evaluate(el=>{const r=el.getBoundingClientRect();const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {hit:el.contains(t),width:r.width,height:r.height,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert(hit.hit && !hit.overflow && hit.height >= 44, `Story action covered/overflow/touch target at ${width}`);
  await button.click(); await page.getByText(/inbox as a draft/).waitFor();
  const sent=await page.evaluate(()=>window.calls.filter(c=>c.method==='POST'));
  assert(sent.length===1 && sent[0].url==='/api/social/post' && sent[0].body.videoUrl==='/outputs/story/synthetic-story/video.mp4' && sent[0].body.destination==='tiktok' && sent[0].body.title==='Synthetic Story','Wrong Story destination/source/title');
  await page.screenshot({path:path.join(output,`story-${width}.png`),fullPage:true}); evidence.viewports.push({surface:'story',viewportWidth:width,...hit});
  await page.evaluate(()=>{sessionStorage.clear();localStorage.clear();});
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByLabel('Finished MP4 files').setInputFiles({name:'final.mp4',mimeType:'video/mp4',buffer:Buffer.from('synthetic finished original')});
  await page.getByLabel('London date and time 1').fill('2099-11-18T08:00'); await page.getByRole('checkbox',{name:'TikTok — Public to everyone',exact:true}).check();
  await page.getByRole('button',{name:'Upload originals',exact:true}).click(); await page.getByText(/Original uploaded:/).waitFor();
  await page.getByLabel(/I reviewed/).check(); const schedule=page.getByRole('button',{name:'Schedule 2 posts',exact:true}); await schedule.scrollIntoViewIfNeeded();
  const queueHit=await schedule.evaluate(el=>{const r=el.getBoundingClientRect();return {hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),overflow:document.documentElement.scrollWidth>innerWidth};});
  assert(queueHit.hit && !queueHit.overflow,`Queue overflow/covered at ${width}`);
  await page.screenshot({path:path.join(output,`queue-${width}.png`),fullPage:true});
  await schedule.click(); await page.getByRole('alert').filter({hasText:'Synthetic timeout'}).waitFor();
  await page.reload();
  if(width!==390){await page.getByRole('button',{name:'Retry same request',exact:true}).click();}
  await page.getByText(/Scheduled posts confirmed in queue/).waitFor();
  const calls=await page.evaluate(()=>window.calls); const writes=calls.filter(c=>c.method==='POST');
  assert(width===390 ? writes.length===1 : writes.length===2 && JSON.stringify(writes[0])===JSON.stringify(writes[1]),'Reload retry identity drift or duplicate committed POST');
  assert(calls.filter(c=>c.method==='UPLOAD').length===1,'Reload reuploaded original');
  assert(writes[0].body.posts.every(p=>p.videoUrl.includes('source-video-') && /^[a-f0-9]{64}$/.test(p.expectedSha256) && p.expectedBytes===27 && p.privacyStatus===(p.destination==='youtube'?'public':'PUBLIC_TO_EVERYONE')),'Proxy/private publishing');
  assert(calls.filter(c=>c.method==='GET'&&c.url==='/api/social/scheduled-posts').length>=2,'No readback');
  await page.screenshot({path:path.join(output,`queue-reloaded-${width}.png`),fullPage:true});
  evidence.viewports.push({surface:'queue',width,...queueHit,retryIdentity:true,reload:true,committedLostResponse:width===390,readback:true});
  await page.evaluate(()=>{sessionStorage.clear();localStorage.clear();});
 }
 assert(evidence.errors.length===0,`Page errors: ${evidence.errors.join('; ')}`);
 await context.close(); evidence.passed=true;
} finally {
 if(browser)await browser.close(); await new Promise(resolve=>server.close(resolve));
 await fs.writeFile(path.join(output,'browser-proof.json'),JSON.stringify(evidence,null,2));
}
console.log(JSON.stringify(evidence,null,2));
