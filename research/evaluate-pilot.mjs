import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn, spawnSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repeats = Number(process.argv[2] ?? 3);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 20) throw new Error('Repetitions must be 1..20');
const id = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const database = `food_rescue_eval_${id}`;
const output = path.join(root, 'work', `evaluation-${id}`);
fs.mkdirSync(output, { recursive: true });
const catalogPath = path.join(root, 'research/test-catalog.json');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const trackedFiles = ['research/test-catalog.json', 'research/prioritize-tests.mjs',
  'research/pilot-order.mjs', 'research/pilot-reporter.cjs', 'research/evaluate-pilot.mjs',
  'e2e/prioritization-pilot.spec.js', 'playwright.config.js', 'package-lock.json'];
const frozen = Object.fromEntries(trackedFiles.map((file) => [file, hash(path.join(root, file))]));
const source = fs.readFileSync(path.join(root, 'e2e/prioritization-pilot.spec.js'), 'utf8');
const blocks = source.split(/(?=^test\('piloto )/m);
const header = blocks.shift();
const tests = blocks.map((block) => ({ title: block.match(/^test\('([^']+)'/)?.[1], block }));
const titles = JSON.parse(fs.readFileSync(catalogPath, 'utf8')).tests.map((test) => test.title);
if (tests.length !== 5 || titles.some((title, i) => title !== tests[i]?.title)) throw new Error('Catalog and test source disagree');

// Expected detectors are validation assertions AFTER execution, never ranking inputs.
const cases = [
  { name: 'no_fault' },
  { name: 'auth_permission', file: 'app.js', from: "app.get('/api/v1/admin/metricas', authenticate, authorize('admin'),", to: "app.get('/api/v1/admin/metricas', authenticate, authorize('admin', 'doador'),", detector: titles[0] },
  { name: 'establishment_listing', file: 'establishments.js', from: 'FROM estabelecimentos WHERE usuario_responsavel_id=? ORDER BY criado_em DESC', to: 'FROM estabelecimentos WHERE usuario_responsavel_id=0 AND ? IS NOT NULL ORDER BY criado_em DESC', detector: titles[1] },
  { name: 'lot_visibility', file: 'lots.js', from: "WHERE l.status='disponivel' AND l.validade_em>UTC_TIMESTAMP(3) AND e.ativo=1", to: "WHERE l.status='reservado' AND l.validade_em>UTC_TIMESTAMP(3) AND e.ativo=1", detector: titles[2] },
  { name: 'reservation_response', file: 'rescues.js', from: "await db.commit(); return { id: requestId, status: 'reservada' };", to: "await db.commit(); return { id: requestId, status: 'solicitada' };", detector: titles[3] },
  { name: 'receipt_content', file: 'app.js', from: "res.type('application/pdf').sendFile(receiptPath(code));", to: "res.type('application/pdf').send('invalid pdf');", detector: titles[4] }
];
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
    const seed = 20261104 + index * 100 + repetition;
    for (const method of shuffle(['original', 'shortest', 'random', 'prioritized'], seed)) {
      schedule.push({ case: item.name, method, repetition, seed });
    }
  }
}
const summary = { version: 2, purpose: 'Protocol calibration on previously used controlled cases; not independent effectiveness evaluation',
  database, node: process.version, platform: process.platform, frozen, repeats,
  metric: 'Parent monotonic elapsed time from order generation start to first failed-test IPC event reception; includes order CLI, spec preparation and test-runner startup. Application startup and database reset excluded equally.',
  schedule, results: [] };
const save = () => fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
save();

// A new schema is created exclusively for this invocation. Never reuse or reset
// an existing schema. Reset can touch only the connection to the newly created one.
let connection;
let owned = false;
const specPath = path.join(root, 'e2e', `pilot-eval-${id}.spec.js`);
try {
  connection = await mysql.createConnection({ host: env.DB_HOST, port: env.DB_PORT,
    user: env.DB_USER, password: env.DB_PASSWORD, multipleStatements: true });
  const [existing] = await connection.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [database]);
  if (existing.length || database === env.DB_NAME) throw new Error('Refusing existing or configured database');
  await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  owned = true;
  await connection.query(`USE \`${database}\``);
  for (const file of ['database/schema.sql', 'database/migrations/002_outbox_eventos.sql', 'database/migrations/003_auth_sessions.sql']) {
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
      const valid = item.detector
        ? exitCode === 1 && !signal && failed.length === 1 && failed[0].title === item.detector && failed[0].status === 'failed' && events.at(-1)?.title === item.detector
        : exitCode === 0 && events.length === titles.length && failed.length === 0;
      const result = { ...entry, order, orderGenerationMs, timeToFirstFailureMs: detectedAtMs,
        fullSuiteWallMs: !item.detector && valid ? completedAtMs : null,
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
