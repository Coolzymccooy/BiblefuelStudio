import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { downsamplePeaks, peaksCacheKey, PEAK_BUCKETS } from './audioPeaks.js';

// The client draws these peaks to a canvas, so zoom costs nothing and the
// trace re-tints with the theme. What has to be right here is the
// downsampling: a fixed number of buckets out regardless of how long the
// audio is, and honest min/max per bucket so a quiet passage does not read as
// silence.

/** Signed 16-bit PCM, mono, as ffmpeg -f s16le gives us. */
function pcm(samples) {
  const buf = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => buf.writeInt16LE(s, i * 2));
  return buf;
}

describe('downsamplePeaks', () => {
  test('returns exactly the requested number of buckets', () => {
    const peaks = downsamplePeaks(pcm(new Array(10000).fill(1000)), 64);
    assert.equal(peaks.length, 64);
  });

  test('each bucket is a [min, max] pair normalised to -1..1', () => {
    const peaks = downsamplePeaks(pcm([32767, -32768, 0, 0]), 1);
    const [min, max] = peaks[0];
    assert.ok(max > 0.99 && max <= 1, `max ${max}`);
    assert.ok(min < -0.99 && min >= -1, `min ${min}`);
  });

  test('silence reads as zero, not as noise', () => {
    const peaks = downsamplePeaks(pcm(new Array(1000).fill(0)), 8);
    for (const [min, max] of peaks) {
      assert.equal(min, 0);
      assert.equal(max, 0);
    }
  });

  test('a quiet passage keeps its shape rather than flattening', () => {
    // A tenth-amplitude signal must still be visible, so the trace shows
    // dynamics instead of a flat line the operator cannot read.
    const peaks = downsamplePeaks(pcm(new Array(1000).fill(3276)), 4);
    for (const [, max] of peaks) assert.ok(max > 0.09 && max < 0.11, `max ${max}`);
  });

  test('keeps the loudest moment in a bucket — peaks must not be averaged away', () => {
    // One loud sample among quiet ones: averaging would hide a clipped
    // transient, which is exactly what the operator is looking for.
    const samples = new Array(100).fill(100);
    samples[50] = 32767;
    const peaks = downsamplePeaks(pcm(samples), 1);
    assert.ok(peaks[0][1] > 0.99);
  });

  test('handles audio shorter than the bucket count', () => {
    const peaks = downsamplePeaks(pcm([1000, -1000]), 64);
    assert.equal(peaks.length, 64);
    for (const [min, max] of peaks) {
      assert.ok(Number.isFinite(min) && Number.isFinite(max));
    }
  });

  test('handles an empty buffer without throwing', () => {
    const peaks = downsamplePeaks(Buffer.alloc(0), 16);
    assert.equal(peaks.length, 16);
    assert.deepEqual(peaks[0], [0, 0]);
  });

  test('ignores a trailing odd byte rather than misreading it', () => {
    // A truncated stream must not shift every sample by one byte, which would
    // turn the whole trace into noise.
    const buf = Buffer.concat([pcm([1000, 2000]), Buffer.from([0x01])]);
    const peaks = downsamplePeaks(buf, 2);
    assert.equal(peaks.length, 2);
    for (const [min, max] of peaks) assert.ok(Number.isFinite(min) && Number.isFinite(max));
  });

  test('PEAK_BUCKETS is the default resolution', () => {
    assert.equal(downsamplePeaks(pcm(new Array(5000).fill(500))).length, PEAK_BUCKETS);
  });
});

describe('peaksCacheKey', () => {
  test('changes when the file changes — mtime and size both count', () => {
    const a = peaksCacheKey({ size: 1000, mtimeMs: 111 });
    assert.notEqual(a, peaksCacheKey({ size: 1001, mtimeMs: 111 }));
    assert.notEqual(a, peaksCacheKey({ size: 1000, mtimeMs: 222 }));
  });

  test('is stable for the same file', () => {
    assert.equal(peaksCacheKey({ size: 10, mtimeMs: 5 }), peaksCacheKey({ size: 10, mtimeMs: 5 }));
  });

  test('is filename-safe', () => {
    assert.match(peaksCacheKey({ size: 10, mtimeMs: 5 }), /^[A-Za-z0-9_-]+$/);
  });
});
