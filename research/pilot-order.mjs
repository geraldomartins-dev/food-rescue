import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// This process receives source paths and costs, never a detector or test outcome.
const [method, reference, candidate, catalogPath, seedText] = process.argv.slice(2);
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).tests;
let order = catalog.map(({ title, costMs }, index) => ({ title, costMs, index }));
if (method === 'prioritized') {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./prioritize-tests.mjs', import.meta.url)),
    '--candidate-src', candidate, '--reference-src', reference], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`Prioritizer failed: ${run.stderr}`);
  order = JSON.parse(run.stdout).order;
} else if (method === 'shortest') {
  order.sort((a, b) => a.costMs - b.costMs || a.index - b.index);
} else if (method === 'random') {
  let state = Number(seedText) >>> 0;
  for (let i = order.length - 1; i > 0; i--) {
    state = (1664525 * state + 1013904223) >>> 0;
    const j = Math.floor(state / 4294967296 * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
} else if (method !== 'original') throw new Error(`Unknown method: ${method}`);
console.log(JSON.stringify({ order: order.map(({ title }) => title) }));
