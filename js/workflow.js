export const WORKFLOW_STATUS = {
  OPEN: "open",
  ACKNOWLEDGED: "acknowledged",
  TICKET: "ticket_created",
  DISPATCHED: "dispatched",
  CLOSED_LEAK: "closed_leak",
  CLOSED_FALSE: "closed_false_alarm",
};

export const WORKFLOW_LABELS = {
  [WORKFLOW_STATUS.OPEN]: "Open — awaiting review",
  [WORKFLOW_STATUS.ACKNOWLEDGED]: "Acknowledged by operator",
  [WORKFLOW_STATUS.TICKET]: "Work order created",
  [WORKFLOW_STATUS.DISPATCHED]: "Crew dispatched",
  [WORKFLOW_STATUS.CLOSED_LEAK]: "Closed — leak confirmed",
  [WORKFLOW_STATUS.CLOSED_FALSE]: "Closed — false alarm / cleared",
};

let ticketCounter = 1040;

export function createAlertRecord({
  kind = "incident",
  zoneId,
  message,
  risk,
  scenarioType,
  contextSummary,
  suggestedCause,
  isFalsePositive,
}) {
  return {
    id: `alert-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    kind,
    zoneId,
    message,
    risk,
    scenarioType,
    contextSummary,
    suggestedCause,
    isFalsePositive,
    time: new Date(),
    createdAt: Date.now(),
    workflowStatus: kind === "incident" ? WORKFLOW_STATUS.OPEN : null,
    ticketId: null,
    workflowLog:
      kind === "incident"
        ? ["Incident opened — monitoring flagged this zone"]
        : [],
  };
}

export function autoClearIncident(alert) {
  alert.workflowStatus = WORKFLOW_STATUS.CLOSED_FALSE;
  alert.workflowLog.push("Auto-cleared — readings returned to normal");
  return alert;
}

export function acknowledgeAlert(alert) {
  if (alert.workflowStatus !== WORKFLOW_STATUS.OPEN) return alert;
  alert.workflowStatus = WORKFLOW_STATUS.ACKNOWLEDGED;
  alert.workflowLog.push("Operator acknowledged alert");
  return alert;
}

export function createTicket(alert) {
  if (alert.workflowStatus !== WORKFLOW_STATUS.ACKNOWLEDGED) {
    return alert;
  }
  ticketCounter += 1;
  alert.ticketId = `WO-${ticketCounter}`;
  alert.workflowStatus = WORKFLOW_STATUS.TICKET;
  alert.workflowLog.push(`Work order ${alert.ticketId} created`);
  return alert;
}

export function dispatchCrew(alert) {
  if (alert.workflowStatus !== WORKFLOW_STATUS.TICKET) return alert;
  alert.workflowStatus = WORKFLOW_STATUS.DISPATCHED;
  alert.workflowLog.push("Repair crew dispatched to zone");
  return alert;
}

export function closeAsLeak(alert) {
  alert.workflowStatus = WORKFLOW_STATUS.CLOSED_LEAK;
  alert.workflowLog.push("Field crew confirmed leak — case closed");
  return alert;
}

export function closeAsFalseAlarm(alert) {
  alert.workflowStatus = WORKFLOW_STATUS.CLOSED_FALSE;
  alert.workflowLog.push("Operator marked false alarm — feedback recorded for model review");
  return alert;
}

export function isWorkflowClosed(status) {
  if (!status) return true;
  return (
    status === WORKFLOW_STATUS.CLOSED_LEAK || status === WORKFLOW_STATUS.CLOSED_FALSE
  );
}

export function getOpenIncidents(alerts) {
  return alerts.filter(
    (alert) => alert.kind === "incident" && !isWorkflowClosed(alert.workflowStatus)
  );
}

/** Returns primary and secondary actions allowed for current workflow state. */
export function getWorkflowActions(status) {
  if (isWorkflowClosed(status)) {
    return { primary: null, secondary: [], hint: "Incident closed." };
  }
  switch (status) {
    case WORKFLOW_STATUS.OPEN:
      return {
        primary: { id: "ack", label: "Acknowledge alert" },
        secondary: [{ id: "false", label: "Mark false alarm" }],
        hint: "Step 1: Review context, then acknowledge.",
      };
    case WORKFLOW_STATUS.ACKNOWLEDGED:
      return {
        primary: { id: "ticket", label: "Create work order" },
        secondary: [{ id: "false", label: "Mark false alarm" }],
        hint: "Step 2: Create a ticket if dispatch is needed.",
      };
    case WORKFLOW_STATUS.TICKET:
      return {
        primary: { id: "dispatch", label: "Dispatch crew" },
        secondary: [
          { id: "false", label: "Mark false alarm" },
          { id: "leak", label: "Confirm leak (skip dispatch)" },
        ],
        hint: "Step 3: Dispatch crew or close if not needed.",
      };
    case WORKFLOW_STATUS.DISPATCHED:
      return {
        primary: { id: "leak", label: "Confirm leak — close case" },
        secondary: [{ id: "false", label: "Mark false alarm" }],
        hint: "Step 4: Record field outcome.",
      };
    default:
      return { primary: null, secondary: [], hint: "" };
  }
}
