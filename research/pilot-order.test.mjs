import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import PilotReporter from './pilot-reporter.cjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'research/test-catalog.json'), 'utf8')).tests;
function order(method, seed = 17) {
  const run = spawnSync(process.execPath, [path.join(root, 'research/pilot-order.mjs'), method,
    path.join(root, 'src'), path.join(root, 'src'), path.join(root, 'research/test-catalog.json'), String(seed)], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout).order;
}
test('shortest baseline really uses historical duration', () => {
  assert.deepEqual(order('shortest'), [...catalog].sort((a, b) => a.costMs - b.costMs).map((item) => item.title));
  assert.notDeepEqual(order('shortest'), order('original'));
});
test('random seed is reproducible and preserves all tests', () => {
  assert.deepEqual(order('random', 41), order('random', 41));
  assert.deepEqual(order('random', 41).toSorted(), catalog.map((item) => item.title).toSorted());
  assert.notDeepEqual(order('random', 41), order('random', 42));
});
test('no source change keeps original order without any detector input', () => {
  assert.deepEqual(order('prioritized'), order('original'));
});
test('expected fail-fast stop is not mistaken for infrastructure failure', () => {
  const originalSend = process.send;
  const messages = [];
  process.send = (message) => messages.push(message);
  try {
    const reporter = new PilotReporter();
    reporter.onError({ message: '\u001b[31mTesting stopped early after 1 maximum allowed failures.\u001b[39m' });
    assert.equal(messages.length, 0);
    reporter.onError({ message: 'Worker process unexpectedly exited' });
    assert.equal(messages[0].type, 'pilot-error');
    reporter.onTestEnd({ title: 'detector' }, { status: 'failed', duration: 7 });
    assert.deepEqual(messages[1], { type: 'pilot-test', title: 'detector', status: 'failed', durationMs: 7 });
  } finally { process.send = originalSend; }
});
