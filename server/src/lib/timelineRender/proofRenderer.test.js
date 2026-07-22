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
