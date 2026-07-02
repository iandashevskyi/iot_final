import type { ActuatorState, ClimateSnapshot, ClimateTargets, ControlMode } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";

interface SnapshotEnvelope {
  snapshot: ClimateSnapshot;
  mqttPublished?: boolean;
  error?: string;
}

export interface SnapshotMutationResult {
  snapshot: ClimateSnapshot;
  mqttPublished: boolean;
}

async function readSnapshotEnvelope(response: Response): Promise<SnapshotEnvelope> {
  const payload = (await response.json().catch(() => null)) as SnapshotEnvelope | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed");
  }

  if (payload === null || typeof payload !== "object" || payload.snapshot === undefined) {
    throw new Error("Malformed API response");
  }

  return payload;
}

export async function fetchLiveSnapshot(): Promise<ClimateSnapshot> {
  const response = await fetch(`${API_BASE_URL}/api/snapshot`);
  const data = await readSnapshotEnvelope(response);
  return data.snapshot;
}

export async function updateControlMode(mode: ControlMode): Promise<SnapshotMutationResult> {
  const response = await fetch(`${API_BASE_URL}/api/control/mode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode }),
  });
  const data = await readSnapshotEnvelope(response);

  return {
    snapshot: data.snapshot,
    mqttPublished: data.mqttPublished ?? false,
  };
}

export async function updateManualActuators(
  actuators: ActuatorState,
): Promise<SnapshotMutationResult> {
  const response = await fetch(`${API_BASE_URL}/api/control/actuators`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(actuators),
  });
  const data = await readSnapshotEnvelope(response);

  return {
    snapshot: data.snapshot,
    mqttPublished: data.mqttPublished ?? false,
  };
}

export async function updateClimateTargets(
  targets: ClimateTargets,
): Promise<SnapshotMutationResult> {
  const response = await fetch(`${API_BASE_URL}/api/control/targets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(targets),
  });
  const data = await readSnapshotEnvelope(response);

  return {
    snapshot: data.snapshot,
    mqttPublished: data.mqttPublished ?? false,
  };
}
