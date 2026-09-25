// End-to-end smoke for the Voice & Render editor work.
// Drives the RUNNING app: both pages, both layouts, desktop and mobile.
import http from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const WebSocket = createRequire(import.meta.url)('ws');

const TOKEN = process.argv[2] || fs.readFileSync('tok.txt', 'utf8');
const BASE = 'http://localhost:5174';

const get = p => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: 9333, path: p }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
  }).on('error', rej);
});

const t = (await get('/json/list')).find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
let id = 0; const pending = new Map();
const send = (m, q = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
ws.on('message', raw => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
await new Promise(r => ws.on('open', r));
await send('Page.enable'); await send('Runtime.enable');
const ev = async e => (await send('Runtime.evaluate', { returnByValue: true, expression: e })).result.value;

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });
const waitFor = async (expr, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await ev(expr)) return true; await new Promise(r => setTimeout(r, 200)); }
  return false;
};

async function boot(path, seed, w = 1900, h = 1000) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: h > w });
  await send('Page.navigate', { url: BASE + '/' });
  await new Promise(r => setTimeout(r, 2200));
  await send('Runtime.evaluate', { expression:
    `localStorage.setItem('BF_TOKEN', ${JSON.stringify(TOKEN)}); ${seed || ''}` });
  await send('Page.navigate', { url: BASE + path });
  await new Promise(r => setTimeout(r, 6500));
}

const clickTool = name => ev(`(()=>{const n=${JSON.stringify(name)};const b=[...document.querySelectorAll('[role="tab"]')].find(x=>x.textContent.trim().startsWith(n));return b?(b.click(),'ok'):'MISSING';})()`);
const panelText = () => ev(`(document.querySelector('[role="tabpanel"]')||{}).innerText||''`);
const shellHeight = () => ev(`(()=>{const s=[...document.querySelectorAll('div')].find(d=>{const c=getComputedStyle(d);return c.position==='fixed'&&c.zIndex==='30'&&d.getBoundingClientRect().width>300;});return s?Math.round(s.getBoundingClientRect().height):0;})()`);

// ============ RENDER — classic ============
await boot('/app/render', `localStorage.setItem('bf.render.editorLayout','false');`);
check('R/classic renders', (await ev(`/Send it to/.test(document.body.innerText)`)) === true);
check('R/classic keeps the background picker',
  (await ev(`[...document.querySelectorAll('button')].some(b=>/From library/i.test(b.textContent))`)) === true);
check('R/classic keeps Generate visuals',
  (await ev(`/Generate visuals from my script/i.test(document.body.innerText)`)) === true);
check('R/classic offers Editor view',
  (await ev(`[...document.querySelectorAll('button')].some(b=>/Editor view/i.test(b.textContent))`)) === true);

// ============ RENDER — editor ============
await boot('/app/render', `localStorage.setItem('bf.render.editorLayout','true');`);
const rShell = await shellHeight();
check('R/editor shell fills viewport', rShell === 1000, `h=${rShell}`);
const rTools = await ev(`[...document.querySelectorAll('[role="tab"]')].map(b=>b.textContent.trim())`);
// Captions · Visuals · Audio · Output · Share. Share arrived when the Share
// Kit stopped being classic-only.
check('R/editor has 5 tools', Array.isArray(rTools) && rTools.length === 5, (rTools || []).join(' | '));
await clickTool('Visuals'); await waitFor(`/Auto|background/i.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
check('R/editor visuals panel holds the real background picker',
  (await ev(`[...document.querySelectorAll('[role="tabpanel"] button, [role="tabpanel"] label')].some(b=>/From library|Upload from device/i.test(b.textContent))`)) === true);
check('R/editor visuals panel keeps Generate visuals',
  /Generate visuals from my script/i.test(await panelText()));
await clickTool('Share'); await waitFor(`/caption|share/i.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
check('R/editor share panel holds the Share Kit',
  (await ev(`[...document.querySelectorAll('[role="tabpanel"] button')].some(b=>/Copy Caption/i.test(b.textContent))`)) === true);
await clickTool('Captions'); await waitFor(`/Overlay text/.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
check('R/editor captions panel', /Overlay text/.test(await panelText()));

await clickTool('Audio'); await waitFor(`/Voice track/.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
check('R/editor audio panel', /Voice track/.test(await panelText()));

await clickTool('Output'); await waitFor(`/Output frame/.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
const outText = await panelText();
check('R/editor output panel', /Output frame/.test(outText) && /Duration/.test(outText));
check('R/editor caption width is named',
  (await ev(`!!document.querySelector('input[type=range][aria-label="Caption width"]')`)) === true);

check('R/editor Render states its blocker',
  (await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^Render$/i.test(x.textContent.trim()));return b?!!b.getAttribute('title'):false;})()`)) === true);

await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Classic view/i.test(x.textContent));if(b)b.click();})()`);
await waitFor(`/Send it to/.test(document.body.innerText)`);
check('R/editor returns to classic', (await ev(`/Send it to/.test(document.body.innerText)`)) === true);

// ============ VOICE — classic ============
await boot('/app/voice-audio', `localStorage.setItem('bf.voice.editorLayout','false');`);
check('V/classic renders', (await ev(`/Give it a/.test(document.body.innerText)`)) === true);
check('V/classic keeps Audio treatment',
  (await ev(`/Audio treatment/i.test(document.body.innerText)`)) === true);
check('V/classic keeps Voice clone',
  (await ev(`/Voice clone/i.test(document.body.innerText)`)) === true);
check('V/classic offers Editor view',
  (await ev(`[...document.querySelectorAll('button')].some(b=>/Editor view/i.test(b.textContent))`)) === true);

// ============ VOICE — editor ============
await boot('/app/voice-audio', `localStorage.setItem('bf.voice.editorLayout','true');`);
const vShell = await shellHeight();
check('V/editor shell fills viewport', vShell === 1000, `h=${vShell}`);
const vTools = await ev(`[...document.querySelectorAll('[role="tab"]')].map(b=>b.textContent.trim())`);
// Script · Record · Treat · Clone · Music · Takes. Music arrived when the
// soundtrack library stopped being classic-only.
check('V/editor has 6 tools', Array.isArray(vTools) && vTools.length === 6, (vTools || []).join(' | '));
check('V/editor script panel has the text box',
  (await ev(`!!document.querySelector('[role="tabpanel"] textarea')`)) === true);

await clickTool('Record'); await new Promise(r => setTimeout(r, 1200));
check('V/editor record panel loads', ((await panelText()) || '').length > 0);

await clickTool('Treat'); await waitFor(`/Process Audio/i.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
// The treatment rack itself, not a "go to classic" stub.
check('V/editor treat holds the full treatment rack',
  (await ev(`[...document.querySelectorAll('[role="tabpanel"] button')].some(b=>/Process Audio/i.test(b.textContent))`)) === true);
check('V/editor treat keeps the preset select',
  (await ev(`[...document.querySelectorAll('[role="tabpanel"] option')].some(o=>/Clean voice/i.test(o.textContent))`)) === true);

await clickTool('Clone'); await waitFor(`/clone/i.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
// The clone flow with its consent checkboxes - a legal control, so its
// presence is asserted, not assumed.
check('V/editor clone holds the consent checkboxes',
  (await ev(`/rights and consent to clone/i.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`)) === true);
check('V/editor clone offers Clone Voice',
  (await ev(`[...document.querySelectorAll('[role="tabpanel"] button')].some(b=>/^Clone Voice$/i.test(b.textContent.trim()))`)) === true);

await clickTool('Music'); await waitFor(`/Music Library|soundtrack/i.test((document.querySelector('[role="tabpanel"]')||{}).innerText||'')`);
check('V/editor music panel holds the soundtrack library',
  (await ev(`[...document.querySelectorAll('[role="tabpanel"] button')].some(b=>/Load Music Library/i.test(b.textContent))`)) === true);

const vShot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('voice-editor-view.png', Buffer.from(vShot.data, 'base64'));

await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Classic view/i.test(x.textContent));if(b)b.click();})()`);
await waitFor(`/Give it a/.test(document.body.innerText)`);
check('V/editor returns to classic', (await ev(`/Give it a/.test(document.body.innerText)`)) === true);

// ============ MOBILE ============
await boot('/app/render', `localStorage.setItem('bf.render.editorLayout','true');`, 390, 844);
check('R/editor mobile: no horizontal overflow',
  (await ev(`document.documentElement.scrollWidth <= innerWidth`)) === true);
const mRail = await ev(`(()=>{const r=document.querySelector('[aria-label="Editor tools"]');return r?Math.round(r.getBoundingClientRect().height):0;})()`);
check('R/editor mobile: rail is a strip', mRail > 0 && mRail < 140, `rail h=${mRail}`);
const mPanelX = await ev(`(()=>{const p=document.querySelector('[role="tabpanel"]');return p?Math.round(p.getBoundingClientRect().x):-1;})()`);
check('R/editor mobile: panel on-screen', mPanelX === 0, `panel x=${mPanelX}`);

const pass = results.filter(r => r.pass).length;
console.log('\n=== STUDIO END-TO-END SMOKE ===');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
console.log(`\n${pass}/${results.length} passed`);
ws.close();
process.exit(pass === results.length ? 0 : 1);
