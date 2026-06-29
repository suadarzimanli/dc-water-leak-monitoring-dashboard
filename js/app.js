import { PRESSURE_ZONES } from "./zones.js";
import { getChartTheme, getThemeLabel, initTheme, THEMES, toggleTheme } from "./theme.js";
import { buildUserGuide } from "./user-guide.js";
import { APP_PHASE, DETECTION_MODE, SIMULATION_MS } from "./config.js";
import {
  createMaintenanceSchedule,
  describeScenario,
  getMaintenanceForZone,
  getTimeContext,
  SCENARIO_TYPES,
  WEATHER_CONDITIONS,
} from "./context.js";
import {
  createScriptedReading,
  createSimulationEnvironment,
  generateScadaDataset,
  getLatestByZone,
  getZoneHistory,
  simulateLiveTick,
} from "./data.js";
import {
  buildModelBundle,
  buildWhyFlagged,
  computeZoneStats,
  evaluateReading,
} from "./ml.js";
import { createZoneMap } from "./map.js";
import { renderZoneChart } from "./charts.js";
import {
  acknowledgeAlert,
  closeAsFalseAlarm,
  closeAsLeak,
  createAlertRecord,
  createTicket,
  dispatchCrew,
  getOpenIncidents,
  getWorkflowActions,
  isWorkflowClosed,
  WORKFLOW_LABELS,
  WORKFLOW_STATUS,
} from "./workflow.js";

const state = {
  appPhase: APP_PHASE.IDLE,
  readings: [],
  modelBundle: null,
  latestByZone: new Map(),
  selectedZoneId: null,
  selectedAlertId: null,
  simulationTimer: null,
  simulationSpeed: "normal",
  detectionMode: DETECTION_MODE.ML,
  alerts: [],
  maintenanceEvents: [],
  weather: WEATHER_CONDITIONS[0],
  activeSideTab: "zone",
  theme: THEMES.DARK,
  contextTabViewed: false,
  zoneInspectDone: false,
  guideSimStarted: false,
  guideResetDone: false,
};

const ui = {
  btnGenerate: document.getElementById("btn-generate"),
  btnTrain: document.getElementById("btn-train"),
  btnSimulate: document.getElementById("btn-simulate"),
  btnReset: document.getElementById("btn-reset"),
  btnGuided: document.getElementById("btn-guided"),
  btnHelp: document.getElementById("btn-help"),
  btnTheme: document.getElementById("btn-theme"),
  btnGuideStart: document.getElementById("btn-guide-start"),
  btnGuideStop: document.getElementById("btn-guide-stop"),
  btnGuideRun: document.getElementById("btn-guide-run"),
  btnGuideSkip: document.getElementById("btn-guide-skip"),
  guideIdle: document.getElementById("guide-idle"),
  guideBody: document.getElementById("guide-body"),
  guideSteps: document.getElementById("guide-steps"),
  guideProgress: document.getElementById("guide-progress"),
  guideStepTitle: document.getElementById("guide-step-title"),
  guideStepDuration: document.getElementById("guide-step-duration"),
  guideLearn: document.getElementById("guide-learn"),
  guideYouWillSee: document.getElementById("guide-you-will-see"),
  btnClearAlerts: document.getElementById("btn-clear-alerts"),
  detectionMode: document.getElementById("detection-mode"),
  simSpeed: document.getElementById("sim-speed"),
  helpModal: document.getElementById("help-modal"),
  metricZones: document.getElementById("metric-zones"),
  metricAtRisk: document.getElementById("metric-at-risk"),
  metricPending: document.getElementById("metric-pending"),
  metricCloseout: document.getElementById("metric-closeout"),
  metricTickets: document.getElementById("metric-tickets"),
  metricAccuracy: document.getElementById("metric-accuracy"),
  mapStatus: document.getElementById("map-status"),
  mapSummary: document.getElementById("map-summary"),
  zoneTitle: document.getElementById("zone-title"),
  zoneStatus: document.getElementById("zone-status"),
  zoneDetails: document.getElementById("zone-details"),
  zoneContext: document.getElementById("zone-context"),
  whyFlagged: document.getElementById("why-flagged"),
  workflowSection: document.getElementById("workflow-section"),
  workflowPanel: document.getElementById("workflow-panel"),
  actionPlaceholder: document.getElementById("action-placeholder"),
  alertListActive: document.getElementById("alert-list-active"),
  alertListCloseout: document.getElementById("alert-list-closeout"),
  activityLog: document.getElementById("activity-log"),
  maintenanceList: document.getElementById("maintenance-list"),
  zoneChart: document.getElementById("zone-chart"),
};

const mapApi = createZoneMap("map", (zoneId) => {
  selectZone(zoneId);
});

function formatTime(date) {
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function badgeClass(risk) {
  if (risk === "critical") return "badge-critical";
  if (risk === "warning") return "badge-warning";
  return "badge-normal";
}

function priorityLabel(priority) {
  return priority === "high" ? "High priority" : "Standard";
}

function usesRulesOnly() {
  return state.detectionMode === DETECTION_MODE.RULES || !state.modelBundle?.model;
}

function getZoneEvaluation(zoneId) {
  const latest = state.latestByZone.get(zoneId);
  if (!latest) {
    return { risk: "normal", label: "Normal", probability: 0, ruleHit: false, rulesOnly: true };
  }
  return evaluateReading(latest, state.modelBundle, { rulesOnly: usesRulesOnly() });
}

function isIncidentOnMap(incident) {
  return getZoneEvaluation(incident.zoneId).risk !== "normal";
}

function classifyOpenIncidents() {
  const open = getOpenIncidents(state.alerts);
  const activeOnMap = [];
  const awaitingCloseout = [];
  for (const incident of open) {
    if (isIncidentOnMap(incident)) activeOnMap.push(incident);
    else awaitingCloseout.push(incident);
  }
  return { activeOnMap, awaitingCloseout, open };
}

function countZonesAtRisk() {
  return PRESSURE_ZONES.filter((zone) => getZoneEvaluation(zone.id).risk !== "normal").length;
}

function getActivityLogs() {
  return state.alerts.filter((alert) => alert.kind === "system");
}

function getSelectedAlert() {
  return state.alerts.find((alert) => alert.id === state.selectedAlertId) ?? null;
}

function setAppPhase(phase) {
  state.appPhase = phase;
  updateButtonStates();
}

function updateButtonStates() {
  const hasData = state.readings.length > 0;
  const hasModel = Boolean(state.modelBundle?.model);
  const isLive = Boolean(state.simulationTimer);

  ui.btnTrain.disabled = !hasData;
  ui.btnSimulate.disabled = !hasData;
  ui.btnGenerate.disabled = isLive;

  if (isLive) {
    ui.mapStatus.textContent = "Live";
    ui.mapStatus.className = "badge badge-warning";
  } else if (hasModel) {
    ui.mapStatus.textContent = "Model Ready";
    ui.mapStatus.className = "badge badge-normal";
  } else if (hasData) {
    ui.mapStatus.textContent = "Data Loaded";
    ui.mapStatus.className = "badge badge-normal";
  } else {
    ui.mapStatus.textContent = "Ready";
    ui.mapStatus.className = "badge badge-neutral";
  }
}

function selectZone(zoneId) {
  state.selectedZoneId = zoneId;
  const openIncident = getOpenIncidents(state.alerts).find((a) => a.zoneId === zoneId);
  state.selectedAlertId = openIncident?.id ?? null;
  mapApi.focusZone(zoneId);
  renderAll();
}

function selectIncident(alertId) {
  const alert = state.alerts.find((a) => a.id === alertId);
  if (!alert || alert.kind !== "incident") return;
  state.selectedAlertId = alert.id;
  state.selectedZoneId = alert.zoneId;
  setActiveSideTab("action");
  mapApi.focusZone(alert.zoneId);
  renderAll();
}

function setActiveSideTab(tabId) {
  state.activeSideTab = tabId;
  if (tabId === "context") state.contextTabViewed = true;
  document.querySelectorAll(".side-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabId}`);
  });
}

function updateMetrics() {
  const atRisk = countZonesAtRisk();
  const { open, awaitingCloseout } = classifyOpenIncidents();

  ui.metricZones.textContent = String(PRESSURE_ZONES.length);
  ui.metricAtRisk.textContent = String(atRisk);
  ui.metricPending.textContent = String(open.length);
  ui.metricCloseout.textContent = String(awaitingCloseout.length);
  ui.metricTickets.textContent = String(
    state.alerts.filter((alert) => alert.ticketId).length
  );
  ui.metricAccuracy.textContent =
    state.detectionMode === DETECTION_MODE.RULES
      ? "Rules"
      : state.modelBundle?.model
        ? `${(state.modelBundle.accuracy * 100).toFixed(1)}%`
        : "—";

  if (ui.mapSummary) {
    if (!state.readings.length) {
      ui.mapSummary.textContent =
        "Click Generate Data to load 14 days of synthetic SCADA for 8 pressure zones.";
    } else if (atRisk === 0) {
      ui.mapSummary.textContent = "All zones normal on latest readings.";
    } else {
      ui.mapSummary.textContent = `${atRisk} zone(s) flagged on the map — select a marker to investigate.`;
    }
  }
}

function pushSystemLog(message, risk = "normal") {
  const entry = createAlertRecord({
    kind: "system",
    zoneId: "SYSTEM",
    message,
    risk,
    scenarioType: "normal",
    contextSummary: "",
    suggestedCause: "",
    isFalsePositive: false,
  });
  state.alerts.unshift(entry);
  state.alerts = state.alerts.slice(0, 50);
  renderActivityLog();
  updateMetrics();
}

function detectionLabel(evaluation) {
  const mode = evaluation.rulesOnly ? "Rules" : "ML";
  return `${evaluation.label} — ${mode} ${(evaluation.probability * 100).toFixed(1)}%`;
}

function reconcileIncidents() {
  for (const incident of getOpenIncidents(state.alerts)) {
    const evaluation = getZoneEvaluation(incident.zoneId);
    incident.risk = evaluation.risk;

    const latest = state.latestByZone.get(incident.zoneId);
    const zone = PRESSURE_ZONES.find((z) => z.id === incident.zoneId);
    if (!latest || !zone) continue;

    const context = buildContextSummary(zone, latest);
    const scenario = describeScenario(latest.scenarioType ?? "normal");
    incident.message = detectionLabel(evaluation);
    incident.contextSummary = `${context.time.label} · ${context.weather.label} · ${scenario.title}`;
    incident.isFalsePositive = scenario.isFalsePositive;
  }
}

function upsertIncident(zone, latest, evaluation) {
  if (evaluation.risk === "normal") return null;

  let incident = getOpenIncidents(state.alerts).find((a) => a.zoneId === zone.id);
  const context = buildContextSummary(zone, latest);
  const scenario = describeScenario(latest.scenarioType ?? "normal");

  if (incident) {
    incident.risk = evaluation.risk;
    incident.message = detectionLabel(evaluation);
    incident.contextSummary = `${context.time.label} · ${context.weather.label} · ${scenario.title}`;
    incident.isFalsePositive = scenario.isFalsePositive;
    return incident;
  }

  const incidentRecord = createAlertRecord({
    kind: "incident",
    zoneId: zone.id,
    message: detectionLabel(evaluation),
    risk: evaluation.risk,
    scenarioType: latest.scenarioType,
    contextSummary: `${context.time.label} · ${context.weather.label} · ${scenario.title}`,
    suggestedCause: scenario.title,
    isFalsePositive: scenario.isFalsePositive,
  });
  state.alerts.unshift(incidentRecord);
  return incidentRecord;
}

function renderMaintenanceList() {
  if (!state.maintenanceEvents.length) {
    ui.maintenanceList.innerHTML =
      '<li class="context-empty">No scheduled maintenance loaded.</li>';
    return;
  }

  ui.maintenanceList.innerHTML = state.maintenanceEvents
    .map(
      (event) => `
      <li>
        <strong>${event.zoneId}</strong> — ${event.title}
        <div class="context-sub">${event.window}</div>
        <div class="context-sub">${event.note}</div>
      </li>
    `
    )
    .join("");
}

function renderActivityLog() {
  const logs = getActivityLogs().slice(0, 8);
  if (!logs.length) {
    ui.activityLog.innerHTML = '<li class="alert-empty">System messages appear here.</li>';
    return;
  }
  ui.activityLog.innerHTML = logs
    .map(
      (log) => `
      <li>
        <div>${log.message}</div>
        <div class="alert-time">${formatTime(log.time)}</div>
      </li>
    `
    )
    .join("");
}

function renderIncidentList(container, incidents, emptyMessage) {
  if (!incidents.length) {
    container.innerHTML = `<li class="alert-empty">${emptyMessage}</li>`;
    return;
  }

  container.innerHTML = "";
  for (const alert of incidents) {
    const li = document.createElement("li");
    li.className = [
      alert.risk,
      alert.isFalsePositive ? "false-positive-risk" : "",
      alert.id === state.selectedAlertId ? "selected" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const fpTag = alert.isFalsePositive
      ? '<span class="tag tag-warning">Check context</span>'
      : "";

    li.innerHTML = `
      <div><strong>${alert.zoneId}</strong> — ${alert.message} ${fpTag}</div>
      <div class="alert-context">${alert.contextSummary ?? ""}</div>
      <div class="alert-time">${formatTime(alert.time)} · ${WORKFLOW_LABELS[alert.workflowStatus]}</div>
    `;
    li.addEventListener("click", () => selectIncident(alert.id));
    container.appendChild(li);
  }
}

function renderAlerts() {
  const { activeOnMap, awaitingCloseout } = classifyOpenIncidents();
  renderIncidentList(
    ui.alertListActive,
    activeOnMap,
    "No zones flagged on the map right now."
  );
  renderIncidentList(
    ui.alertListCloseout,
    awaitingCloseout,
    "No incidents waiting for close-out."
  );
}

function shouldShowWorkflow(alert) {
  if (!alert || alert.kind !== "incident") return false;
  if (isWorkflowClosed(alert.workflowStatus)) return false;

  const evaluation = getZoneEvaluation(alert.zoneId);
  const operatorEngaged = alert.workflowStatus !== WORKFLOW_STATUS.OPEN;
  return evaluation.risk !== "normal" || operatorEngaged;
}

function renderWorkflowPanel() {
  const alert = getSelectedAlert();

  if (!shouldShowWorkflow(alert)) {
    ui.workflowSection.classList.add("hidden");
    ui.workflowPanel.innerHTML = "";
    ui.actionPlaceholder.classList.remove("hidden");
    return;
  }

  ui.actionPlaceholder.classList.add("hidden");
  ui.workflowSection.classList.remove("hidden");

  const closed = isWorkflowClosed(alert.workflowStatus);
  const actions = getWorkflowActions(alert.workflowStatus);

  const steps = [
    WORKFLOW_STATUS.OPEN,
    WORKFLOW_STATUS.ACKNOWLEDGED,
    WORKFLOW_STATUS.TICKET,
    WORKFLOW_STATUS.DISPATCHED,
    alert.workflowStatus === WORKFLOW_STATUS.CLOSED_FALSE
      ? WORKFLOW_STATUS.CLOSED_FALSE
      : WORKFLOW_STATUS.CLOSED_LEAK,
  ];

  const progressMap = {
    [WORKFLOW_STATUS.OPEN]: 0,
    [WORKFLOW_STATUS.ACKNOWLEDGED]: 1,
    [WORKFLOW_STATUS.TICKET]: 2,
    [WORKFLOW_STATUS.DISPATCHED]: 3,
    [WORKFLOW_STATUS.CLOSED_LEAK]: 4,
    [WORKFLOW_STATUS.CLOSED_FALSE]: 4,
  };
  const currentProgress = progressMap[alert.workflowStatus] ?? 0;

  const stepHtml = steps
    .map((step, index) => {
      const done = index < currentProgress || (closed && index <= currentProgress);
      const isCurrent = alert.workflowStatus === step;
      return `<div class="workflow-step ${done ? "done" : ""} ${isCurrent ? "current" : ""}">${WORKFLOW_LABELS[step]}</div>`;
    })
    .join("");

  const logHtml = alert.workflowLog.map((entry) => `<li>${entry}</li>`).join("");

  const primaryBtn = actions.primary
    ? `<button id="wf-primary" class="btn btn-primary" data-action="${actions.primary.id}">${actions.primary.label}</button>`
    : "";
  const secondaryBtns = actions.secondary
    .map(
      (s) =>
        `<button class="btn btn-ghost wf-secondary" data-action="${s.id}">${s.label}</button>`
    )
    .join("");

  ui.workflowPanel.innerHTML = `
    <h3>Operator Workflow — ${alert.zoneId}</h3>
    <p class="workflow-intro">Follow steps in order. Only the next valid action is enabled.</p>
    ${actions.hint ? `<p class="workflow-hint">${actions.hint}</p>` : ""}
    <div class="workflow-steps">${stepHtml}</div>
    <div class="workflow-actions workflow-actions-primary">${primaryBtn}</div>
    <div class="workflow-actions">${secondaryBtns}</div>
    ${alert.ticketId ? `<p class="ticket-id">Work order: <strong>${alert.ticketId}</strong></p>` : ""}
    ${alert.isFalsePositive ? `<p class="false-positive-note">Context suggests a false positive — verify before dispatch.</p>` : ""}
    <ul class="workflow-log">${logHtml}</ul>
  `;

  if (!closed) {
    document.getElementById("wf-primary")?.addEventListener("click", (e) => {
      runWorkflowAction(e.target.dataset.action);
    });
    document.querySelectorAll(".wf-secondary").forEach((btn) => {
      btn.addEventListener("click", (e) => runWorkflowAction(e.target.dataset.action));
    });
  }
}

function runWorkflowAction(action) {
  const alert = getSelectedAlert();
  if (!alert || alert.kind !== "incident" || isWorkflowClosed(alert.workflowStatus)) return;

  const allowed = getWorkflowActions(alert.workflowStatus);
  const allowedIds = [
    allowed.primary?.id,
    ...allowed.secondary.map((s) => s.id),
  ].filter(Boolean);
  if (!allowedIds.includes(action)) return;

  switch (action) {
    case "ack":
      acknowledgeAlert(alert);
      break;
    case "ticket":
      createTicket(alert);
      break;
    case "dispatch":
      dispatchCrew(alert);
      break;
    case "leak":
      closeAsLeak(alert);
      break;
    case "false":
      closeAsFalseAlarm(alert);
      break;
    default:
      break;
  }

  renderAll();
}

function buildContextSummary(zone, reading) {
  const timeContext = getTimeContext(reading.hour);
  const maintenance = getMaintenanceForZone(zone.id, state.maintenanceEvents);
  const scenario = describeScenario(reading.scenarioType ?? "normal");
  const maintenanceText = maintenance.length
    ? maintenance.map((m) => m.title).join("; ")
    : "None scheduled";

  return { time: timeContext, weather: state.weather, maintenanceText, scenario };
}

function renderZoneContext(zone, reading, context) {
  ui.zoneContext.innerHTML = `
    <h3>Operational Context — ${zone.id}</h3>
    <div class="context-grid">
      <div class="context-card">
        <span>Time of day</span>
        <strong>${context.time.label}</strong>
        <p>${context.time.detail}</p>
      </div>
      <div class="context-card">
        <span>Weather</span>
        <strong>${context.weather.label}</strong>
        <p>${context.weather.impact}</p>
      </div>
      <div class="context-card">
        <span>Maintenance</span>
        <strong>${context.maintenanceText}</strong>
        <p>Cross-check alerts against work orders before dispatch.</p>
      </div>
      <div class="context-card ${context.scenario.isFalsePositive ? "context-highlight" : ""}">
        <span>Scenario assessment</span>
        <strong>${context.scenario.title}</strong>
        <p>${context.scenario.operatorHint}</p>
      </div>
    </div>
  `;
}

function renderWhyFlagged(zoneId, evaluation) {
  const latest = state.latestByZone.get(zoneId);
  if (!latest || evaluation.risk === "normal") {
    ui.whyFlagged.classList.add("hidden");
    ui.whyFlagged.innerHTML = "";
    return;
  }

  const lines = buildWhyFlagged(latest, state.modelBundle, evaluation);
  ui.whyFlagged.classList.remove("hidden");
  ui.whyFlagged.innerHTML = `
    <h4>Why flagged</h4>
    <ul>${lines.map((line) => `<li>${line}</li>`).join("")}</ul>
  `;
}

function renderSelectedZone() {
  const zoneId = state.selectedZoneId;
  if (!zoneId) {
    ui.zoneContext.innerHTML =
      '<p class="placeholder-text">Operational context appears when a zone is selected.</p>';
    ui.whyFlagged.classList.add("hidden");
    return;
  }

  const zone = PRESSURE_ZONES.find((z) => z.id === zoneId);
  const latest = state.latestByZone.get(zoneId);
  if (!zone || !latest) return;

  const evaluation = getZoneEvaluation(zoneId);
  const context = buildContextSummary(zone, latest);

  ui.zoneTitle.textContent = `${zone.id} — ${zone.name}`;
  ui.zoneStatus.textContent = evaluation.label;
  ui.zoneStatus.className = `badge ${badgeClass(evaluation.risk)}`;

  ui.zoneDetails.innerHTML = `
    <div class="zone-meta">
      <span class="tag ${zone.priority === "high" ? "tag-danger" : "tag-neutral"}">${priorityLabel(zone.priority)}</span>
      <span class="tag tag-neutral">${zone.dma}</span>
      <span class="tag ${evaluation.risk !== "normal" ? "tag-warning" : "tag-neutral"}">Map: ${evaluation.label}</span>
    </div>
    <p class="zone-note">${zone.note}</p>
    <div class="detail-grid">
      <div class="detail-item"><span>Flow</span><strong>${latest.flowLps} L/s</strong></div>
      <div class="detail-item"><span>Pressure</span><strong>${latest.pressurePsi} psi</strong></div>
      <div class="detail-item"><span>Leak Probability</span><strong>${(evaluation.probability * 100).toFixed(1)}%</strong></div>
      <div class="detail-item"><span>Rule Alert</span><strong>${evaluation.ruleHit ? "Yes" : "No"}</strong></div>
      <div class="detail-item"><span>Detection</span><strong>${evaluation.rulesOnly ? "Rules only" : "ML model"}</strong></div>
      <div class="detail-item"><span>Last Update</span><strong>${formatTime(latest.timestamp)}</strong></div>
    </div>
  `;

  renderZoneContext(zone, latest, context);
  renderWhyFlagged(zoneId, evaluation);
  renderZoneChart(ui.zoneChart, getZoneHistory(state.readings, zoneId, 48), getChartTheme());
  mapApi.setSelected(zoneId);
}

function refreshMapAndIncidents() {
  for (const zone of PRESSURE_ZONES) {
    const latest = state.latestByZone.get(zone.id);
    if (!latest) {
      mapApi.setMarkerRisk(zone.id, "normal");
      mapApi.setMaintenanceBadge(zone.id, false);
      continue;
    }
    const evaluation = getZoneEvaluation(zone.id);
    mapApi.setMarkerRisk(zone.id, evaluation.risk);
    const maintenance = getMaintenanceForZone(zone.id, state.maintenanceEvents);
    mapApi.setMaintenanceBadge(zone.id, maintenance.length > 0);
    upsertIncident(zone, latest, evaluation);
  }
  reconcileIncidents();
}

function ingestReading(row) {
  state.readings.push(row);
  state.latestByZone.set(row.zoneId, row);
  refreshMapAndIncidents();
  renderAll();
}

function renderAll() {
  updateMetrics();
  renderAlerts();
  renderActivityLog();
  renderSelectedZone();
  renderWorkflowPanel();
  updateButtonStates();
  renderUserGuidePanel();
  if (userGuide?.isActive?.()) {
    userGuide.refresh();
  }
}

function getScriptContext() {
  const { activeOnMap } = classifyOpenIncidents();
  return {
    appPhase: state.appPhase,
    hasData: state.readings.length > 0,
    hasModel: Boolean(state.modelBundle?.model),
    rulesOnly: state.detectionMode === DETECTION_MODE.RULES,
    hasSelection: Boolean(state.selectedZoneId),
    isLive: Boolean(state.simulationTimer),
    hasActiveIncident: activeOnMap.length > 0,
    hasOpenIncident: getOpenIncidents(state.alerts).length > 0,
    contextTabViewed: state.contextTabViewed,
    zoneInspectDone: state.zoneInspectDone,
    guideSimStarted: state.guideSimStarted,
    guideResetDone: state.guideResetDone,
    hasClosedFalseAlarm: state.alerts.some(
      (a) => a.workflowStatus === WORKFLOW_STATUS.CLOSED_FALSE
    ),
    workflowAcknowledged: state.alerts.some(
      (a) =>
        a.kind === "incident" &&
        a.workflowStatus !== WORKFLOW_STATUS.OPEN &&
        !isWorkflowClosed(a.workflowStatus)
    ),
    hasClosedLeak: state.alerts.some(
      (a) => a.workflowStatus === WORKFLOW_STATUS.CLOSED_LEAK
    ),
    skippedStepIds: userGuide?.getSkippedStepIds?.() ?? [],
  };
}

function selectFirstZone() {
  if (PRESSURE_ZONES.length) selectZone(PRESSURE_ZONES[0].id);
}

function selectFirstRiskyZone() {
  const risky = PRESSURE_ZONES.find((z) => getZoneEvaluation(z.id).risk !== "normal");
  if (!risky) return false;
  const open = getOpenIncidents(state.alerts).find((a) => a.zoneId === risky.id);
  if (open) {
    selectIncident(open.id);
  } else {
    selectZone(risky.id);
  }
  return true;
}

function hasRiskyZone() {
  return PRESSURE_ZONES.some((z) => getZoneEvaluation(z.id).risk !== "normal");
}

function getSelectedIncident() {
  return getSelectedAlert();
}

function isIncidentClosed(alert) {
  return !alert || isWorkflowClosed(alert.workflowStatus);
}

function acknowledgeSelected() {
  const alert = getSelectedAlert();
  if (alert) acknowledgeAlert(alert);
  renderAll();
}

function closeSelectedFalseAlarm() {
  const alert = getSelectedAlert();
  if (alert) closeAsFalseAlarm(alert);
  renderAll();
}

function createTicketSelected() {
  const alert = getSelectedAlert();
  if (alert) createTicket(alert);
  renderAll();
}

function dispatchSelected() {
  const alert = getSelectedAlert();
  if (alert) dispatchCrew(alert);
  renderAll();
}

function confirmLeakSelected() {
  const alert = getSelectedAlert();
  if (alert) closeAsLeak(alert);
  renderAll();
}

function setGuideMode(active) {
  document.body.classList.toggle("guide-mode-active", active);
}

function renderUserGuidePanel() {
  const steps = userGuide.getSteps();
  const current = userGuide.getCurrentStep();
  const running = userGuide.isActive();
  const complete = userGuide.getStatus() === "complete";

  ui.guideIdle.classList.toggle("hidden", running || complete);
  ui.guideBody.classList.toggle("hidden", !running && !complete);
  ui.btnGuideStart.classList.toggle("hidden", running);
  ui.btnGuideStop.classList.toggle("hidden", !running);

  if (!running && !complete) {
    ui.guideProgress.textContent = "Not started";
    return;
  }

  if (complete) {
    ui.guideProgress.textContent = "Guide complete";
    ui.guideStepTitle.textContent = "You're ready to explore";
    ui.guideStepDuration.textContent = "";
    ui.guideLearn.innerHTML =
      "<strong>What you learned:</strong> How data, ML detection, live updates, context review, and operator workflow fit together. Use <strong>Reset demo</strong> anytime to start over.";
    ui.guideYouWillSee.innerHTML =
      "<strong>Try next:</strong> Change detection mode, simulation speed, or inject leak / hydrant test from the toolbar.";
    ui.btnGuideRun.disabled = true;
    ui.btnGuideSkip.disabled = true;
    ui.guideSteps.innerHTML = "";
    return;
  }

  ui.guideProgress.textContent = `Step ${userGuide.getStepIndex() + 1} of ${steps.length}`;
  ui.guideSteps.innerHTML = steps
    .map((step, index) => {
      const icon = userGuide.isStepCompleteAt(index)
        ? "✓"
        : userGuide.isStepCurrent(index)
          ? "▶"
          : userGuide.isStepLocked(index)
            ? "○"
            : "·";
      const cls = [
        userGuide.isStepCompleteAt(index) ? "done" : "",
        userGuide.isStepCurrent(index) ? "current" : "",
        userGuide.isStepLocked(index) ? "locked" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<li class="${cls}"><span class="user-guide-step-icon">${icon}</span><span>${step.title}</span></li>`;
    })
    .join("");

  if (current) {
    ui.guideStepTitle.textContent = current.title;
    ui.guideStepDuration.textContent = current.duration ?? "";
    ui.guideLearn.innerHTML = `<strong>What you'll learn:</strong> ${current.learn}`;
    ui.guideYouWillSee.innerHTML = `<strong>What you'll see:</strong> ${current.youWillSee}`;
  }

  const stepComplete =
    current && userGuide.isStepCompleteAt(userGuide.getStepIndex());
  ui.btnGuideRun.disabled = !userGuide.canRunCurrentAction() || stepComplete;
  ui.btnGuideRun.textContent = stepComplete ? "Done — continue below" : "Do this step";
  ui.btnGuideSkip.disabled = !current;
}

const userGuide = buildUserGuide({
  getContext: getScriptContext,
  onChange: () => renderUserGuidePanel(),
  onStart: () => {
    stopSimulation();
    state.contextTabViewed = false;
    state.zoneInspectDone = false;
    state.guideSimStarted = false;
    state.guideResetDone = false;
    setGuideMode(true);
    renderUserGuidePanel();
  },
  onStop: () => {
    stopSimulation();
    state.guideSimStarted = false;
    setGuideMode(false);
    renderUserGuidePanel();
  },
  resetDemo: (options) => resetDemo(options ?? { keepGuide: true }),
  generateData: () => onGenerateData(),
  trainModel: () => onTrainModel(),
  startSimulation: () => startSimulation(),
  stopSimulation: () => stopSimulation(),
  selectFirstZone: () => selectFirstZone(),
  selectFirstRiskyZone: () => selectFirstRiskyZone(),
  setSideTab: (tab) => setActiveSideTab(tab),
  markContextViewed: () => {
    state.contextTabViewed = true;
  },
  markZoneInspectDone: () => {
    state.zoneInspectDone = true;
  },
  markGuideSimStarted: () => {
    state.guideSimStarted = true;
  },
  markGuideResetDone: () => {
    state.guideResetDone = true;
  },
  injectScenario: (key) => injectScenario(key),
  wait: (ms) => sleep(ms),
  getSelectedIncident: () => getSelectedIncident(),
  getOpenIncidentsForWorkflow: () =>
    getOpenIncidents(state.alerts).filter((a) => !isWorkflowClosed(a.workflowStatus)),
  selectIncidentById: (id) => selectIncident(id),
  isIncidentClosed: (alert) => isIncidentClosed(alert),
  hasRiskyZone: () => hasRiskyZone(),
  acknowledgeSelected: () => acknowledgeSelected(),
  closeSelectedFalseAlarm: () => closeSelectedFalseAlarm(),
  createTicketSelected: () => createTicketSelected(),
  dispatchSelected: () => dispatchSelected(),
  confirmLeakSelected: () => confirmLeakSelected(),
});

function updateThemeButton() {
  ui.btnTheme.textContent = getThemeLabel(state.theme);
}

function onThemeToggle() {
  state.theme = toggleTheme(state.theme);
  updateThemeButton();
  if (state.selectedZoneId) {
    renderSelectedZone();
  }
}

function onGenerateData() {
  stopSimulation();
  state.readings = generateScadaDataset({ days: 14, leakRate: 0.04, seed: 42 });
  state.latestByZone = getLatestByZone(state.readings);
  state.modelBundle = {
    model: null,
    accuracy: 0,
    zoneStats: computeZoneStats(state.readings),
  };
  state.alerts = [];
  state.selectedAlertId = null;
  state.maintenanceEvents = createMaintenanceSchedule();
  state.weather = createSimulationEnvironment(42).weather;

  refreshMapAndIncidents();
  renderMaintenanceList();
  selectZone(PRESSURE_ZONES[0].id);
  setAppPhase(APP_PHASE.DATA_READY);
  pushSystemLog("Synthetic dataset loaded (14 days, 8 zones).");
}

function onTrainModel() {
  if (!state.readings.length) {
    pushSystemLog("Generate data before training.", "warning");
    return;
  }
  state.modelBundle = buildModelBundle(state.readings);
  state.detectionMode = DETECTION_MODE.ML;
  ui.detectionMode.value = DETECTION_MODE.ML;
  refreshMapAndIncidents();
  renderAll();
  setAppPhase(APP_PHASE.MODEL_READY);
  pushSystemLog(`Model trained — test accuracy ${(state.modelBundle.accuracy * 100).toFixed(1)}%.`);
}

function stopSimulation() {
  if (state.simulationTimer) {
    clearInterval(state.simulationTimer);
    state.simulationTimer = null;
  }
  state.guideSimStarted = false;
  ui.btnSimulate.textContent = "3. Live Simulation";
  ui.btnSimulate.classList.remove("btn-active");
  if (state.appPhase === APP_PHASE.LIVE) {
    setAppPhase(state.modelBundle?.model ? APP_PHASE.MODEL_READY : APP_PHASE.DATA_READY);
  }
}

function startSimulation() {
  const intervalMs = SIMULATION_MS[state.simulationSpeed] ?? SIMULATION_MS.normal;
  state.simulationTimer = setInterval(() => {
    const zone = PRESSURE_ZONES[Math.floor(Math.random() * PRESSURE_ZONES.length)];
    const previous = state.latestByZone.get(zone.id);
    const row = simulateLiveTick(zone, previous, state.maintenanceEvents, state.weather);
    ingestReading(row);
  }, intervalMs);
  ui.btnSimulate.textContent = "Stop Live Simulation";
  ui.btnSimulate.classList.add("btn-active");
  setAppPhase(APP_PHASE.LIVE);
}

function onToggleSimulation() {
  if (state.simulationTimer) {
    stopSimulation();
    return;
  }

  if (!state.readings.length) {
    pushSystemLog("Generate data first.", "warning");
    return;
  }

  startSimulation();
}

function resetDemo(options = {}) {
  if (!options.keepGuide && userGuide?.isActive()) {
    userGuide.stop();
  }
  stopSimulation();
  state.readings = [];
  state.latestByZone = new Map();
  state.modelBundle = null;
  state.alerts = [];
  state.selectedZoneId = null;
  state.selectedAlertId = null;
  state.maintenanceEvents = [];
  state.weather = WEATHER_CONDITIONS[0];
  state.detectionMode = DETECTION_MODE.ML;
  state.contextTabViewed = false;
  state.zoneInspectDone = false;
  state.guideSimStarted = false;
  state.guideResetDone = false;
  ui.detectionMode.value = DETECTION_MODE.ML;

  for (const zone of PRESSURE_ZONES) {
    mapApi.setMarkerRisk(zone.id, "normal");
    mapApi.setMaintenanceBadge(zone.id, false);
    mapApi.setSelected(null);
  }

  ui.zoneTitle.textContent = "Zone Inspector";
  ui.zoneStatus.textContent = "Select a zone";
  ui.zoneStatus.className = "badge badge-neutral";
  ui.zoneDetails.innerHTML =
    '<p class="placeholder-text">Click a marker or an incident. The map pans to your selection.</p>';
  ui.zoneContext.innerHTML =
    '<p class="placeholder-text">Operational context appears when a zone is selected.</p>';
  ui.whyFlagged.classList.add("hidden");
  ui.maintenanceList.innerHTML =
    '<li class="context-empty">Generate data to load schedule.</li>';

  setAppPhase(APP_PHASE.IDLE);
  renderAll();
  pushSystemLog("Demo reset — start with Generate Data.");
}

function injectScenario(scenarioKey) {
  if (!state.readings.length) {
    pushSystemLog("Generate data before injecting a scenario.", "warning");
    return;
  }

  const scenarioType = SCENARIO_TYPES[scenarioKey.toUpperCase()] ?? scenarioKey;
  const zone = PRESSURE_ZONES[Math.floor(Math.random() * PRESSURE_ZONES.length)];
  const row = createScriptedReading(zone, scenarioType, state.weather);
  ingestReading(row);
  selectZone(zone.id);
  setActiveSideTab("action");
  pushSystemLog(`Scripted event: ${scenarioType} in ${zone.id}.`, "warning");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runGuidedDemo() {
  resetDemo();
  await sleep(400);
  onGenerateData();
  await sleep(800);
  onTrainModel();
  await sleep(600);
  startSimulation();
  pushSystemLog("Quick tour: simulation running — watch for orange or red markers.", "warning");
  await sleep(12000);
  const risky = PRESSURE_ZONES.find((z) => getZoneEvaluation(z.id).risk !== "normal");
  if (risky) {
    selectZone(risky.id);
    setActiveSideTab("action");
  }
}

function onDetectionModeChange() {
  state.detectionMode = ui.detectionMode.value;
  if (state.readings.length) {
    refreshMapAndIncidents();
    renderAll();
    pushSystemLog(
      state.detectionMode === DETECTION_MODE.RULES
        ? "Switched to rules-only detection."
        : "Switched to ML detection."
    );
  }
}

document.querySelectorAll(".side-tab").forEach((btn) => {
  btn.addEventListener("click", () => setActiveSideTab(btn.dataset.tab));
});

ui.btnGenerate.addEventListener("click", onGenerateData);
ui.btnTrain.addEventListener("click", onTrainModel);
ui.btnSimulate.addEventListener("click", onToggleSimulation);
ui.btnReset.addEventListener("click", () => resetDemo());
ui.btnGuided.addEventListener("click", () => runGuidedDemo());
ui.btnHelp.addEventListener("click", () => ui.helpModal.showModal());
ui.btnTheme.addEventListener("click", onThemeToggle);
ui.btnGuideStart.addEventListener("click", () => userGuide.start());
ui.btnGuideStop.addEventListener("click", () => userGuide.stop());
ui.btnGuideRun.addEventListener("click", () => userGuide.runCurrentAction());
ui.btnGuideSkip.addEventListener("click", () => userGuide.skipCurrent());
ui.detectionMode.addEventListener("change", onDetectionModeChange);
ui.simSpeed.addEventListener("change", () => {
  state.simulationSpeed = ui.simSpeed.value;
  if (state.simulationTimer) {
    stopSimulation();
    startSimulation();
  }
});

document.querySelectorAll("[data-scenario]").forEach((btn) => {
  btn.addEventListener("click", () => injectScenario(btn.dataset.scenario));
});

ui.btnClearAlerts.addEventListener("click", () => {
  state.alerts = state.alerts.filter((alert) => {
    if (alert.kind === "system") return true;
    return !isWorkflowClosed(alert.workflowStatus);
  });
  state.selectedAlertId = null;
  renderAll();
});

state.theme = initTheme();
updateThemeButton();
setAppPhase(APP_PHASE.IDLE);
renderAll();
