import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tokenFromHash } from '../src/linkToken';

describe('tokenFromHash', () => {
  it('reads the token from a one-time link', () => {
    assert.equal(tokenFromHash('#token=abc123'), 'abc123');
  });

  it('decodes characters escaped in the link', () => {
    assert.equal(tokenFromHash('#token=a%2Bb%2Fc%3D'), 'a+b/c=');
  });

  it('returns null when there is no token', () => {
    assert.equal(tokenFromHash(''), null);
    assert.equal(tokenFromHash('#'), null);
    assert.equal(tokenFromHash('#token='), null);
    assert.equal(tokenFromHash('#other=1'), null);
  });
});
