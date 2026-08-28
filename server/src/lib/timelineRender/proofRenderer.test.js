import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  buildProofRenderCommand,
  prepareVoiceoverAssets,
  resolveTimelineAssetPath,
} from './proofRenderer.js';

function plan() {
  return {
    projectId: 'timeline-test',
    aspect: '16:9',
    quality: 'proof_720p',
    durationSec: 12,
    tracks: [
      {
        kind: 'video',
        clips: [{ id: 'main', label: 'Main', path: 'uploads/main.mp4', startSec: 0, durationSec: 12, transform: { fit: 'face-safe' } }],
      },
      {
        kind: 'broll',
        clips: [{ id: 'broll', label: 'B-roll', path: '/outputs/videoGen/rays.mp4', startSec: 4, durationSec: 3, transform: { fit: 'contain' } }],
      },
      {
        kind: 'voiceover',
        clips: [{ id: 'vo', label: 'VO', placeholder: true, prompt: 'Welcome', startSec: 0, durationSec: 4 }],
      },
    ],
  };
}

describe('timeline proofRenderer', () => {
  test('resolveTimelineAssetPath safely resolves uploads and /outputs paths', () => {
    const root = path.resolve('/tmp/biblefuel-server');
    assert.equal(resolveTimelineAssetPath('uploads/main.mp4', { serverRoot: root }), path.join(root, 'uploads/main.mp4'));
    assert.equal(resolveTimelineAssetPath('/outputs/videoGen/rays.mp4', { outputDir: path.join(root, 'outputs') }), path.join(root, 'outputs/videoGen/rays.mp4'));
    assert.equal(resolveTimelineAssetPath('../secret.env', { serverRoot: root }), null);
  });

  test('buildProofRenderCommand produces low-res ffmpeg command with main video and optional B-roll input', () => {
    const cmd = buildProofRenderCommand(plan(), {
      outputPath: path.resolve('/tmp/biblefuel-server/outputs/timeline/out.mp4'),
      serverRoot: path.resolve('/tmp/biblefuel-server'),
      outputDir: path.resolve('/tmp/biblefuel-server/outputs'),
    });

    assert.equal(cmd.ok, true);
    assert.equal(cmd.ignoredPlaceholders, 1);
    assert.match(cmd.args.join(' '), /-i .*main\.mp4/);
    assert.match(cmd.args.join(' '), /-i .*rays\.mp4/);
    assert.match(cmd.args.join(' '), /scale=1280:720/);
    assert.equal(cmd.publicUrl, '/outputs/timeline/out.mp4');
  });

  test('prepareVoiceoverAssets synthesizes Chatterbox placeholder prompts to timeline audio files', async () => {
    const calls = [];
    const prepared = await prepareVoiceoverAssets(plan(), {
      outputDir: path.resolve('/tmp/biblefuel-server/outputs'),
      synthesizeVoiceover: async ({ text, outputPath }) => {
        calls.push({ text, outputPath });
        return { ok: true, outputPath, provider: 'chatterbox' };
      },
    });

    assert.equal(prepared.generatedVoiceovers.length, 1);
    assert.equal(calls[0].text, 'Welcome');
    assert.match(calls[0].outputPath, /outputs[\\/]timeline[\\/]audio[\\/]timeline-test-vo-0\.wav$/);
    assert.equal(prepared.plan.tracks.find((track) => track.kind === 'voiceover').clips[0].path.endsWith('timeline-test-vo-0.wav'), true);
    assert.equal(prepared.plan.tracks.find((track) => track.kind === 'voiceover').clips[0].placeholder, false);
    assert.equal(prepared.generatedVoiceovers[0].provider, 'chatterbox');
  });

  test('prepareVoiceoverAssets can fall back from Chatterbox to Abi and reports provider history', async () => {
    const attempted = [];
    const prepared = await prepareVoiceoverAssets(plan(), {
      outputDir: path.resolve('/tmp/biblefuel-server/outputs'),
      voiceoverProviders: [
        {
          id: 'chatterbox',
          synthesize: async () => {
            attempted.push('chatterbox');
            return { ok: false, error: 'Chatterbox down' };
          },
        },
        {
          id: 'abi',
          synthesize: async ({ outputPath }) => {
            attempted.push('abi');
            return { ok: true, outputPath, provider: 'abi' };
          },
        },
      ],
    });

    assert.equal(prepared.ok, true);
    assert.deepEqual(attempted, ['chatterbox', 'abi']);
    assert.equal(prepared.generatedVoiceovers[0].provider, 'abi');
    assert.deepEqual(prepared.generatedVoiceovers[0].fallbacks, [{ provider: 'chatterbox', error: 'Chatterbox down' }]);
    assert.equal(prepared.plan.tracks.find((track) => track.kind === 'voiceover').clips[0].source, 'abi');
  });

  test('buildProofRenderCommand mixes generated VO at clip start and ducks base audio', () => {
    const withVo = plan();
    withVo.tracks[2].clips[0] = {
      ...withVo.tracks[2].clips[0],
      placeholder: false,
      path: '/outputs/timeline/audio/timeline-test-vo-0.wav',
    };
    const cmd = buildProofRenderCommand(withVo, {
      outputPath: path.resolve('/tmp/biblefuel-server/outputs/timeline/out.mp4'),
      serverRoot: path.resolve('/tmp/biblefuel-server'),
      outputDir: path.resolve('/tmp/biblefuel-server/outputs'),
    });

    const joined = cmd.args.join(' ');
    assert.equal(cmd.ok, true);
    assert.equal(cmd.ignoredPlaceholders, 0);
    assert.match(joined, /timeline-test-vo-0\.wav/);
    assert.match(joined, /adelay=0\|0/);
    assert.match(joined, /volume=0\.35/);
    assert.match(joined, /amix=inputs=2/);
    assert.match(joined, /-map \[a\]/);
  });
});

// ── Multi-track composition (music bed, captions, uncapped B-roll/VO) ──

function richPlan() {
  return {
    projectId: 'timeline-rich',
    aspect: '16:9',
    durationSec: 30,
    tracks: [
      { kind: 'video', clips: [{ id: 'main', path: 'uploads/main.mp4', startSec: 0, durationSec: 30 }] },
      {
        kind: 'broll',
        clips: [
          { id: 'b1', path: '/outputs/videoGen/a.mp4', startSec: 4, durationSec: 3 },
          { id: 'b2', path: '/outputs/videoGen/b.mp4', startSec: 12, durationSec: 3 },
          { id: 'b3', path: '/outputs/videoGen/c.mp4', startSec: 20, durationSec: 3 },
        ],
      },
      {
        kind: 'voiceover',
        clips: [
          { id: 'v1', path: '/outputs/timeline/vo1.mp3', startSec: 0, durationSec: 4 },
          { id: 'v2', path: '/outputs/timeline/vo2.mp3', startSec: 10, durationSec: 4 },
          { id: 'v3', path: '/outputs/timeline/vo3.mp3', startSec: 18, durationSec: 4 },
          { id: 'v4', path: '/outputs/timeline/vo4.mp3', startSec: 24, durationSec: 3 },
          { id: 'v5', path: '/outputs/timeline/vo5.mp3', startSec: 27, durationSec: 2 },
        ],
      },
      { kind: 'music', clips: [{ id: 'm1', path: '/outputs/music/bed.mp3', startSec: 0, durationSec: 30 }] },
      {
        kind: 'captions',
        clips: [
          { id: 'c1', text: 'Welcome to the house of God', startSec: 1, durationSec: 3 },
          { id: 'c2', text: "He is worthy of all praise", startSec: 8, durationSec: 3 },
        ],
      },
      { kind: 'effects', clips: [{ id: 'e1', path: '/outputs/fx/glow.mov', startSec: 0, durationSec: 2 }] },
    ],
  };
}

const richOpts = {
  outputPath: path.resolve('/tmp/biblefuel-server/outputs/timeline/rich.mp4'),
  serverRoot: path.resolve('/tmp/biblefuel-server'),
  outputDir: path.resolve('/tmp/biblefuel-server/outputs'),
};

describe('proofRenderer — multi-track composition', () => {
  test('overlays EVERY B-roll clip, not just the first', () => {
    const cmd = buildProofRenderCommand(richPlan(), richOpts);
    const filter = cmd.args[cmd.args.indexOf('-filter_complex') + 1];
    const overlays = filter.match(/overlay=0:0:enable=/g) || [];
    assert.equal(overlays.length, 3, 'all three B-roll clips must be composed');
  });

  test('B-roll overlays are chained in timeline order', () => {
    const cmd = buildProofRenderCommand(richPlan(), richOpts);
    const filter = cmd.args[cmd.args.indexOf('-filter_complex') + 1];
    assert.ok(filter.indexOf("between(t,4,7)") < filter.indexOf("between(t,12,15)"));
    assert.ok(filter.indexOf("between(t,12,15)") < filter.indexOf("between(t,20,23)"));
  });

  test('mixes ALL voice-overs, not only the first four', () => {
    const cmd = buildProofRenderCommand(richPlan(), richOpts);
    const filter = cmd.args[cmd.args.indexOf('-filter_complex') + 1];
    for (let i = 0; i < 5; i += 1) assert.match(filter, new RegExp(`\[vo${i}\]`));
  });

  test('includes the music bed, looped and ducked under narration', () => {
    const cmd = buildProofRenderCommand(richPlan(), richOpts);
    const filter = cmd.args[cmd.args.indexOf('-filter_complex') + 1];
    assert.match(filter, /\[bed\]/, 'music bed must be in the mix');
    assert.ok(cmd.args.includes('-stream_loop'), 'bed loops so a short track covers a long recap');
    const bedVol = /\[\d+:a\]volume=([\d.]+)\[bed\]/.exec(filter);
    assert.ok(bedVol && Number(bedVol[1]) <= 0.15, `bed should duck under narration, got ${bedVol?.[1]}`);
  });

  test('burns caption text onto the video', () => {
    const cmd = buildProofRenderCommand(richPlan(), richOpts);
    const filter = cmd.args[cmd.args.indexOf('-filter_complex') + 1];
    assert.match(filter, /drawtext=text='Welcome to the house of God'/);
    assert.match(filter, /enable='between\(t,1,4\)'/);
  });

  test('keeps event audio near full when there is no narration', () => {
    const p = richPlan();
    p.tracks = p.tracks.filter((t) => t.kind !== 'voiceover');
    const cmd = buildProofRenderCommand(p, richOpts);
    const filter = cmd.args[cmd.args.indexOf('-filter_complex') + 1];
    assert.match(filter, /\[0:a\]volume=1\[basea\]/,
      'real event audio must not be ducked when nothing is speaking over it');
  });

  test('reports effects clips as omitted instead of dropping them silently', () => {
    const cmd = buildProofRenderCommand(richPlan(), richOpts);
    assert.ok(cmd.warnings.length > 0);
    assert.match(cmd.warnings.join(' '), /Effects/);
  });

  test('amix does NOT normalize — otherwise every extra clip quietens the mix', () => {
    const cmd = buildProofRenderCommand(richPlan(), richOpts);
    const filter = cmd.args[cmd.args.indexOf('-filter_complex') + 1];
    assert.match(filter, /amix=[^;]*normalize=0/,
      'amix divides by input count by default; a 7-input service mix would drop to ~14% volume');
    assert.match(filter, /alimiter/, 'peaks must be limited once normalization is off');
  });

  test('a plan with no music or captions still builds a valid command', () => {
    const cmd = buildProofRenderCommand(plan(), richOpts);
    assert.equal(cmd.ok, true);
    const filter = cmd.args[cmd.args.indexOf('-filter_complex') + 1];
    assert.doesNotMatch(filter, /\[bed\]/);
    assert.doesNotMatch(filter, /drawtext/);
  });

  test('escapes caption text so quotes cannot break the filtergraph', () => {
    const p = richPlan();
    p.tracks.find((t) => t.kind === 'captions').clips = [
      { id: 'c1', text: "It's God's house", startSec: 0, durationSec: 2 },
    ];
    const cmd = buildProofRenderCommand(p, richOpts);
    const filter = cmd.args[cmd.args.indexOf('-filter_complex') + 1];
    assert.doesNotMatch(filter, /text='It's/, 'raw apostrophe would terminate the string early');
  });
});

// End to end from the PROJECT the client saves: per-line caption clips carry
// their text through the planner into drawtext filters. This is the path that
// produced a render with the picture and the voice but no captions.
import { buildTimelineRenderPlan } from './planner.js';
describe('captions reach ffmpeg', () => {
  test('per-line caption clips are burned in as drawtext, timed to their slots', () => {
    const project = {
      id: 'p', title: 't', targetDurationSec: 10, aspect: '16:9', renderSettings: { quality: 'proof_720p' },
      assets: {
        v: { id: 'v', kind: 'video', source: 'upload', label: 'main', path: 'uploads/main.mp4' },
        cap: { id: 'cap', kind: 'caption', source: 'system', label: '2 caption lines' },
      },
      tracks: [
        { id: 'tv', kind: 'video', label: 'Video', clips: [{ id: 'v1', assetId: 'v', startSec: 0, durationSec: 10, transform: { fit: 'cover' } }] },
        { id: 'tc', kind: 'captions', label: 'Captions', clips: [
          { id: 'c0', assetId: 'cap', startSec: 0, durationSec: 5, transform: { fit: 'cover' }, text: 'He is worthy' },
          { id: 'c1', assetId: 'cap', startSec: 5, durationSec: 5, transform: { fit: 'cover' }, text: 'of all praise' },
        ] },
      ],
    };
    const plan = buildTimelineRenderPlan(project, { quality: 'proof_720p' });
    assert.equal(plan.ok, true);
    const cmd = buildProofRenderCommand(plan, {
      outputPath: path.resolve('/tmp/biblefuel-server/outputs/timeline/out.mp4'),
      serverRoot: path.resolve('/tmp/biblefuel-server'),
      outputDir: path.resolve('/tmp/biblefuel-server/outputs'),
    });
    assert.equal(cmd.ok, true);
    const graph = cmd.args.join(' ');
    assert.match(graph, /drawtext=text='He is worthy'.*enable='between\(t,0,5\)'/);
    assert.match(graph, /drawtext=text='of all praise'.*enable='between\(t,5,10\)'/);
    // Default look still carries a readability scrim.
    assert.match(graph, /box=1:boxcolor=black@0\.\d+/);

    // The chosen preset drives colour and scrim: Soft Glow is pale butter type.
    const glow = buildProofRenderCommand(plan, {
      outputPath: path.resolve('/tmp/biblefuel-server/outputs/timeline/out.mp4'),
      serverRoot: path.resolve('/tmp/biblefuel-server'),
      outputDir: path.resolve('/tmp/biblefuel-server/outputs'),
      typographyPreset: 'soft-glow',
    });
    assert.match(glow.args.join(' '), /fontcolor=0xFAE58C/);
    assert.match(glow.args.join(' '), /boxcolor=black@0\.28/);
  });
});
