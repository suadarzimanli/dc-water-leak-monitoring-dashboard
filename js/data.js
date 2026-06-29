import { PRESSURE_ZONES } from "./zones.js";
import {
  applyScenarioToReading,
  pickLiveScenario,
  pickWeather,
  SCENARIO_TYPES,
} from "./context.js";

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function generateScadaDataset({ days = 14, leakRate = 0.04, seed = 42 } = {}) {
  const rng = mulberry32(seed);
  const readings = [];
  const hours = days * 24;
  const start = new Date("2026-01-01T00:00:00");

  for (const zone of PRESSURE_ZONES) {
    for (let i = 0; i < hours; i += 1) {
      const timestamp = new Date(start.getTime() + i * 60 * 60 * 1000);
      const hour = timestamp.getHours();
      const scenarioType =
        rng() < leakRate ? SCENARIO_TYPES.LEAK : SCENARIO_TYPES.NORMAL;
      const applied = applyScenarioToReading(zone, scenarioType, hour, rng);

      readings.push({
        timestamp,
        zoneId: zone.id,
        zoneName: zone.name,
        hour,
        flowLps: applied.flowLps,
        pressurePsi: applied.pressurePsi,
        isLeak: applied.isLeak,
        scenarioType: applied.scenarioType,
      });
    }
  }

  return readings.sort((a, b) => a.timestamp - b.timestamp);
}

export function getLatestByZone(readings) {
  const latest = new Map();
  for (const row of readings) {
    latest.set(row.zoneId, row);
  }
  return latest;
}

export function getZoneHistory(readings, zoneId, maxPoints = 48) {
  const history = readings.filter((r) => r.zoneId === zoneId);
  return history.slice(-maxPoints);
}

export function simulateLiveTick(zone, previousRow, maintenanceEvents, weather, rng = Math.random) {
  const hour = new Date().getHours();
  const scenarioType = pickLiveScenario(zone, maintenanceEvents, rng);
  const applied = applyScenarioToReading(zone, scenarioType, hour, rng);

  return {
    timestamp: new Date(),
    zoneId: zone.id,
    zoneName: zone.name,
    hour,
    flowLps: applied.flowLps,
    pressurePsi: applied.pressurePsi,
    isLeak: applied.isLeak,
    scenarioType: applied.scenarioType,
    weatherId: weather.id,
    previousFlow: previousRow?.flowLps ?? zone.baseFlow,
    previousPressure: previousRow?.pressurePsi ?? zone.basePressure,
  };
}

export function createSimulationEnvironment(seed = 42) {
  const rng = mulberry32(seed);
  return {
    weather: pickWeather(rng),
  };
}

/** Inject a specific scenario type for a zone (leak, hydrant test, etc.). */
export function createScriptedReading(zone, scenarioType, weather) {
  const hour = new Date().getHours();
  const applied = applyScenarioToReading(zone, scenarioType, hour, () => 0.65);

  return {
    timestamp: new Date(),
    zoneId: zone.id,
    zoneName: zone.name,
    hour,
    flowLps: applied.flowLps,
    pressurePsi: applied.pressurePsi,
    isLeak: applied.isLeak,
    scenarioType: applied.scenarioType,
    weatherId: weather?.id ?? "clear",
  };
}
