import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
  });
}

function relative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function changedFiles(before, after) {
  const all = new Set([...walk(path.join(before, 'src')).map((file) => relative(before, file)),
    ...walk(path.join(after, 'src')).map((file) => relative(after, file))]);
  return [...all].filter((file) => {
    const oldPath = path.join(before, file);
    const newPath = path.join(after, file);
    return !fs.existsSync(oldPath) || !fs.existsSync(newPath) ||
      fs.readFileSync(oldPath, 'utf8') !== fs.readFileSync(newPath, 'utf8');
  }).sort();
}

function directImports(root, file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const imports = [...source.matchAll(/\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g),
    ...source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)];
  return [...new Set(imports.map((match) => {
    const base = path.resolve(root, path.dirname(file), match[1]);
    const target = [base, `${base}.js`, path.join(base, 'index.js')].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    return target ? relative(root, target) : null;
  }).filter(Boolean))];
}

function dependencies(root, testFile) {
  const direct = new Set(directImports(root, testFile));
  const all = new Set(direct);
  const pending = [...direct];
  while (pending.length) {
    const file = pending.pop();
    for (const dependency of directImports(root, file)) {
      if (!all.has(dependency)) {
        all.add(dependency);
        pending.push(dependency);
      }
    }
  }
  return { direct, all };
}

export function prioritizeNodeTests({ before, after, costsMs = {} }) {
  const changed = changedFiles(before, after);
  const tests = walk(path.join(before, 'test')).filter((file) => file.endsWith('.test.js'))
    .map((file) => relative(before, file)).sort();
  const order = tests.map((testFile, originalIndex) => {
    const { direct, all } = dependencies(before, testFile);
    const directMatches = changed.filter((file) => direct.has(file));
    const indirectMatches = changed.filter((file) => !direct.has(file) && all.has(file));
    return { testFile, score: directMatches.length * 3 + indirectMatches.length,
      estimatedCostMs: costsMs[testFile] ?? null,
      reasons: [...directMatches.map((file) => `direct: ${file}`),
        ...indirectMatches.map((file) => `indirect: ${file}`)], originalIndex };
  });
  if (order.some((item) => item.score > 0)) {
    order.sort((a, b) => b.score - a.score ||
      (a.estimatedCostMs ?? Infinity) - (b.estimatedCostMs ?? Infinity) ||
      a.originalIndex - b.originalIndex);
  }
  return { changedFiles: changed, order: order.map(({ originalIndex, ...item }) => item) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  if (args.includes('--help')) {
    console.log('Usage: node research/prioritize-node-tests.mjs --before dir --after dir [--costs json]');
  } else {
    if (!args.includes('--before') || !args.includes('--after') || !value('--before') || !value('--after')) {
      throw new Error('--before and --after directories are required');
    }
    const costsMs = args.includes('--costs') ? JSON.parse(fs.readFileSync(value('--costs'), 'utf8')) : {};
    console.log(JSON.stringify(prioritizeNodeTests({ before: path.resolve(value('--before')),
      after: path.resolve(value('--after')), costsMs }), null, 2));
  }
}
