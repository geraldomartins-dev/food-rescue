import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot, 'research/test-catalog.json'), 'utf8')).tests;

function changedLines(diff) {
  const lines = [];
  for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let i = 0; i < Math.max(count, 1); i++) lines.push(Math.max(1, start + i));
  }
  return [...new Set(lines)];
}

function contextAt(file, source, lineNumber) {
  const lines = source.split(/\r?\n/);
  for (let index = Math.min(lineNumber - 1, lines.length - 1); index >= 0; index--) {
    const line = lines[index];
    if (file === 'src/app.js') {
      const route = line.match(/^app\.(?:get|post|patch|put|delete)\('([^']+)'/);
      if (route) return { route: route[1] };
    } else {
      const symbol = line.match(/^export (?:async )?function ([A-Za-z_$][\w$]*)\b/);
      if (symbol) return { symbol: `${file}#${symbol[1]}` };
    }
  }
  return { sharedAppSetup: file === 'src/app.js' };
}

function gitDiffForCandidates(candidateSrc, referenceSrc = path.join(projectRoot, 'src')) {
  const changes = [];
  for (const name of fs.readdirSync(candidateSrc).filter((name) => name.endsWith('.js'))) {
    const original = path.join(referenceSrc, name);
    const candidate = path.join(candidateSrc, name);
    if (!fs.existsSync(original) || fs.readFileSync(original, 'utf8') === fs.readFileSync(candidate, 'utf8')) continue;
    const run = spawnSync('git', ['diff', '--no-index', '--unified=0', '--', original, candidate], { encoding: 'utf8' });
    if (run.status !== 1) throw new Error(`Could not compare src/${name}: ${run.stderr}`);
    changes.push({ file: `src/${name}`, lines: changedLines(run.stdout), source: fs.readFileSync(candidate, 'utf8') });
  }
  return changes;
}

function gitDiffForWorktree() {
  const run = spawnSync('git', ['diff', '--unified=0', 'HEAD', '--', 'src'], { cwd: projectRoot, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`Could not read git diff: ${run.stderr}`);
  const changes = [];
  let current;
  for (const line of run.stdout.split(/\r?\n/)) {
    const file = line.match(/^\+\+\+ b\/(src\/[^\s]+\.js)$/);
    if (file) {
      current = { file: file[1], lines: [], source: fs.readFileSync(path.join(projectRoot, file[1]), 'utf8') };
      changes.push(current);
    } else if (current && line.startsWith('@@ ')) {
      current.lines.push(...changedLines(line));
    }
  }
  return changes;
}

export function prioritize(changes) {
  const contexts = changes.flatMap(({ file, lines, source }) => lines.map((line) => ({ file, line, ...contextAt(file, source, line) })));
  const ranked = catalog.map((test, originalIndex) => {
    let score = 0;
    const reasons = [];
    for (const context of contexts) {
      if (context.route && test.routes.includes(context.route)) {
        score += 3;
        reasons.push(`${context.file}:${context.line} route ${context.route}`);
      } else if (context.symbol && test.symbols.includes(context.symbol)) {
        score += 3;
        reasons.push(`${context.file}:${context.line} symbol ${context.symbol}`);
      } else if (context.sharedAppSetup) {
        score += 1;
        reasons.push(`${context.file}:${context.line} shared setup`);
      }
    }
    return { title: test.title, score, estimatedCostMs: test.costMs, reasons, originalIndex };
  });
  if (ranked.some((test) => test.score > 0)) {
    ranked.sort((a, b) => b.score - a.score || a.estimatedCostMs - b.estimatedCostMs || a.originalIndex - b.originalIndex);
  }
  return { changedContexts: contexts.map(({ source, ...context }) => context),
    order: ranked.map(({ originalIndex, ...test }) => test) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const candidateFlag = process.argv.indexOf('--candidate-src');
  const referenceFlag = process.argv.indexOf('--reference-src');
  if (process.argv.includes('--help')) {
    console.log('Usage: node research/prioritize-tests.mjs [--candidate-src path] [--reference-src path]\nWithout an option, compares the working tree with HEAD.');
  } else {
    if (candidateFlag >= 0 && !process.argv[candidateFlag + 1]) throw new Error('--candidate-src needs a path');
    if (referenceFlag >= 0 && (candidateFlag < 0 || !process.argv[referenceFlag + 1])) throw new Error('--reference-src needs --candidate-src and a path');
    const changes = candidateFlag >= 0
      ? gitDiffForCandidates(path.resolve(process.argv[candidateFlag + 1]), referenceFlag >= 0 ? path.resolve(process.argv[referenceFlag + 1]) : undefined)
      : gitDiffForWorktree();
    console.log(JSON.stringify(prioritize(changes), null, 2));
  }
}
