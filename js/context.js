export const SCENARIO_TYPES = {
  NORMAL: "normal",
  LEAK: "leak",
  HYDRANT_TEST: "hydrant_test",
  VALVE_WORK: "valve_work",
  SENSOR_DRIFT: "sensor_drift",
  HEAVY_RAIN: "heavy_rain",
};

export const WEATHER_CONDITIONS = [
  { id: "clear", label: "Clear", impact: "Normal baseline" },
  { id: "rain", label: "Heavy rain", impact: "Possible infiltration — flow may rise without pipe break" },
  { id: "heat", label: "Heat wave", impact: "Peak demand — daytime usage spikes expected" },
  { id: "cold", label: "Cold snap", impact: "Risk of main stress — monitor low temps overnight" },
];

export function getTimeContext(hour) {
  if (hour >= 0 && hour < 6) {
    return {
      label: "Night (low demand)",
      detail: "Overnight readings should be stable. Unusual spikes may indicate a leak.",
    };
  }
  if (hour >= 6 && hour < 9) {
    return {
      label: "Morning ramp-up",
      detail: "Demand rising as businesses and schools open.",
    };
  }
  if (hour >= 9 && hour < 17) {
    return {
      label: "Daytime peak",
      detail: "Higher flow is normal. Compare against zone baseline, not absolute thresholds.",
    };
  }
  if (hour >= 17 && hour < 22) {
    return {
      label: "Evening demand",
      detail: "Residential usage increases — context matters for alert review.",
    };
  }
  return {
    label: "Late evening",
    detail: "Flow should taper off. Sustained high flow is worth investigating.",
  };
}

export function pickWeather(rng = Math.random) {
  const index = Math.floor(rng() * WEATHER_CONDITIONS.length);
  return WEATHER_CONDITIONS[index];
}

export function createMaintenanceSchedule(rng = Math.random) {
  const events = [
    {
      zoneId: "Zone-04",
      type: "valve_work",
      title: "Scheduled valve maintenance",
      window: "Today 2:00 PM – 4:00 PM",
      note: "Crew opening isolation valve — expect temporary flow/pressure changes.",
    },
    {
      zoneId: "Zone-07",
      type: "hydrant_test",
      title: "Fire hydrant flow test",
      window: "Today 10:00 AM – 11:30 AM",
      note: "Annual hydrant test — high flow expected, not a distribution leak.",
    },
    {
      zoneId: "Zone-02",
      type: "construction",
      title: "Street construction nearby",
      window: "This week",
      note: "Vibration and temporary pressure changes possible.",
    },
  ];

  if (rng() > 0.5) {
    events.push({
      zoneId: "Zone-05",
      type: "sensor_calibration",
      title: "Sensor calibration visit",
      window: "Tomorrow AM",
      note: "Field team recalibrating pressure transmitter.",
    });
  }

  return events;
}

export function getMaintenanceForZone(zoneId, maintenanceEvents) {
  return maintenanceEvents.filter((event) => event.zoneId === zoneId);
}

export function describeScenario(scenarioType) {
  switch (scenarioType) {
    case SCENARIO_TYPES.LEAK:
      return {
        title: "Possible pipe leak",
        operatorHint: "High flow with sustained pressure drop — field verification recommended.",
        isFalsePositive: false,
      };
    case SCENARIO_TYPES.HYDRANT_TEST:
      return {
        title: "Likely hydrant test (false positive risk)",
        operatorHint: "High flow but maintenance context explains it — confirm before dispatch.",
        isFalsePositive: true,
      };
    case SCENARIO_TYPES.VALVE_WORK:
      return {
        title: "Planned valve operation",
        operatorHint: "Scheduled maintenance may mimic leak signatures temporarily.",
        isFalsePositive: true,
      };
    case SCENARIO_TYPES.SENSOR_DRIFT:
      return {
        title: "Possible sensor drift",
        operatorHint: "Readings inconsistent with neighbors — data quality issue, not necessarily a leak.",
        isFalsePositive: true,
      };
    case SCENARIO_TYPES.HEAVY_RAIN:
      return {
        title: "Weather-related anomaly",
        operatorHint: "Rain can increase flow via infiltration — correlate with weather feed.",
        isFalsePositive: true,
      };
    default:
      return {
        title: "Normal operations",
        operatorHint: "No special context — standard monitoring.",
        isFalsePositive: false,
      };
  }
}

export function pickLiveScenario(zone, maintenanceEvents, rng = Math.random) {
  const roll = rng();
  const zoneMaintenance = getMaintenanceForZone(zone.id, maintenanceEvents);

  if (zoneMaintenance.some((e) => e.type === "hydrant_test") && roll < 0.12) {
    return SCENARIO_TYPES.HYDRANT_TEST;
  }
  if (zoneMaintenance.some((e) => e.type === "valve_work") && roll < 0.12) {
    return SCENARIO_TYPES.VALVE_WORK;
  }
  if (roll < 0.03) return SCENARIO_TYPES.LEAK;
  if (roll < 0.05) return SCENARIO_TYPES.HYDRANT_TEST;
  if (roll < 0.07) return SCENARIO_TYPES.VALVE_WORK;
  if (roll < 0.085) return SCENARIO_TYPES.SENSOR_DRIFT;
  if (roll < 0.11) return SCENARIO_TYPES.HEAVY_RAIN;
  return SCENARIO_TYPES.NORMAL;
}

export function applyScenarioToReading(zone, scenarioType, hour, rng = Math.random) {
  const dailyPattern = 1 + 0.12 * Math.sin((2 * Math.PI * hour) / 24);
  let flow = zone.baseFlow * dailyPattern + (rng() - 0.5) * 10;
  let pressure = zone.basePressure - 0.06 * flow + (rng() - 0.5) * 2.5;
  let isLeak = 0;

  switch (scenarioType) {
    case SCENARIO_TYPES.LEAK:
      flow += 22 + rng() * 28;
      pressure -= 9 + rng() * 9;
      isLeak = 1;
      break;
    case SCENARIO_TYPES.HYDRANT_TEST:
      flow += 35 + rng() * 40;
      pressure -= 3 + rng() * 4;
      break;
    case SCENARIO_TYPES.VALVE_WORK:
      flow += 15 + rng() * 20;
      pressure -= 5 + rng() * 6;
      break;
    case SCENARIO_TYPES.SENSOR_DRIFT:
      flow += (rng() - 0.5) * 35;
      pressure += (rng() - 0.5) * 12;
      break;
    case SCENARIO_TYPES.HEAVY_RAIN:
      flow += 12 + rng() * 18;
      pressure -= 2 + rng() * 4;
      break;
    default:
      break;
  }

  return {
    flowLps: Math.max(1, Number(flow.toFixed(3))),
    pressurePsi: Math.max(5, Number(pressure.toFixed(3))),
    isLeak,
    scenarioType,
  };
}
