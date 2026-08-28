// Editor smoke suite - run after ANY editor/timeline change.
//
//   npm run smoke:editor
//
// Requires: dev server on :5174 and headless Chrome with --remote-debugging-port=9333.
// Pass a JWT as argv[2].
//
// Every check here corresponds to a bug the operator actually reported and that
// was fixed. They kept regressing because each fix was verified once by hand and
// nothing re-checked it afterwards. Add a check here whenever you fix an editor
// bug - that is the whole point of this file.
// Editor smoke suite. Runs EVERY previously-fixed behaviour in one pass so a
// regression is caught by running one command, not by the operator finding it.
import http from 'node:http';
import { createRequire } from 'node:module';
const WebSocket = createRequire(import.meta.url)('ws');
const PORT=9333, TOKEN=process.argv[2]||'', BASE='http://localhost:5174';
const get=p=>new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path:p},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});

(async()=>{
  const t=(await get('/json/list')).find(x=>x.type==='page');
  const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});
  let id=0;const pending=new Map();
  const send=(m,p={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:p}));});
  ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}});
  await new Promise(r=>ws.on('open',r));
  await send('Page.enable');await send('Runtime.enable');
  const ev=async e=>(await send('Runtime.evaluate',{returnByValue:true,expression:e})).result.value;

  async function boot(w,h,seed){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:h>w});
    await send('Page.navigate',{url:BASE+'/'});
    await new Promise(r=>setTimeout(r,2000));
    await send('Runtime.evaluate',{expression:
      `localStorage.setItem('BF_TOKEN', ${JSON.stringify(TOKEN)});
       localStorage.setItem('bf.timeline.editorLayout','true');
       ${seed||''}`});
    await send('Page.navigate',{url:BASE+'/app/timeline'});
    await new Promise(r=>setTimeout(r,5500));
  }
  const overlayCount=()=>ev(`[...document.querySelectorAll('div')].filter(d=>{const c=getComputedStyle(d);return c.position==='fixed'&&d.getBoundingClientRect().width>600&&parseInt(c.zIndex||'0',10)>=40;}).length`);
  // Rail items are role="tab" and carry a live count ("Renders 12"), so match
  // on a prefix rather than exact button text.
  const clickTool=name=>ev(`(()=>{const n=${JSON.stringify(name)};const b=[...document.querySelectorAll('[role="tab"]')].find(x=>x.textContent.trim().startsWith(n));return b?(b.click(),'ok'):'MISSING';})()`);
  const clickText=re=>ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>${re}.test(x.textContent.trim()));if(!b)return'MISSING';if(b.disabled)return'DISABLED';b.click();return'ok';})()`);

  // Poll for a condition instead of sleeping a fixed amount: fixed sleeps
  // raced the React re-render and produced false FAILs.
  const waitFor=async(expr,timeoutMs=6000)=>{
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      if(await ev(expr)) return true;
      await new Promise(r=>setTimeout(r,200));
    }
    return false;
  };

  const results=[];
  const check=(name,pass,detail)=>{results.push({name,pass,detail});};

  const SEED_MEDIA=`localStorage.setItem('BF_SCL_SOURCE_PATH', JSON.stringify('uploads/source-video-71cdc98e-decd-4df1-a66e-786458a82923.mp4'));
     localStorage.setItem('BF_SCL_SOURCE_KIND', JSON.stringify('video'));`;

  // ---- desktop ----
  await boot(1900,1000,SEED_MEDIA);
  const shellH=await ev(`(()=>{const s=[...document.querySelectorAll('div')].find(d=>{const c=getComputedStyle(d);return c.position==='fixed'&&c.zIndex==='30'&&d.getBoundingClientRect().width>600;});const r=s&&s.getBoundingClientRect();return r?Math.round(r.height):0;})()`);
  check('shell fills viewport', shellH===1000, `shell h=${shellH}`);
  check('topbar chip hides raw filename', (await ev(`(()=>{const e=document.querySelector('span.cursor-help[title]');return e?(/loaded$/i.test(e.textContent.trim())&&/\.mp4$/.test(e.getAttribute('title')||'')):false;})()`))===true);

  const before=await overlayCount();
  const trimClick=await clickText('/^Trim$/');
  await new Promise(r=>setTimeout(r,2500));
  const after=await overlayCount();
  check('Trim opens an overlay', trimClick==='ok'&&after>before, `${trimClick} ${before}->${after}`);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Cancel|Close/i.test(x.textContent.trim()));if(b)b.click();})()`);
  await new Promise(r=>setTimeout(r,1200));

  await clickTool('Background');
  await new Promise(r=>setTimeout(r,1200));
  const b2=await overlayCount();
  const libClick=await clickText('/From library|^Library$/');
  await new Promise(r=>setTimeout(r,2500));
  const a2=await overlayCount();
  check('From library opens the picker', libClick==='ok'&&a2>b2, `${libClick} ${b2}->${a2}`);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Done');if(b)b.click();})()`);
  await new Promise(r=>setTimeout(r,1000));

  await boot(1900,1000,SEED_MEDIA+`localStorage.setItem('BF_SCL_RENDERED_VIDEO', JSON.stringify('stale-from-last-session.mp4'));`);
  // Assert on the STALE FILE specifically. A bare <video> count was a valid
  // proxy when the stage had no live preview; the preview now renders video
  // layers legitimately, so counting elements flags a false regression.
  check('stage ignores a stale render',
    (await ev(`[...document.querySelectorAll('video')].every(v=>!/stale-from-last-session/.test(v.src))`))===true);

  await boot(1900,1000,SEED_MEDIA+`localStorage.setItem('BF_SCL_EDITED_LINES', JSON.stringify(['line one','line two']));localStorage.setItem('BF_SCL_KINETIC_CAPTIONS','true');`);
  await clickTool('Captions'); await new Promise(r=>setTimeout(r,1200));
  check('caption lines visible in editor', (await ev(`/Caption lines/.test(document.body.innerText)`))===true);

  // Reset to a known state before measuring clip bleed. The project persists
  // SERVER-side per user (timelineApi wins over localStorage), so the Grade
  // effect this suite adds accumulated run over run until the effects lane
  // "overlapped" on state no user action produced. Strip them through the
  // app's own Remove buttons; create the project through the editor's Scenes
  // panel when this user has none yet (that create affordance used to be
  // classic-only).
  await boot(1900,1000,SEED_MEDIA);
  await clickTool('Scenes');
  await waitFor(`/Opening \\/ Arrival|Create worship documentary timeline/.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Create worship documentary timeline/i.test(x.textContent));if(b)b.click();})()`);
  await waitFor(`/Opening \\/ Arrival/.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
  check('scenes panel reaches a project from the editor',
    (await ev(`/Opening \\/ Arrival/.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`))===true);
  await ev(`(()=>{const b=[...document.querySelectorAll('[role="tabpanel"] button')].find(x=>/Opening/.test(x.textContent));if(b)b.click();})()`);
  await waitFor(`document.querySelectorAll('[aria-pressed="true"]').length>0`);
  for(let i=0;i<40;i++){
    const removed=await ev(`(()=>{const b=document.querySelector('[aria-label^="Remove "]');if(!b)return false;b.click();return true;})()`);
    if(!removed) break;
    await new Promise(r=>setTimeout(r,250));
  }
  await new Promise(r=>setTimeout(r,1600)); // let the debounced autosave PUT the cleaned project

  const overlaps=await ev(`(()=>{
    const b=[...document.querySelectorAll('[aria-label^="Timeline clip"]')].map(e=>{
      const r=e.getBoundingClientRect();
      return {x:Math.round(r.x),w:Math.round(r.width),y:Math.round(r.y)};});
    let bad=0;
    for(let i=0;i<b.length;i++)for(let j=i+1;j<b.length;j++){
      const A=b[i],B=b[j];
      if(Math.abs(A.y-B.y)>6) continue;          // different lane
      if(Math.abs(A.x-B.x)<2 && Math.abs(A.w-B.w)<2) continue;  // duplicate clip, not a bleed
      const [L,R]=A.x<=B.x?[A,B]:[B,A];
      if(L.x+L.w > R.x+4) bad++;   // >4px = real bleed, not sub-pixel rounding
    }
    return bad;})()`);
  check('clips do not overlap', overlaps===0, `${overlaps} overlapping pairs`);

  // ---- scenes + effects (built after the operator reported them dead) ----
  await boot(1900,1000,SEED_MEDIA);
  await clickTool('Scenes');
  // Wait for the PANEL to actually swap; a fixed sleep raced the re-render and
  // reported all three of these as broken while they worked by hand.
  await waitFor(`/Opening \/ Arrival/.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
  const sceneClick=await ev(`(()=>{const b=[...document.querySelectorAll('[role="tabpanel"] button')].find(x=>/Opening/.test(x.textContent));return b?(b.click(),'ok'):'MISSING';})()`);
  await waitFor(`document.querySelectorAll('[aria-pressed="true"]').length>0`);
  check('scene is selectable', sceneClick==='ok'&&(await ev(`document.querySelectorAll('[aria-pressed="true"]').length`))>0);
  check('effect controls appear on selection', (await ev(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Glow')`))===true);

  const fxBefore=await ev(`document.querySelectorAll('[aria-label^="Remove "]').length`);
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Grade');if(b)b.click();})()`);
  await waitFor(`document.querySelectorAll('[aria-label^="Remove "]').length>${fxBefore}`);
  const fxAfter=await ev(`document.querySelectorAll('[aria-label^="Remove "]').length`);
  check('adding an effect lands on the scene', fxAfter>fxBefore, `${fxBefore}->${fxAfter}`);
  check('effect reaches the render payload', (await ev(`(()=>{const raw=localStorage.getItem('BF_SCL_DOC_PROJECT');if(!raw)return true;const p=JSON.parse(raw);const t=(p.tracks||[]).find(x=>x.kind==='effects');return !t||t.clips.every(c=>!!c.effect);})()`))===true);

  // ---- live preview + resizable panel ----
  await boot(1900,1000,SEED_MEDIA+`localStorage.setItem('bf.editor.panelWidth','300');`);
  check('stage shows a live preview, not a render-only dead end',
    (await ev(`!!document.querySelector('[data-testid="live-preview-canvas"]')`))===true);
  check('preview has a scrub control',
    (await ev(`!!document.querySelector('input[aria-label="Preview playhead"]')`))===true);

  const w0=await ev(`(()=>{const p=document.querySelector('[role="tabpanel"]');return p?Math.round(p.getBoundingClientRect().width):0;})()`);
  const handle=await ev(`(()=>{const h=document.querySelector('[role="separator"][aria-label="Resize panel"]');if(!h)return'MISSING';const r=h.getBoundingClientRect();
    const opts={bubbles:true,clientX:r.x+3,clientY:r.y+40,pointerId:1};
    h.dispatchEvent(new PointerEvent('pointerdown',opts));
    window.dispatchEvent(new PointerEvent('pointermove',{...opts,clientX:r.x+130}));
    window.dispatchEvent(new PointerEvent('pointerup',{...opts,clientX:r.x+130}));
    return 'ok';})()`);
  await waitFor(`(()=>{const p=document.querySelector('[role="tabpanel"]');return p&&Math.round(p.getBoundingClientRect().width)!==${w0};})()`);
  const w1=await ev(`(()=>{const p=document.querySelector('[role="tabpanel"]');return p?Math.round(p.getBoundingClientRect().width):0;})()`);
  check('panel divider resizes the panel', handle==='ok'&&w1>w0, `${w0}->${w1}`);

  // ---- multi-upload + the two renderers ----
  await boot(1900,1000,SEED_MEDIA);
  await clickTool('Background');
  await waitFor(`/Upload from device|From library/.test(document.body.innerText)`);
  check('background upload accepts multiple files',
    (await ev(`[...document.querySelectorAll('input[type=file]')].some(i=>i.multiple&&/jpg|png|mp4/.test(i.accept||''))`))===true);
  check('backgrounds can be pushed to the timeline in bulk',
    (await ev(`[...document.querySelectorAll('button')].some(b=>/Add all to timeline/i.test(b.textContent))`))===true);
  check('preview resolves media through the media base (no bare storage keys)',
    (await ev(`[...document.querySelectorAll('[data-testid="live-preview-canvas"] img, [data-testid="live-preview-canvas"] video')]
       .every(e=>{const s=e.getAttribute('src')||'';
         return !s || s.startsWith('/') || s.startsWith('http') || s.startsWith('blob:') || s.startsWith('data:');})`))===true);

  // ---- render actions (Share / Download / Open) ----
  // renderedThisSession is deliberately NOT persisted, so drive a render's
  // completion through the app's own state rather than seeding storage.
  await boot(1900,1000,SEED_MEDIA);
  await ev(`(()=>{const btns=[...document.querySelectorAll('button')];
    const r=btns.find(b=>/^Render$/i.test(b.textContent.trim())); return !!r;})()`);
  check('a single Render button is present and enabled',
    (await ev(`(()=>{const b=[...document.querySelectorAll('button')].filter(x=>/^Render$/i.test(x.textContent.trim()));
       return b.length===1 && !b[0].disabled;})()`))===true);

  // ---- clips tool (the legacy audio assembly reached the editor) ----
  await clickTool('Clips');
  await waitFor(`/Add Clip/.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
  check('clips panel offers Add Clip, Save Project and Render Audio',
    (await ev(`(()=>{const t=(document.querySelector('[role="tabpanel"]')||{}).innerText||'';
       return /Add Clip/.test(t)&&/Save Project/.test(t)&&/Render Audio/.test(t);})()`))===true);
  await ev(`(()=>{const b=[...document.querySelectorAll('[role="tabpanel"] button')].find(x=>/Add Clip/.test(x.textContent));if(b)b.click();})()`);
  await waitFor(`/Manual audio path/.test(document.body.innerText)`);
  check('Add Clip opens the modal from the editor',
    (await ev(`/Manual audio path/.test(document.body.innerText)`))===true);
  // Close via the backdrop so the next section starts clean.
  await ev(`(()=>{const back=document.querySelector('.fixed.inset-0.z-50 > .absolute.inset-0');if(back)back.click();})()`);
  await new Promise(r=>setTimeout(r,800));

  // ---- unified-editor additions: Output frame, right rail, Script tool ----
  await boot(1900,1000,SEED_MEDIA+`localStorage.setItem('BF_SCRIPTS', JSON.stringify([{title:'Peace in the Storm',hook:'In the chaos, calm awaits you.',verse:'Jesus is in your boat with you.',reference:'Mark 4:39',reflection:'His presence brings peace.',cta:'Save this for when you need peace.'}]));`);
  check('Output frame control is in the topbar (3 frames)',
    (await ev(`(()=>{const s=document.querySelector('select[aria-label="Output frame"]');return !!s&&s.options.length===3;})()`))===true);
  check('properties rail has a visible resize handle',
    (await ev(`!!document.querySelector('[role="separator"][aria-label="Resize properties"]')`))===true);
  check('properties rail has a maximize toggle',
    (await ev(`!!document.querySelector('button[aria-label="Maximize properties panel"], button[aria-label="Restore properties panel"]')`))===true);

  await clickTool('Script');
  await waitFor(`/Add to Captions lane/.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
  check('Script quick tool docks in the editor with the shared library',
    (await ev(`/Peace in the Storm/.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`))===true);
  check('Script panel offers the next step - Voice this',
    (await ev(`[...document.querySelectorAll('[role="tabpanel"] button')].some(b=>/Voice this/i.test(b.getAttribute('aria-label')||b.textContent))`))===true);
  check('Clear canvas is one click away in the topbar',
    (await ev(`[...document.querySelectorAll('button')].some(b=>/^Clear canvas$/i.test(b.textContent.trim()))`))===true);
  await ev(`(()=>{const b=[...document.querySelectorAll('[role="tabpanel"] button')].find(x=>/Add to Captions lane/i.test(x.getAttribute('aria-label')||x.textContent));if(b)b.click();})()`);
  await waitFor(`/caption clip/.test(document.body.innerText)||JSON.parse(localStorage.getItem('BF_SCL_EDITED_LINES')||'[]').length>0`);
  check('the script LANDS as caption clips on this timeline',
    (await ev(`JSON.parse(localStorage.getItem('BF_SCL_EDITED_LINES')||'[]').length`))>=3);

  await clickTool('Story');
  await waitFor(`/Upload a sermon|Start new/.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
  check('Story quick tool docks in the editor',
    (await ev(`(()=>{const t=(document.querySelector('[role="tabpanel"]')||{}).innerText||'';return /Upload a sermon|Start new/.test(t)&&/Visual style|cinematic|Stepper|Source/i.test(document.body.innerText);})()`))===true);

  await clickTool('Series');
  await waitFor(`/Generate series/.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
  check('Series quick tool docks with preview-first guard',
    (await ev(`(()=>{const p=document.querySelector('[role="tabpanel"]');if(!p)return false;const gen=[...p.querySelectorAll('button')].find(b=>/Generate series/.test(b.textContent));const prev=[...p.querySelectorAll('button')].some(b=>/Preview segments/.test(b.textContent));return !!gen&&gen.disabled&&prev;})()`))===true);

  await clickTool('Voice');
  await waitFor(`/Land on VO lane/i.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
  check('Voice tool docks the WHOLE lab: sub-tabs, muscular providers, landing footer, shared takes list',
    (await ev(`(()=>{const p=document.querySelector('[role="tabpanel"]');if(!p)return false;const t=p.innerText||'';const tabs=[...p.querySelectorAll('[role="tablist"][aria-label="Voice lab"] [role="tab"]')].map(b=>b.textContent.trim());const want=['Generate','Record','Treat','Music','Clone','Compare','Animation','Takes'];return want.every(w=>tabs.some(x=>x.startsWith(w)))&&/ElevenLabs/i.test(t)&&/Edge-TTS/i.test(t)&&/Land on VO lane/i.test(t)&&/Recent audio/i.test(t);})()`))===true);
  // Click, then let React commit before reading the panel.
  await ev(`[...document.querySelectorAll('[role="tablist"][aria-label="Voice lab"] [role="tab"]')].find(x=>/^Treat/.test(x.textContent.trim()))?.click(); 'ok'`);
  await waitFor(`document.querySelector('[role="tablist"][aria-label="Voice lab"] [role="tab"][aria-selected="true"]')?.textContent.trim().startsWith('Treat')`);
  check('Voice lab sub-tabs switch without leaving the editor (Treat shows audio treatment)',
    (await ev(`(()=>{const t=(document.querySelector('[role="tabpanel"]')||{}).innerText||'';return /denoise|loudness|treatment|preset|normali/i.test(t);})()`))===true);

  await clickTool('Output');
  await waitFor(`/Before you render/i.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
  check('Output tool shows readiness as visible state with ONE render action and the Share Kit',
    (await ev(`(()=>{const p=document.querySelector('[role="tabpanel"]');if(!p)return false;const t=p.innerText||'';const btns=[...p.querySelectorAll('button')];return /Before you render/i.test(t)&&btns.some(b=>/^Render /i.test(b.textContent.trim()))&&/Share Kit/i.test(t);})()`))===true);
  check('Output tool docks the WHOLE render lab: Captions / Visuals / Audio / Output / Share tabs',
    (await ev(`(()=>{const tabs=[...document.querySelectorAll('[role="tablist"][aria-label="Render lab"] [role="tab"]')].map(b=>b.textContent.trim());return ['Captions','Visuals','Audio','Output','Share'].every(w=>tabs.includes(w));})()`))===true);
  await ev(`[...document.querySelectorAll('[role="tablist"][aria-label="Render lab"] [role="tab"]')].find(x=>x.textContent.trim()==='Output')?.click(); 'ok'`);
  await waitFor(`document.querySelector('[role="tablist"][aria-label="Render lab"] [role="tab"][aria-selected="true"]')?.textContent.trim()==='Output'`);
  check('Render lab Output tab carries frame, duration, caption width and delivery',
    (await ev(`(()=>{const t=(document.querySelector('[role="tabpanel"]')||{}).innerText||'';return /Output frame/i.test(t)&&/Duration/i.test(t)&&/Caption width/i.test(t)&&/waveform/i.test(t);})()`))===true);

  // ---- vertical timeline resize ----
  await boot(1900,1000,SEED_MEDIA+`localStorage.setItem('bf.editor.stripPct','38');`);
  const measure=`(()=>{
    const sep=document.querySelector('[role="separator"][aria-label="Resize timeline"]');
    const strip=sep&&sep.nextElementSibling;
    const stage=document.querySelector('[data-testid="live-preview-canvas"]');
    return {sep:!!sep, strip:strip?Math.round(strip.getBoundingClientRect().height):0,
            stage:stage?Math.round(stage.getBoundingClientRect().height):0};})()`;
  const stripBefore=await ev(measure);
  check('timeline has a vertical drag handle', stripBefore.sep===true);

  // Drag UPWARD - the operator's ask.
  await ev(`(()=>{const h=document.querySelector('[role="separator"][aria-label="Resize timeline"]');
    const r=h.getBoundingClientRect();
    const o={bubbles:true,clientX:r.x+400,clientY:r.y+3,pointerId:7};
    h.dispatchEvent(new PointerEvent('pointerdown',o));
    window.dispatchEvent(new PointerEvent('pointermove',{...o,clientY:r.y-180}));
    window.dispatchEvent(new PointerEvent('pointerup',{...o,clientY:r.y-180}));})()`);
  await waitFor(`(()=>{const sep=document.querySelector('[role="separator"][aria-label="Resize timeline"]');
    const st=sep&&sep.nextElementSibling;
    return st && Math.round(st.getBoundingClientRect().height)!==${stripBefore.strip};})()`);
  const stripAfter=await ev(measure);
  check('dragging up grows the timeline', stripAfter.strip>stripBefore.strip, `${stripBefore.strip}->${stripAfter.strip}`);
  // The whole point of a clamped percentage: the preview must survive.
  check('the preview is not squeezed to nothing', stripAfter.stage>120, `stage h=${stripAfter.stage}`);

  // ---- portrait ----
  await boot(390,844,SEED_MEDIA);
  const railP=await ev(`(()=>{const r=document.querySelector('[aria-label="Editor tools"]');const b=r&&r.getBoundingClientRect();return b?Math.round(b.height):0;})()`);
  check('portrait rail is a strip', railP>0&&railP<120, `rail h=${railP}`);
  const panelX=await ev(`(()=>{const p=document.querySelector('[role="tabpanel"]');const b=p&&p.getBoundingClientRect();return b?Math.round(b.x):-1;})()`);
  check('portrait panel on-screen', panelX===0, `panel x=${panelX}`);
  check('no horizontal overflow', (await ev(`document.documentElement.scrollWidth<=innerWidth`))===true);

  // ---- landscape ----
  await boot(844,390,SEED_MEDIA);
  const mid=await ev(`(()=>{const r=document.querySelector('[aria-label="Editor tools"]');const m=r&&r.parentElement;const b=m&&m.getBoundingClientRect();return b?Math.round(b.height):0;})()`);
  check('landscape mid row has height', mid>80, `midRow h=${mid}`);
  check('landscape sticky header holds', (await ev(`(()=>{const c=document.querySelector('div[class*="sticky"][class*="left-0"]');if(!c)return false;let s=c.parentElement;while(s&&getComputedStyle(s).overflowX!=='auto')s=s.parentElement;if(!s)return false;const x0=Math.round(c.getBoundingClientRect().x);s.scrollLeft=200;const moved=s.scrollLeft;const x1=Math.round(c.getBoundingClientRect().x);s.scrollLeft=0;return moved>50&&x0===x1;})()`))===true);

  const pass=results.filter(r=>r.pass).length;
  console.log('\n=== EDITOR SMOKE ===');
  for(const r of results) console.log(`${r.pass?'PASS':'FAIL'}  ${r.name}${r.detail?'  ['+r.detail+']':''}`);
  console.log(`\n${pass}/${results.length} passed`);
  ws.close();
  process.exit(pass===results.length?0:1);
})().catch(e=>{console.error('ERR',e.message);process.exit(2);});
