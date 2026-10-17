import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SERIES_COLORS } from '../src/config.js';

test('history series colors match the frontend palette', () => {
  const app = fs.readFileSync(new URL('../../frontend/src/App.jsx', import.meta.url), 'utf8');
  const block = /const SERIES_COLORS = \[([^\]]*)\]/.exec(app);
  assert.ok(block, 'SERIES_COLORS not found in frontend/src/App.jsx');
  const frontend = [...block[1].matchAll(/'(#[0-9a-fA-F]{6})'/g)].map((m) => m[1]);
  assert.deepEqual(SERIES_COLORS, frontend);
});
