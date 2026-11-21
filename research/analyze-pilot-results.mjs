import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const foodPath = path.join(root, 'work/pilot-faults-1793838879880/repeated-orders/summary.json');
const sigouPath = path.join(root, 'work/sigou-pilot/order-comparison.json');
const foodRows = JSON.parse(fs.readFileSync(foodPath, 'utf8')).results.map((row) => ({
  fault: row.fault, strategy: row.strategy === 'baseline' ? 'original' : row.strategy,
  repetition: row.repetition, ms: row.timeToFailureMs, position: row.detectorPosition
}));
const sigouRows = JSON.parse(fs.readFileSync(sigouPath, 'utf8')).rows.map((row) => ({
  fault: row.fault, strategy: row.strategy, repetition: row.repetition,
  ms: row.timeToFailureMs, position: row.detectorPosition
}));

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const percentile = (sorted, fraction) => sorted[Math.floor((sorted.length - 1) * fraction)];
function combinations(items, length) {
  if (length === 0) return [[]];
  return items.flatMap((item) => combinations(items, length - 1).map((tail) => [item, ...tail]));
}

function analyze(rows) {
  const faults = [...new Set(rows.map((row) => row.fault))];
  const strategies = ['original', 'prioritized', 'random'];
  const perFault = faults.map((fault) => {
    const selected = rows.filter((row) => row.fault === fault);
    for (const strategy of strategies) {
      const strategyRows = selected.filter((row) => row.strategy === strategy);
      if (strategyRows.length !== 3 || new Set(strategyRows.map((row) => row.repetition)).size !== 3) {
        throw new Error(`Expected three distinct repetitions for ${fault}/${strategy}`);
      }
    }
    return { fault, ...Object.fromEntries(strategies.map((strategy) => {
      const strategyRows = selected.filter((row) => row.strategy === strategy);
      return [strategy, { meanMs: mean(strategyRows.map((row) => row.ms)),
        meanPosition: mean(strategyRows.map((row) => row.position)) }];
    })) };
  });
  const overall = Object.fromEntries(strategies.map((strategy) => [strategy,
    { meanMs: mean(rows.filter((row) => row.strategy === strategy).map((row) => row.ms)),
      meanPosition: mean(rows.filter((row) => row.strategy === strategy).map((row) => row.position)) }]));
  const reduction = 1 - overall.prioritized.meanMs / overall.original.meanMs;
  const resamples = combinations(perFault, perFault.length).map((sample) =>
    1 - mean(sample.map((row) => row.prioritized.meanMs)) / mean(sample.map((row) => row.original.meanMs))
  ).sort((a, b) => a - b);
  return { faults: faults.length, runs: rows.length, perFault, overall, reduction,
    clusterBootstrapPercentile95: [percentile(resamples, 0.025), percentile(resamples, 0.975)],
    improvedFaults: perFault.filter((row) => row.prioritized.meanMs < row.original.meanMs).length };
}

const result = { foodRescue: { ...analyze(foodRows),
  method: 'Legacy oracle calibration: expected detector was explicitly placed first, not selected by the prototype. Do not attribute these gains to the prioritizer.' }, sigou: analyze(sigouRows),
  note: 'Food Rescue legacy data use an oracle order. SIGOU uses the prototype but excludes ranking overhead. Intervals describe selected controlled faults, not generalization to real-world faults.' };
console.warn(result.note);
const output = path.join(root, 'work/pilot-statistics.json');
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  foodRescue: { runs: result.foodRescue.runs, reduction: result.foodRescue.reduction,
    improvedFaults: result.foodRescue.improvedFaults, interval: result.foodRescue.clusterBootstrapPercentile95 },
  sigou: { runs: result.sigou.runs, reduction: result.sigou.reduction,
    improvedFaults: result.sigou.improvedFaults, interval: result.sigou.clusterBootstrapPercentile95 }
}, null, 2));
console.log(output);
