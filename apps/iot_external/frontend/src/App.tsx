import { useEffect, useState } from "react";

import {
  fetchLiveSnapshot,
  updateClimateTargets,
  updateControlMode,
  updateManualActuators,
} from "./app/api";
import type {
  ActuatorState,
  ClimateHistoryPoint,
  ClimateSnapshot,
  ClimateTargets,
  ControlMode,
} from "./app/types";
import { DashboardPreview } from "./features/dashboard/DashboardPreview";

const REFRESH_INTERVAL_MS = 5000;
const MAX_HISTORY_POINTS = 50;
const SNAPSHOT_STORAGE_KEY = "climate-dashboard-snapshot-v1";
const HISTORY_STORAGE_KEY = "climate-dashboard-history-v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isClimateMetrics(value: unknown): value is ClimateSnapshot["metrics"] {
  if (!isRecord(value)) return false;

  return (
    isNumber(value.temperatureC) &&
    isNumber(value.humidityPct) &&
    isNumber(value.co2Ppm)
  );
}

function isActuatorState(value: unknown): value is ClimateSnapshot["actuators"] {
  if (!isRecord(value)) return false;

  const candidate = value as Partial<ClimateSnapshot["actuators"]>;

  return (
    typeof candidate.heater === "boolean" &&
    typeof candidate.airConditioner === "boolean" &&
    typeof candidate.humidifier === "boolean" &&
    typeof candidate.windowLeft === "boolean" &&
    typeof candidate.windowRight === "boolean" &&
    typeof candidate.exhaust === "boolean"
  );
}

function isClimateHistoryPoint(value: unknown): value is ClimateHistoryPoint {
  if (!isRecord(value)) return false;

  return typeof value.timestamp === "string" && isClimateMetrics(value.metrics);
}

function readStoredValue(key: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredValue(key: string, value: string): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep working with in-memory state when storage is unavailable.
  }
}

function loadStoredSnapshot(): ClimateSnapshot | null {
  const stored = readStoredValue(SNAPSHOT_STORAGE_KEY);
  if (stored === null) return null;

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)) return null;

    const snapshot = parsed as Partial<ClimateSnapshot>;
    if (typeof snapshot.deviceId !== "string" || typeof snapshot.timestamp !== "string") {
      return null;
    }

    if (!isClimateMetrics(snapshot.metrics)) return null;
    if (!isActuatorState(snapshot.actuators)) return null;

    if (!isRecord(snapshot.control)) return null;
    if (snapshot.control.mode !== "auto" && snapshot.control.mode !== "manual") {
      return null;
    }
    if (typeof snapshot.control.controller !== "string") return null;

    if (!isRecord(snapshot.rl)) return null;
    if (!isNumber(snapshot.rl.reward) || !isNumber(snapshot.rl.confidence)) {
      return null;
    }
    if (typeof snapshot.rl.targetZone !== "string") return null;

    if (snapshot.outsideMetrics !== undefined && !isClimateMetrics(snapshot.outsideMetrics)) {
      return null;
    }

    return snapshot as ClimateSnapshot;
  } catch {
    return null;
  }
}

function loadStoredHistory(): ClimateHistoryPoint[] {
  const stored = readStoredValue(HISTORY_STORAGE_KEY);
  if (stored === null) return [];

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isClimateHistoryPoint).slice(-MAX_HISTORY_POINTS);
  } catch {
    return [];
  }
}

function persistSnapshot(snapshot: ClimateSnapshot): void {
  writeStoredValue(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
}

function persistHistory(history: ClimateHistoryPoint[]): void {
  writeStoredValue(
    HISTORY_STORAGE_KEY,
    JSON.stringify(history.slice(-MAX_HISTORY_POINTS)),
  );
}

function appendHistoryPoint(
  history: ClimateHistoryPoint[],
  snapshot: ClimateSnapshot,
): ClimateHistoryPoint[] {
  const lastPoint = history[history.length - 1];
  const nextPoint: ClimateHistoryPoint = {
    timestamp: snapshot.timestamp,
    metrics: snapshot.metrics,
  };

  if (lastPoint?.timestamp === nextPoint.timestamp) {
    return history;
  }

  return [...history, nextPoint].slice(-MAX_HISTORY_POINTS);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

export function App() {
  const [snapshot, setSnapshot] = useState<ClimateSnapshot | null>(() => loadStoredSnapshot());
  const [history, setHistory] = useState<ClimateHistoryPoint[]>(() => loadStoredHistory());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot === null) return;
    persistSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    persistHistory(history);
  }, [history]);

  useEffect(() => {
    let active = true;

    async function loadSnapshot() {
      try {
        const nextSnapshot = await fetchLiveSnapshot();
        if (!active) return;

        setSnapshot(nextSnapshot);
        setHistory((current) => appendHistoryPoint(current, nextSnapshot));
        setErrorMessage(null);
      } catch (error) {
        if (!active) return;

        console.error(error);
        setErrorMessage(getErrorMessage(error, "Не удалось получить состояние устройства"));
      }
    }

    loadSnapshot();
    const intervalId = window.setInterval(loadSnapshot, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  async function handleTargetsSave(nextTargets: ClimateTargets): Promise<boolean> {
    try {
      const result = await updateClimateTargets(nextTargets);
      setSnapshot(result.snapshot);
      setErrorMessage(null);
      return result.mqttPublished;
    } catch (error) {
      console.error(error);
      setErrorMessage(getErrorMessage(error, "Не удалось обновить целевые значения"));
      return false;
    }
  }

  async function handleModeChange(nextMode: ControlMode): Promise<boolean> {
    try {
      const result = await updateControlMode(nextMode);
      setSnapshot(result.snapshot);
      setErrorMessage(null);
      return result.mqttPublished;
    } catch (error) {
      console.error(error);
      setErrorMessage(getErrorMessage(error, "Не удалось переключить режим управления"));
      return false;
    }
  }

  async function handleActuatorsChange(nextActuators: ActuatorState): Promise<boolean> {
    try {
      const result = await updateManualActuators(nextActuators);
      setSnapshot(result.snapshot);
      setErrorMessage(null);
      return result.mqttPublished;
    } catch (error) {
      console.error(error);
      const message = getErrorMessage(
        error,
        "Не удалось отправить ручное состояние оборудования.",
      );
      setErrorMessage(message);
      throw new Error(message);
    }
  }

  if (snapshot === null) {
    return (
      <main className="app-loading-shell">
        <div className="app-loading-card">
          <span className="status-pill status-pill-live">Загрузка данных</span>
          <h1>Smart Climate Dashboard</h1>
          <p>Ожидаем состояние устройства и последние климатические показатели...</p>
          {errorMessage !== null ? <p className="app-loading-error">{errorMessage}</p> : null}
        </div>
      </main>
    );
  }

  return (
    <DashboardPreview
      snapshot={snapshot}
      history={history}
      historyLimit={MAX_HISTORY_POINTS}
      onTargetsSave={handleTargetsSave}
      onModeChange={handleModeChange}
      onActuatorsChange={handleActuatorsChange}
    />
  );
}
