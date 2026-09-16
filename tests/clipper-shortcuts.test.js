import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../addons/browser/clipper/client.js';

test('default and legacy S/K shortcuts become S/Z while custom bindings and connection survive', async () => {
  let stored = {};
  const previous = globalThis.chrome;
  globalThis.chrome = { storage: { local: { get: async () => ({...stored}) } } };
  try {
    assert.equal((await settings()).saveKey, 'z');
    stored = { downloadKey:'s', saveKey:'k', token:'fixture', server:'http://localhost:1234', previewWidth:400 };
    const legacy = await settings();
    assert.equal(legacy.saveKey,'z'); assert.equal(legacy.token,'fixture'); assert.equal(legacy.previewWidth,400);
    assert.equal(stored.saveKey,'k', 'Reading settings must not rewrite stored credentials or preferences');
    stored = {...stored, shortcutVersion:1}; assert.equal((await settings()).saveKey,'k');
    stored = {downloadKey:'d', saveKey:'k'}; assert.equal((await settings()).saveKey,'k');
    stored = {downloadKey:'s', saveKey:'q'}; assert.equal((await settings()).saveKey,'q');
  } finally { globalThis.chrome = previous; }
});
