import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composioState, modelState } from '../src/settingsSummary';

describe('settings sections', () => {
  it('collapses Composio once a key is saved', () => {
    assert.deepEqual(composioState({ composio: 'saved' }), { configured: true, summary: 'Composio connected' });
    assert.equal(composioState({ composio: null }).configured, false);
  });

  it('collapses OpenRouter once a key is saved, naming the preset', () => {
    assert.deepEqual(modelState({ openrouter: 'saved', preset: 'os-chat' }), { configured: true, summary: 'OpenRouter · os-chat' });
    assert.deepEqual(modelState({ openrouter: null, preset: 'os-chat' }), { configured: false, summary: 'OpenRouter key needed' });
  });

});
