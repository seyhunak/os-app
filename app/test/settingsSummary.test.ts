import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { composioState, modelState } from '../src/settingsSummary';

describe('settings sections', () => {
  it('collapses Composio once a key is saved', () => {
    assert.deepEqual(composioState({ composio: 'saved' }), { configured: true, summary: 'Composio connected' });
    assert.equal(composioState({ composio: null }).configured, false);
  });

  it('collapses OpenRouter with a key and a model', () => {
    assert.deepEqual(modelState({ provider: 'openrouter', openrouter: 'saved', openrouterModel: 'cheap/model', model: 'cheap/model' }), { configured: true, summary: 'OpenRouter · cheap/model' });
    assert.equal(modelState({ provider: 'openrouter', openrouter: null, model: 'x' }).configured, false);
  });

  it('collapses local Ollama with just a model', () => {
    assert.equal(modelState({ provider: 'ollama', openrouter: null, ollamaModel: 'llama3', ollamaUrl: 'http://127.0.0.1:11434', model: '' }).configured, true);
    assert.equal(modelState({ provider: 'ollama', openrouter: null, ollamaModel: '', model: '' }).configured, false);
  });

  it('needs a key for Ollama\'s hosted address', () => {
    const hosted = { provider: 'ollama' as const, openrouter: null, ollamaModel: 'gpt-oss:cloud', ollamaUrl: 'https://ollama.com', model: '' };
    assert.equal(modelState({ ...hosted, ollama: null }).configured, false);
    assert.equal(modelState({ ...hosted, ollama: 'saved' }).configured, true);
  });
});
