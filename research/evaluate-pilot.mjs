import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn, spawnSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const isStudy = args.includes('--study');
const prepareOnly = args.includes('--prepare');
if (isStudy ? args.some((arg) => !['--study', '--prepare'].includes(arg)) : args.length > 1 || prepareOnly) {
  throw new Error('Usage: evaluate-pilot.mjs [repetitions] | --study [--prepare]');
}
const studyPath = path.join(root, 'research/study-cases.json');
const lockPath = path.join(root, 'research/study-lock.json');
const study = isStudy ? JSON.parse(fs.readFileSync(studyPath, 'utf8')) : null;
const repeats = study?.repeats ?? Number(args[0] ?? 3);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20) throw new Error('Repetitions must be 1..20');
const sqlFiles = ['database/schema.sql', 'database/migrations/002_outbox_eventos.sql', 'database/migrations/003_auth_sessions.sql'];
const id = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const database = `food_rescue_eval_${id}`;
const output = path.join(root, 'work', `${prepareOnly ? 'study-prepared' : 'evaluation'}-${id}`);
const catalogPath = path.join(root, 'research/test-catalog.json');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const trackedFiles = ['research/test-catalog.json', 'research/prioritize-tests.mjs',
  'research/pilot-order.mjs', 'research/pilot-reporter.cjs', 'research/evaluate-pilot.mjs',
  'e2e/prioritization-pilot.spec.js', 'playwright.config.js', 'package-lock.json'];
if (study) {
  trackedFiles.push('package.json', 'research/study-cases.json', 'outputs/protocolo_avaliacao_food_rescue.md', ...sqlFiles);
  for (const entry of fs.readdirSync(path.join(root, 'src'), { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) trackedFiles.push(path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).replaceAll('\\', '/'));
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock.id !== study.id || Object.keys(lock.files).length !== trackedFiles.length ||
      trackedFiles.some((file) => lock.files[file] !== hash(path.join(root, file)))) {
    throw new Error('Frozen protocol inputs changed. Record a new protocol version before running.');
  }
}
const frozen = Object.fromEntries(trackedFiles.map((file) => [file, hash(path.join(root, file))]));
const source = fs.readFileSync(path.join(root, 'e2e/prioritization-pilot.spec.js'), 'utf8');
const blocks = source.split(/(?=^test\('piloto )/m);
const header = blocks.shift();
const tests = blocks.map((block) => ({ title: block.match(/^test\('([^']+)'/)?.[1], block }));
const titles = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).tests.map((test) => test.title);
if (tests.length !== 5 || titles.some((title, i) => title !== tests[i]?.title)) throw new Error('Catalog and test source disagree');

// Expected detectors are validation assertions AFTER execution, never ranking inputs.
const cases = study?.cases.map((item) => ({
  ...item, allowedDetectors: item.detectors.map((index) => titles[index])
})) ?? [
  { name: 'no_fault' },
  { name: 'auth_permission', file: 'app.js', from: "app.get('/api/v1/admin/metricas', authenticate, authorize('admin'),", to: "app.get('/api/v1/admin/metricas', authenticate, authorize('admin', 'doador'),", detector: titles[0] },
  { name: 'establishment_listing', file: 'establishments.js', from: 'FROM estabelecimentos WHERE usuario_responsavel_id=? ORDER BY criado_em DESC', to: 'FROM estabelecimentos WHERE usuario_responsavel_id=0 AND ? IS NOT NULL ORDER BY criado_em DESC', detector: titles[1] },
  { name: 'lot_visibility', file: 'lots.js', from: "WHERE l.status='disponivel' AND l.validade_em>UTC_TIMESTAMP(3) AND e.ativo=1", to: "WHERE l.status='reservado' AND l.validade_em>UTC_TIMESTAMP(3) AND e.ativo=1", detector: titles[2] },
  { name: 'reservation_response', file: 'rescues.js', from: "await db.commit(); return { id: requestId, status: 'reservada' };", to: "await db.commit(); return { id: requestId, status: 'solicitada' };", detector: titles[3] },
  { name: 'receipt_content', file: 'app.js', from: "res.type('application/pdf').sendFile(receiptPath(code));", to: "res.type('application/pdf').send('invalid pdf');", detector: titles[4] }
];
if (study && (new Set(cases.map((item) => item.name)).size !== cases.length ||
    cases.some((item) => !/^[a-z0-9_]+$/.test(item.name) || !/^[a-z-]+\.js$/.test(item.file) ||
      item.allowedDetectors.some((title) => !title) || item.from === item.to))) {
  throw new Error('Invalid frozen case definition');
}
const reference = path.join(output, 'reference', 'src');
fs.cpSync(path.join(root, 'src'), reference, { recursive: true });
for (const item of cases) {
  const target = path.join(output, item.name, 'src');
  fs.cpSync(reference, target, { recursive: true });
  if (item.file) {
    const file = path.join(target, item.file);
    const text = fs.readFileSync(file, 'utf8');
    if (text.split(item.from).length !== 2) throw new Error(`Nonunique mutation: ${item.name}`);
    fs.writeFileSync(file, text.replace(item.from, item.to));
    if (prepareOnly) {
      const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (checked.status !== 0) throw new Error(`Invalid prepared source in ${item.name}: ${checked.stderr}`);
    }
  }
}

function shuffle(items, seed) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    const j = Math.floor(seed / 4294967296 * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
const schedule = [];
for (let repetition = 1; repetition <= repeats; repetition++) {
  for (const [index, item] of cases.entries()) {
    const seed = (study?.seed ?? 20261104) + index * 100 + repetition;
    const executionSeed = study ? seed + 1_000_000 : seed;
    for (const method of shuffle(['original', 'shortest', 'random', 'prioritized'], executionSeed)) {
      schedule.push({ case: item.name, method, repetition, seed });
    }
  }
}
const summary = { version: 2, purpose: study ? 'Evaluation on new controlled Food Rescue changes' : 'Protocol calibration on previously used controlled cases; not independent effectiveness evaluation',
  database, node: process.version, platform: process.platform, frozen, repeats,
  metric: 'Parent monotonic elapsed time from order generation start to first failed-test IPC event reception; includes order CLI, spec preparation and test-runner startup. Application startup and database reset excluded equally.',
  schedule, results: [] };
if (study) Object.assign(summary, {
  protocolId: study.id, protocolLockSha256: hash(lockPath), baselineCommit: study.baselineCommit,
  cases: cases.map(({ name, allowedDetectors }) => ({ name, allowedDetectors }))
});
if (prepareOnly) {
  fs.writeFileSync(path.join(output, 'plan.json'), JSON.stringify({
    protocolId: study.id, protocolLockSha256: summary.protocolLockSha256, frozen, schedule
  }, null, 2));
  console.log(`Prepared ${cases.length} cases and ${schedule.length} executions: ${output}`);
  process.exit(0);
}
const save = () => fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
save();
const { env } = await import('../src/config.js');
if (study && !['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST)) {
  throw new Error('The frozen study requires a local MySQL instance');
}

// A new schema is created exclusively for this invocation. Never reuse or reset
// an existing schema. Reset can touch only the connection to the newly created one.
let connection;
let owned = false;
const specPath = path.join(root, 'e2e', `pilot-eval-${id}.spec.js`);
try {
  connection = await mysql.createConnection({ host: env.DB_HOST, port: env.DB_PORT,
    user: env.DB_USER, password: env.DB_PASSWORD, multipleStatements: true });
  if (study) {
    const [[{ version }]] = await connection.query('SELECT VERSION() AS version');
    summary.databaseVersion = version;
    save();
  }
  const [existing] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
  if (existing.length || database === env.DB_NAME) throw new Error('Refusing existing or configured database');
  await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  owned = true;
  await connection.query(`USE \`${database}\``);
  for (const file of sqlFiles) {
    const sql = fs.readFileSync(path.join(root, file), 'utf8')
      .replace(/CREATE DATABASE IF NOT EXISTS food_rescue[\s\S]*?;/i, '').replace(/\bUSE food_rescue\s*;/gi, '');
    await connection.query(sql);
  }
  const [tableRows] = await connection.query('SHOW TABLES');
  const tables = tableRows.map((row) => Object.values(row)[0]);
  for (const entry of schedule) {
    for (const file of trackedFiles) if (hash(path.join(root, file)) !== frozen[file]) throw new Error(`Frozen input changed: ${file}`);
    const [[selected]] = await connection.query('SELECT DATABASE() AS name');
    if (!owned || selected.name !== database) throw new Error('Database ownership guard failed');
    await connection.query('SET FOREIGN_KEY_CHECKS=0');
    try {
      for (const table of tables) await connection.query(`TRUNCATE TABLE \`${table.replaceAll('`', '``')}\``);
    } finally { await connection.query('SET FOREIGN_KEY_CHECKS=1'); }
    const caseDir = path.join(output, entry.case);
    const reservation = net.createServer();
    await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const server = spawn(process.execPath, [path.join(caseDir, 'src/server.js')], {
      cwd: caseDir, env: { ...process.env, NODE_ENV: 'test', DB_NAME: database, PORT: String(port),
        APP_ORIGIN: `http://127.0.0.1:${port}`, EMAIL_WORKER_ENABLED: 'false', BCRYPT_ROUNDS: '10' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let serverLog = '';
    server.stdout.on('data', (chunk) => { serverLog = (serverLog + chunk).slice(-4000); });
    server.stderr.on('data', (chunk) => { serverLog = (serverLog + chunk).slice(-4000); });
    server.on('error', () => {});
    try {
      let healthy = false;
      let healthError;
      for (let attempt = 0; attempt < 160; attempt++) {
        if (server.exitCode !== null) throw new Error('Pilot application exited');
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { signal: AbortSignal.timeout(1000) });
          healthy = response.ok;
          healthError = `HTTP ${response.status}`;
        } catch (error) { healthError = `${error.message}: ${error.cause?.code ?? ''}`; }
        if (healthy) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!healthy) throw new Error(`Pilot application failed health check (${healthError}); ${serverLog}`);
      const started = performance.now();
      const ordering = spawnSync(process.execPath, [path.join(root, 'research/pilot-order.mjs'), entry.method,
        reference, path.join(caseDir, 'src'), catalogPath, String(entry.seed)], { encoding: 'utf8', timeout: 15000 });
      if (ordering.status !== 0) throw new Error(`Order generation failed: ${ordering.stderr}`);
      const order = JSON.parse(ordering.stdout).order;
      if (order.length !== titles.length || new Set(order).size !== titles.length || order.some((title) => !titles.includes(title))) throw new Error('Order must contain every eligible test once');
      const orderGenerationMs = performance.now() - started;
      fs.writeFileSync(specPath, header + order.map((title) => tests.find((test) => test.title === title).block).join(''));
      const events = [];
      let detectedAtMs = null;
      const errors = [];
      const run = fork(path.join(root, 'node_modules/playwright/cli.js'), ['test', `e2e/${path.basename(specPath)}`,
        `--reporter=${path.join(root, 'research/pilot-reporter.cjs')}`, '--max-failures=1', '--retries=0', '--workers=1'], {
        cwd: root, silent: true, execArgv: [], env: { ...process.env, E2E_PILOT: '1',
          E2E_BASE_URL: `http://127.0.0.1:${port}` } });
      let diagnostic = '';
      run.stdout.on('data', () => {});
      run.stderr.on('data', (chunk) => { diagnostic = (diagnostic + chunk).slice(-4000); });
      run.on('message', (event) => {
        if (event.type === 'pilot-error') errors.push(event.message);
        if (event.type !== 'pilot-test' || event.status === 'skipped') return;
        events.push(event);
        if (event.status === 'failed' && detectedAtMs === null) detectedAtMs = performance.now() - started;
      });
      const timeout = setTimeout(() => run.kill(), 120000);
      const [exitCode, signal] = await once(run, 'close').finally(() => clearTimeout(timeout));
      const completedAtMs = performance.now() - started;
      const item = cases.find((item) => item.name === entry.case);
      const failed = events.filter((event) => event.status !== 'passed');
      const allowedDetectors = item.allowedDetectors ?? (item.detector ? [item.detector] : []);
      const fullPass = exitCode === 0 && !signal && events.length === titles.length && failed.length === 0;
      const expectedFailure = exitCode === 1 && !signal && failed.length === 1 &&
        allowedDetectors.includes(failed[0].title) && failed[0].status === 'failed' && events.at(-1) === failed[0];
      const valid = (expectedFailure || (fullPass && (study || allowedDetectors.length === 0))) &&
        events.every((event, index) => event.title === order[index]);
      const result = { ...entry, order, orderGenerationMs, timeToFirstFailureMs: detectedAtMs,
        fullSuiteWallMs: fullPass && valid ? completedAtMs : null,
        processWallMs: completedAtMs, detectorPosition: detectedAtMs === null ? null : events.findIndex((event) => event.status === 'failed') + 1,
        events, exitCode, signal, valid: valid && errors.length === 0, errors };
      summary.results.push(result);
      save();
      if (!result.valid) {
        fs.writeFileSync(path.join(output, 'diagnostic.txt'), diagnostic);
        throw new Error(`Invalid execution: ${entry.case}/${entry.method}/${entry.repetition}. See ${output}`);
      }
      console.log(`${entry.case} ${entry.repetition} ${entry.method}: ${Math.round(detectedAtMs ?? completedAtMs)} ms (${detectedAtMs === null ? 'full suite' : 'failure observed'})`);
    } finally {
      if (server.exitCode === null) { const closed = once(server, 'close'); server.kill(); await closed; }
    }
  }
  summary.completed = true;
} finally {
  if (fs.existsSync(specPath)) fs.unlinkSync(specPath);
  await connection?.end();
  // Retain the synthetic schema and artifacts for audit; never drop a database here.
  save();
}
console.log(path.join(output, 'summary.json'));
