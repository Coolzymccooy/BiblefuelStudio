import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../../src/routes/jobs.js', import.meta.url), 'utf8');
const narrationSource = source.slice(source.indexOf('async function prepareShortNarration('), source.indexOf('function clampDuration('));
const coreSource = source.slice(source.indexOf('async function renderVideoCore('), source.indexOf('async function augmentPayloadWithKineticCaptions('));
const advancedSource = source.slice(source.indexOf('async function renderAdvancedVideo('), source.indexOf('async function runCampaignAutoPost('));
function harness({ duration = 30, unreadable = false, missing = false } = {}) {
  const effects = [];
  const stop = new Error('valid render boundary');
  const deps = {
    MAX_RENDER_SECONDS: 30,
    resolveAssetPath: p => missing ? null : p,
    isLocalOrRemote: () => true,
    isRemoteUrl: p => /^https:/.test(p || ''),
    localiseInput: async p => { effects.push('audio-download'); return 'download.wav'; },
    currentJobRun: null,
    probeAudioDuration: async () => { effects.push('probe'); if (unreadable) throw Error('unreadable'); return duration; },
    prepareShortCaptionLines: lines => lines,
    applyAutoBackground: async () => { effects.push('auto-background'); throw stop; },
    localiseJobInputs: async p => { effects.push('music-download'); return p; },
    augmentPayloadWithKineticCaptions: async () => { effects.push('alignment'); throw stop; },
    isStudioLook: () => false,
    isFileTooLarge: () => false,
    ensureLocalPath: async () => { effects.push('background-download'); throw stop; },
    clampDuration: n => Math.min(30, Math.max(1, n)),
    buildSceneGraph: () => { effects.push('scene-graph'); throw stop; },
    getDims: () => ({ w: 720, h: 1280 }),
    cleanCaptionLine: s => s,
    wrapTextLines: lines => lines,
    currentOutDir: () => 'fixture-output',
    path: { join: (...parts) => parts.join('/') },
    uuid: () => 'fixture',
    resolveTypographyPreset: () => null,
    buildLineDrawtext: args => { effects.push({ captionDuration: args.duration }); throw stop; },
  };
  const functions = new Function(...Object.keys(deps), `${narrationSource}\n${coreSource}\n${advancedSource}\nreturn { prepareShortNarration, renderVideoCore, renderAdvancedVideo };`)(...Object.values(deps));
  return { ...functions, effects, stop };
}
for (const duration of [29.999, 30, 30.000001, 57.459833]) {
  test(`probed ${duration}s uses strict cap, not caller duration fields`, async () => {
    const h = harness({ duration });
    const payload = { audioPath: 'voice.wav', durationSec: 1, durationMs: 1 };
    if (duration <= 30) {
      assert.equal((await h.prepareShortNarration(payload)).audioDuration, duration);
    } else {
      await assert.rejects(h.prepareShortNarration(payload), e => {
        assert.equal(e.code, 'NARRATION_EXCEEDS_RENDER_CAP');
        assert.equal(e.details.audioDurationSec, duration);
        assert.equal(e.details.maxDurationSec, 30);
        assert.equal(e.details.trimRequired, true);
        assert.match(e.message, /Shorten.*explicitly trimmed/);
        return true;
      });
    }
    assert.deepEqual(h.effects, ['probe']);
  });
}
for (const duration of [NaN, 0, -1, Infinity]) {
  test(`invalid probe ${duration} refuses`, async () => {
    await assert.rejects(harness({ duration }).prepareShortNarration({ audioPath: 'voice.wav' }), { code: 'NARRATION_DURATION_UNVERIFIABLE' });
  });
}
for (const options of [{ unreadable: true }, { missing: true }]) {
  test(`supplied ${options.missing ? 'missing' : 'unreadable'} audio cannot fall back to caller duration`, async () => {
    const h = harness(options);
    await assert.rejects(h.renderVideoCore({ audioPath: 'voice.wav', kineticCaptions: true, durationSec: 1, durationMs: 1, autoBackground: true }), { code: 'NARRATION_DURATION_UNVERIFIABLE' });
    assert.deepEqual(h.effects, options.missing ? [] : ['probe']);
  });
}
for (const shape of [{}, { kineticCaptions: true }, { scenes: [{ backgroundPath: 'https://example.com/bg.mp4', duration: 1 }] }, { words: [{ text: 'Hope', start: 0, end: 1 }] }]) {
  test(`over-cap core refuses before all work ${JSON.stringify(shape)}`, async () => {
    const h = harness({ duration: 57.459833 });
    await assert.rejects(h.renderVideoCore({ ...shape, audioPath: 'voice.wav', autoBackground: true, musicPath: 'https://example.com/music.mp3', durationSec: 1 }), { code: 'NARRATION_EXCEEDS_RENDER_CAP' });
    assert.deepEqual(h.effects, ['probe']);
  });
}
test('advanced entry independently refuses over-cap before scene downloads', async () => {
  const h = harness({ duration: 57.459833 });
  await assert.rejects(h.renderAdvancedVideo({ audioPath: 'voice.wav', durationSec: 1 }), { code: 'NARRATION_EXCEEDS_RENDER_CAP' });
  assert.deepEqual(h.effects, ['probe']);
});
test('remote narration downloads only necessary audio before refusing', async () => {
  const h = harness({ duration: 57.459833 });
  await assert.rejects(h.renderVideoCore({ audioPath: 'https://example.com/audio.wav', autoBackground: true }), { code: 'NARRATION_EXCEEDS_RENDER_CAP' });
  assert.deepEqual(h.effects, ['audio-download', 'probe']);
});
test('no-audio shorts retain existing auto-background path without probing', async () => {
  const h = harness();
  await assert.rejects(h.renderVideoCore({ autoBackground: true, durationSec: 20 }), e => e === h.stop);
  assert.deepEqual(h.effects, ['auto-background']);
});
test('valid cap-boundary audio reaches the shared advanced renderer', async () => {
  const h = harness();
  await assert.rejects(h.renderVideoCore({ audioPath: 'voice.wav', scenes: [{ backgroundPath: 'local.mp4', duration: 30 }] }), e => e === h.stop);
  assert.deepEqual(h.effects, ['probe', 'music-download', 'probe', 'scene-graph']);
});
for (const audioPath of [undefined, 'voice.wav']) {
  test(`legacy ${audioPath ? 'genuine-length' : 'no-audio'} duration is retained`, async () => {
    const h = harness({ duration: 26 });
    await assert.rejects(h.renderVideoCore({ backgroundPath: 'local.mp4', audioPath, lines: ['Hope'], durationSec: 1 }), e => e === h.stop);
    assert.deepEqual(h.effects, audioPath ? ['probe', 'music-download', { captionDuration: 26 }] : ['music-download', { captionDuration: 1 }]);
  });
}
for (const code of ['NARRATION_EXCEEDS_RENDER_CAP', 'NARRATION_DURATION_UNVERIFIABLE', 'CAPTION_SCRIPT_TOO_LARGE']) {
  test(`worker preserves structured ${code} failure`, async () => {
    const job = { id: 'fixture', status: 'queued', type: 'render_video' };
    const error = Object.assign(new Error('actionable refusal'), { code, details: { maxDurationSec: 30 } });
    const workerSource = source.slice(source.indexOf('async function workerTick()'), source.indexOf('function withVolatileProgress('));
    const deps = { loadJobs: () => ({ jobs: [job] }), safeUpdateJob: (_id, patch) => Object.assign(job, patch), executeJobImpl: async () => { throw error; }, maybeAutoPublish: () => assert.fail('must not publish') };
    const worker = new Function(...Object.keys(deps), `let running=false,store,activeJobId,currentJobCtx,currentJobRun; const volatileProgressByJob=new Map(),lastProgressByJob=new Map(); ${workerSource}; return workerTick;`)(...Object.values(deps));
    await worker();
    assert.equal(job.status, 'failed');
    assert.equal(job.errorCode, code);
    assert.deepEqual(job.errorDetails, error.details);
    assert.equal(job.result, undefined);
  });
}
