import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composioState, modelState } from '../src/settingsSummary';

describe('settings sections', () => {
  it('collapses Composio once a key is saved', () => {
    assert.deepEqual(composioState({ composio: 'saved' }), { configured: true, summary: 'Composio connected' });
    assert.equal(composioState({ composio: null }).configured, false);
  });

  it('collapses OpenRouter with a key and a model', () => {
    assert.deepEqual(modelState({ openrouter: 'saved', openrouterModel: 'cheap/model', model: 'cheap/model' }), { configured: true, summary: 'OpenRouter · cheap/model' });
    assert.equal(modelState({ openrouter: null, model: 'x' }).configured, false);
  });

});
