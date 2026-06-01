function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function buildFeatures(row, zoneStats) {
  const stats = zoneStats.get(row.zoneId);
  const flowDelta = (row.flowLps - stats.flowMean) / stats.flowStd;
  const pressureDelta = (stats.pressureMean - row.pressurePsi) / stats.pressureStd;
  const hourSignal = Math.sin((2 * Math.PI * row.hour) / 24);

  return [1, flowDelta, pressureDelta, flowDelta * pressureDelta, hourSignal];
}

export function computeZoneStats(readings) {
  const grouped = new Map();

  for (const row of readings) {
    if (!grouped.has(row.zoneId)) grouped.set(row.zoneId, []);
    grouped.get(row.zoneId).push(row);
  }

  const zoneStats = new Map();
  for (const [zoneId, rows] of grouped.entries()) {
    const flows = rows.map((r) => r.flowLps);
    const pressures = rows.map((r) => r.pressurePsi);
    const flowMean = flows.reduce((a, b) => a + b, 0) / flows.length;
    const pressureMean = pressures.reduce((a, b) => a + b, 0) / pressures.length;
    const flowStd = Math.max(1, std(flows, flowMean));
    const pressureStd = Math.max(0.5, std(pressures, pressureMean));

    zoneStats.set(zoneId, { flowMean, pressureMean, flowStd, pressureStd });
  }

  return zoneStats;
}

function std(values, mean) {
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / Math.max(1, values.length);
  return Math.sqrt(variance);
}

function trainTestSplit(rows, testRatio = 0.25) {
  const shuffled = [...rows].sort(() => Math.random() - 0.5);
  const splitIndex = Math.floor(shuffled.length * (1 - testRatio));
  return {
    train: shuffled.slice(0, splitIndex),
    test: shuffled.slice(splitIndex),
  };
}

function trainLogisticRegression(trainRows, zoneStats, epochs = 250, learningRate = 0.08) {
  const weights = [0, 0, 0, 0, 0];

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const row of trainRows) {
      const x = buildFeatures(row, zoneStats);
      const y = row.isLeak;
      const prediction = sigmoid(dot(weights, x));
      const error = prediction - y;

      for (let i = 0; i < weights.length; i += 1) {
        weights[i] -= learningRate * error * x[i];
      }
    }
  }

  return weights;
}

function dot(a, b) {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function predictLeakProbability(row, model, zoneStats) {
  if (!model) return ruleBasedProbability(row, zoneStats);
  const features = buildFeatures(row, zoneStats);
  return sigmoid(dot(model.weights, features));
}

function ruleBasedProbability(row, zoneStats) {
  const stats = zoneStats.get(row.zoneId);
  if (!stats) return 0.1;

  const flowScore = Math.max(0, (row.flowLps - stats.flowMean) / stats.flowStd);
  const pressureScore = Math.max(0, (stats.pressureMean - row.pressurePsi) / stats.pressureStd);
  const raw = 0.15 + flowScore * 0.35 + pressureScore * 0.4;
  return Math.min(0.99, raw / 2.2);
}

export function trainLeakModel(readings) {
  if (!readings.length) {
    return { model: null, accuracy: 0, zoneStats: new Map() };
  }

  const zoneStats = computeZoneStats(readings);
  const { train, test } = trainTestSplit(readings, 0.25);
  const weights = trainLogisticRegression(train, zoneStats);

  let correct = 0;
  for (const row of test) {
    const probability = predictLeakProbability(row, { weights }, zoneStats);
    const predicted = probability >= 0.5 ? 1 : 0;
    if (predicted === row.isLeak) correct += 1;
  }

  const accuracy = test.length ? correct / test.length : 0;
  return {
    model: { weights },
    accuracy,
    zoneStats,
  };
}

export function classifyRisk(probability) {
  if (probability >= 0.7) return "critical";
  if (probability >= 0.45) return "warning";
  return "normal";
}

export function evaluateReading(row, modelBundle, options = {}) {
  const zoneStats = modelBundle?.zoneStats ?? new Map();
  const stats = zoneStats.get(row.zoneId);
  const ruleHit = stats
    ? row.flowLps >= stats.flowMean * 1.15 && row.pressurePsi <= stats.pressureMean * 0.92
    : false;

  const rulesOnly = options.rulesOnly || !modelBundle?.model;
  const probability = rulesOnly
    ? ruleBasedProbability(row, zoneStats)
    : predictLeakProbability(row, modelBundle?.model, zoneStats);
  const risk = classifyRisk(probability);

  return {
    probability,
    risk,
    ruleHit,
    rulesOnly,
    label:
      risk === "critical"
        ? "Likely Leak"
        : risk === "warning"
          ? "Warning"
          : "Normal",
  };
}

export function buildWhyFlagged(row, modelBundle, evaluation) {
  const stats = modelBundle?.zoneStats?.get(row.zoneId);
  if (!stats) {
    return ["Insufficient baseline data for this zone."];
  }

  const flowPct = (((row.flowLps - stats.flowMean) / stats.flowMean) * 100).toFixed(1);
  const pressurePct = (((row.pressurePsi - stats.pressureMean) / stats.pressureMean) * 100).toFixed(1);

  const lines = [
    `Flow ${row.flowLps} L/s (${flowPct >= 0 ? "+" : ""}${flowPct}% vs zone baseline)`,
    `Pressure ${row.pressurePsi} psi (${pressurePct >= 0 ? "+" : ""}${pressurePct}% vs zone baseline)`,
    evaluation.ruleHit
      ? "Rule triggered: high flow AND low pressure together."
      : "Rule not triggered: pattern does not match leak signature.",
    evaluation.rulesOnly
      ? `Rules-only mode: estimated risk ${(evaluation.probability * 100).toFixed(1)}%.`
      : `ML model: leak probability ${(evaluation.probability * 100).toFixed(1)}%.`,
  ];
  return lines;
}

export function buildModelBundle(readings) {
  const trained = trainLeakModel(readings);
  return {
    model: trained.model,
    accuracy: trained.accuracy,
    zoneStats: trained.zoneStats,
  };
}
