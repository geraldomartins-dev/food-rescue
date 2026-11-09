import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length !== 3) throw new Error('Usage: node research/summarize-study.mjs path/to/summary.json');
const input = path.resolve(process.argv[2]);
const inputBytes = fs.readFileSync(input);
const data = JSON.parse(inputBytes);
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const lockBytes = fs.readFileSync(path.join(root, 'research/study-lock.json'));
const lock = JSON.parse(lockBytes);
const study = JSON.parse(fs.readFileSync(path.join(root, 'research/study-cases.json')));
const methods = {
  original: 'Habitual',
  shortest: 'Menor duração',
  random: 'Aleatória',
  prioritized: 'Protótipo'
};
const labels = {
  pickup_window_as_visibility: 'Janela de retirada',
  owner_check_inverted: 'Responsável pela reserva',
  lot_created_expired: 'Validade no cadastro',
  receipt_requires_reserved_status: 'Estado do comprovante',
  establishment_sort_tiebreak: 'Desempate na listagem',
  lot_response_refactor: 'Resposta do cadastro do lote'
};
const mapping = {
  pickup_window_as_visibility: 'Mapeado',
  owner_check_inverted: 'Mapeado',
  lot_created_expired: 'Sem mapeamento explícito',
  receipt_requires_reserved_status: 'Sem mapeamento explícito',
  establishment_sort_tiebreak: 'Mapeado',
  lot_response_refactor: 'Sem mapeamento explícito'
};
const expectedCount = study.cases.length * study.repeats * Object.keys(methods).length;
if (!data.completed || data.protocolId !== study.id || data.protocolLockSha256 !== digest(lockBytes) ||
    data.repeats !== study.repeats || data.results.length !== expectedCount || data.schedule.length !== expectedCount ||
    Object.keys(data.frozen).length !== Object.keys(lock.files).length ||
    Object.entries(lock.files).some(([file, hash]) => data.frozen[file] !== hash)) {
  throw new Error('The run is incomplete or does not match the frozen protocol');
}
const cases = study.cases;
const key = ({ case: scenario, method, repetition }) => `${scenario}/${method}/${repetition}`;
const rows = new Map(data.results.map((row) => [key(row), row]));
if (rows.size !== expectedCount || data.schedule.some((entry, i) =>
  key(entry) !== key(data.results[i]) || entry.seed !== data.results[i].seed)) {
  throw new Error('Results are missing, duplicated, or out of schedule order');
}
const tests = JSON.parse(fs.readFileSync(path.join(root, 'research/test-catalog.json'))).tests;
const byCase = new Map();
for (const [index, scenario] of cases.entries()) {
  const byMethod = new Map();
  byCase.set(scenario.name, byMethod);
  const allowedDetectors = scenario.detectors.map((i) => tests[i].title);
  for (const method of Object.keys(methods)) {
    const observations = [];
    byMethod.set(method, observations);
    for (let repetition = 1; repetition <= study.repeats; repetition++) {
      const row = rows.get(key({ case: scenario.name, method, repetition }));
      if (!row?.valid || row.seed !== study.seed + index * 100 + repetition ||
          !Number.isFinite(row.orderGenerationMs) || row.orderGenerationMs < 0 ||
          row.events.some((event, i) => event.title !== row.order[i])) throw new Error('Invalid execution record');
      const detected = row.timeToFirstFailureMs !== null;
      if (detected) {
        if (!Number.isFinite(row.timeToFirstFailureMs) || row.timeToFirstFailureMs < row.orderGenerationMs ||
            row.fullSuiteWallMs !== null || row.detectorPosition !== row.events.length ||
            row.events.at(-1).status !== 'failed' || !allowedDetectors.includes(row.events.at(-1).title)) {
          throw new Error('Inconsistent failure record');
        }
      } else if (!Number.isFinite(row.fullSuiteWallMs) || row.fullSuiteWallMs < row.orderGenerationMs ||
          row.detectorPosition !== null || row.events.length !== tests.length ||
          row.events.some((event) => event.status !== 'passed')) {
        throw new Error('Inconsistent complete suite record');
      }
      observations.push(row);
    }
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const seconds = (ms) => ms === null ? '—' : (ms / 1000).toFixed(3).replace('.', ',');
const sequence = (values, format = (value) => value ?? '—') => values.map(format).join(' / ');
const defects = cases.filter((scenario) => scenario.detectors.length);
const sameOrder = (a, b) => a.order.every((title, i) => b.order[i] === title);
const lines = [
  '# Avaliação controlada do Food Rescue',
  '',
  `Protocolo \`${study.id}\`. Foram verificadas **${data.results.length} execuções** em seis alterações controladas. Cada método foi executado três vezes por alteração, com o custo de ordenação incluído na medição.`,
  '',
  '## Detecção por alteração',
  '',
  'Cada sequência segue as repetições 1, 2 e 3. O traço indica ausência de detecção naquela execução. Os tempos estão em segundos e incluem a preparação da ordem e a inicialização do executor.',
  '',
  '| Alteração | Método | Detecções | Posições do detector | Tempos até a falha | Mediana do custo de ordenar |',
  '|---|---|---:|---:|---:|---:|'
];
for (const scenario of defects) {
  for (const [method, label] of Object.entries(methods)) {
    const observations = byCase.get(scenario.name).get(method);
    const detected = observations.filter((row) => row.timeToFirstFailureMs !== null).length;
    lines.push(`| ${labels[scenario.name]} | ${label} | ${detected}/${study.repeats} | ${sequence(observations.map((row) => row.detectorPosition))} | ${sequence(observations.map((row) => row.timeToFirstFailureMs), seconds)} | ${seconds(median(observations.map((row) => row.orderGenerationMs)))} |`);
  }
}
lines.push('', '## Diferenças pareadas de tempo', '',
  'Cada diferença é o tempo da referência menos o tempo do protótipo na mesma repetição. Um valor positivo indica que o protótipo detectou a falha mais cedo. Entram apenas os pares com detecção nas duas execuções.',
  '', '| Alteração | Referência | Pares | Mediana em segundos | Faixa em segundos |',
  '|---|---|---:|---:|---:|');
const comparisons = [];
for (const scenario of defects) {
  const observations = byCase.get(scenario.name);
  const prototype = observations.get('prioritized');
  for (const method of ['original', 'shortest', 'random']) {
    const reference = observations.get(method);
    const pairs = reference.map((row, i) => [row, prototype[i]])
      .filter(([a, b]) => a.timeToFirstFailureMs !== null && b.timeToFirstFailureMs !== null);
    const differences = pairs.map(([a, b]) => a.timeToFirstFailureMs - b.timeToFirstFailureMs);
    const center = differences.length ? median(differences) : null;
    const range = differences.length ? `${seconds(Math.min(...differences))} a ${seconds(Math.max(...differences))}` : '—';
    comparisons.push({ case: scenario.name, method, center, pairs });
    lines.push(`| ${labels[scenario.name]} | ${methods[method]} | ${pairs.length} | ${seconds(center)} | ${range} |`);
  }
}

lines.push('', '## Execuções com a suíte completa', '',
  'O tempo completo vai da preparação da ordem ao encerramento do executor. A tabela inclui as alterações sem defeito esperado e qualquer execução em que a suíte passou diante de um defeito introduzido.',
  '', '| Alteração | Método | Suítes completas | Tempos em segundos | Mediana do custo de ordenar |',
  '|---|---|---:|---:|---:|');
for (const scenario of cases) {
  for (const [method, label] of Object.entries(methods)) {
    const passed = byCase.get(scenario.name).get(method).filter((row) => row.fullSuiteWallMs !== null);
    if (passed.length) {
      lines.push(`| ${labels[scenario.name]} | ${label} | ${passed.length}/${study.repeats} | ${sequence(passed.map((row) => row.fullSuiteWallMs), seconds)} | ${seconds(median(passed.map((row) => row.orderGenerationMs)))} |`);
    }
  }
}
const absent = data.results.filter((row) => row.fullSuiteWallMs !== null && defects.some((scenario) => scenario.name === row.case));
lines.push('', absent.length
  ? `Houve ${absent.length} execuções sem detecção de um defeito introduzido. Os registros acima preservam o tempo de suíte completa nesses casos.`
  : 'Todos os defeitos introduzidos foram detectados nas execuções previstas.');

lines.push('', '## Posição do detector e tempo medido', '',
  '| Alteração | Mapeamento | Posições habitual | Posições protótipo | Ordens idênticas | Mediana da diferença contra a habitual em segundos |',
  '|---|---|---:|---:|---:|---:|');
for (const scenario of defects) {
  const observations = byCase.get(scenario.name);
  const original = observations.get('original');
  const prototype = observations.get('prioritized');
  const identical = original.filter((row, i) => sameOrder(row, prototype[i])).length;
  const paired = comparisons.find((row) => row.case === scenario.name && row.method === 'original');
  lines.push(`| ${labels[scenario.name]} | ${mapping[scenario.name]} | ${sequence(original.map((row) => row.detectorPosition))} | ${sequence(prototype.map((row) => row.detectorPosition))} | ${identical}/${study.repeats} | ${seconds(paired.center)} |`);
}
const habitualPairs = comparisons.filter((row) => row.method === 'original').flatMap((row) => row.pairs);
const earlier = habitualPairs.filter(([a, b]) => b.detectorPosition < a.detectorPosition);
const earlierButSlower = earlier.filter(([a, b]) => b.timeToFirstFailureMs > a.timeToFirstFailureMs);
const slowerCases = comparisons.filter((row) => row.method === 'original' && row.center < 0);
lines.splice(4, 0, `O protótipo teve mediana de tempo pareado maior que a ordem habitual em ${slowerCases.length} dos ${defects.length} casos com defeito introduzido. A tabela de posições mostra em quais casos houve avanço do detector mesmo com aumento do tempo medido.`, '');
lines.push('', `Em ${earlier.length} dos ${habitualPairs.length} pares com detecção frente à ordem habitual, o protótipo colocou o detector em uma posição anterior. Em ${earlierButSlower.length} desses pares, o tempo medido aumentou. Quando as ordens são idênticas, diferenças de tempo refletem preparação e variação de execução.`,
  '', 'Os casos são mudanças controladas escolhidas com conhecimento da aplicação e da suíte. As três repetições descrevem a variação de cada mudança. Os dados servem para examinar quando a posição e o custo de ordenar afetam a detecção neste conjunto.');
for (const scenario of cases) {
  const random = byCase.get(scenario.name).get('random');
  const distinct = new Set(random.map((row) => JSON.stringify(row.order))).size;
  if (distinct < random.length) lines.push('', `Em ${labels[scenario.name]}, as ${random.length} sementes produziram ${distinct} ordens aleatórias distintas. Todas as execuções previstas foram mantidas na análise.`);
}
lines.push('', '## Rastreabilidade', '',
  `- Ambiente Windows com Node \`${data.node}\` e banco \`${data.databaseVersion}\`.`,
  `- Referência do código \`${data.baselineCommit}\`.`,
  `- Registro bruto \`${path.relative(root, input).split(path.sep).join('/')}\`.`,
  `- SHA-256 do registro bruto \`${digest(inputBytes)}\`.`,
  `- SHA-256 do conjunto congelado \`${data.protocolLockSha256}\`.`,
  '- [Protocolo e critérios de análise](protocolo_avaliacao_food_rescue.md).',
  '');
const target = path.join(root, 'outputs/resultado_avaliacao_food_rescue.md');
fs.writeFileSync(target, lines.join('\n'));
console.log(target);
