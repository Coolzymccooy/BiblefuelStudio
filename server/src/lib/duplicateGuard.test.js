import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { postFingerprint, checkDuplicate } from './duplicateGuard.js';

describe('postFingerprint', () => {
  test('ignores case, punctuation and spacing', () => {
    assert.equal(
      postFingerprint({ hook: 'You are NOT alone!', background: 'bg_1.mp4' }),
      postFingerprint({ hook: 'you are not alone', background: 'bg_1.mp4' })
    );
  });

  test('distinguishes different backgrounds', () => {
    assert.notEqual(
      postFingerprint({ hook: 'Same hook', background: 'a.mp4' }),
      postFingerprint({ hook: 'Same hook', background: 'b.mp4' })
    );
  });
});

describe('checkDuplicate', () => {
  const history = [
    { hook: 'God sees what nobody else sees.', background: 'cross.mp4' },
    { hook: 'Delay is not denial.', background: 'fireworks.mp4' },
  ];

  test('flags an exact hook+background repeat', () => {
    const r = checkDuplicate({ hook: 'God sees what nobody else sees.', background: 'cross.mp4' }, history);
    assert.equal(r.duplicate, true);
    assert.match(r.reason, /same hook and background/i);
  });

  test('does NOT flag the same hook over different footage', () => {
    const r = checkDuplicate({ hook: 'Delay is not denial.', background: 'ocean.mp4' }, history);
    assert.equal(r.duplicate, false);
    assert.match(r.reason, /background differs/i);
  });

  test('passes a genuinely new post cleanly', () => {
    const r = checkDuplicate({ hook: 'Brand new hook.', background: 'new.mp4' }, history);
    assert.equal(r.duplicate, false);
    assert.equal(r.reason, '');
  });

  test('handles empty or missing history', () => {
    assert.equal(checkDuplicate({ hook: 'x', background: 'y' }, []).duplicate, false);
    assert.equal(checkDuplicate({ hook: 'x', background: 'y' }, null).duplicate, false);
  });
});
