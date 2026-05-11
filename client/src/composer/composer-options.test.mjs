import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PERMISSION_MODE,
  DEFAULT_MODEL_SPEED,
  modelSpeedLabel,
  normalizeModelSpeed,
  serviceTierForModelSpeed
} from './composer-options.js';

test('permission mode defaults to normal desktop permissions', () => {
  assert.equal(DEFAULT_PERMISSION_MODE, 'default');
});

test('model speed defaults to standard unless fast is selected', () => {
  assert.equal(DEFAULT_MODEL_SPEED, 'standard');
  assert.equal(normalizeModelSpeed('fast'), 'fast');
  assert.equal(normalizeModelSpeed('standard'), 'standard');
  assert.equal(normalizeModelSpeed('turbo'), 'standard');
  assert.equal(modelSpeedLabel('fast'), '快速');
  assert.equal(modelSpeedLabel('turbo'), '标准');
});

test('fast model speed maps to Codex service tier', () => {
  assert.equal(serviceTierForModelSpeed('fast'), 'fast');
  assert.equal(serviceTierForModelSpeed('standard'), null);
});
