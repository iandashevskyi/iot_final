import { useEffect, useState, type CSSProperties } from "react";

import type {
  ActuatorState,
  ClimateHistoryPoint,
  ClimateSnapshot,
  ClimateTargets,
  ControlMode,
  TargetRange,
} from "../../app/types";

interface DashboardPreviewProps {
  history: ClimateHistoryPoint[];
  historyLimit: number;
  snapshot: ClimateSnapshot;
  onActuatorsChange: (actuators: ActuatorState) => Promise<boolean>;
  onModeChange: (mode: ControlMode) => Promise<boolean>;
  onTargetsSave: (targets: ClimateTargets) => Promise<boolean>;
}

type MetricKey = keyof ClimateSnapshot["metrics"];
type ActuatorKey = keyof ActuatorState;
type MetricTone = "comfort" | "warning" | "critical";
type MetricTheme = "light" | "parchment" | "dark";
type HistoryTrendTone = "steady" | "rise" | "drop";

type TargetRangeDraft = { min: number | string; max: number | string };
type TargetDraft = Record<MetricKey, TargetRangeDraft>;

interface MetricDefinition {
  key: MetricKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  comfort: [number, number];
  theme: MetricTheme;
  precision: number;
  step: number;
  description: string;
}

interface MetricStatus {
  label: string;
  tone: MetricTone;
  description: string;
}

interface InsightContent {
  title: string;
  observation: string;
  action: string;
  effect: string;
}

interface HistoryPalette {
  line: string;
}

interface HistoryTrend {
  label: string;
  tone: HistoryTrendTone;
}

interface HistoryChartModel {
  areaPath: string;
  currentValue: number;
  endLabel: string;
  lastX: number;
  lastY: number;
  linePath: string;
  maxValue: number;
  minValue: number;
  startLabel: string;
}

type ScaleStyle = CSSProperties & {
  "--comfort-start": string;
  "--comfort-width": string;
  "--marker-position": string;
};

const HISTORY_CHART_WIDTH = 320;
const HISTORY_CHART_HEIGHT = 168;
const HISTORY_CHART_PADDING_X = 10;
const HISTORY_CHART_PADDING_Y = 12;

const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    key: "temperatureC",
    label: "Температура",
    unit: "°C",
    min: 16,
    max: 30,
    comfort: [21, 24],
    theme: "light",
    precision: 1,
    step: 0.5,
    description: "Показывает, насколько тепловой режим близок к выбранной зоне комфорта.",
  },
  {
    key: "humidityPct",
    label: "Влажность",
    unit: "%",
    min: 20,
    max: 70,
    comfort: [40, 60],
    theme: "parchment",
    precision: 1,
    step: 1,
    description: "Помогает отслеживать сухость воздуха и мягкость микроклимата в комнате.",
  },
  {
    key: "co2Ppm",
    label: "CO2",
    unit: "ppm",
    min: 400,
    max: 1600,
    comfort: [450, 800],
    theme: "dark",
    precision: 0,
    step: 10,
    description: "Отражает свежесть воздуха и необходимость проветривания помещения.",
  },
];

const ACTUATOR_LABELS: Record<ActuatorKey, string> = {
  heater: "Нагреватель",
  airConditioner: "Кондиционер",
  humidifier: "Увлажнитель",
  windowLeft: "Окно 1",
  windowRight: "Окно 2",
  exhaust: "Вытяжка",
};

const ACTUATOR_DESCRIPTIONS: Record<ActuatorKey, string> = {
  heater: "Возвращает температуру в выбранный комфортный коридор.",
  airConditioner: "Снимает перегрев и охлаждает помещение без резких скачков.",
  humidifier: "Добавляет влаги, когда воздух становится слишком сухим.",
  windowLeft: "Дает естественный приток воздуха для мягкого проветривания.",
  windowRight: "Поддерживает воздухообмен, когда комнате нужен свежий воздух.",
  exhaust: "Быстро выводит тяжелый воздух и помогает снижать CO2.",
};

const HISTORY_PALETTES: Record<MetricKey, HistoryPalette> = {
  temperatureC: {
    line: "#0a84ff",
  },
  humidityPct: {
    line: "#2f9b63",
  },
  co2Ppm: {
    line: "#f5a623",
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toPercent(value: number, min: number, max: number): number {
  return ((clamp(value, min, max) - min) / (max - min)) * 100;
}

function formatMetricValue(value: number, precision: number): string {
  return value.toFixed(precision);
}

function formatRangeValue(value: number | string, precision: number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(num)) {
    return "—";
  }
  return num.toFixed(precision);
}

function formatSignedMetricValue(value: number, precision: number): string {
  if (value === 0) {
    return value.toFixed(precision);
  }

  const prefix = value > 0 ? "+" : "−";
  return `${prefix}${Math.abs(value).toFixed(precision)}`;
}

function getMeasurementLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return "измерение";
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "измерения";
  }

  return "измерений";
}

function getMetricDefinition(metricKey: MetricKey): MetricDefinition {
  const definition = METRIC_DEFINITIONS.find((metric) => metric.key === metricKey);

  if (definition === undefined) {
    throw new Error(`Unknown metric key: ${metricKey}`);
  }

  return definition;
}

function getSavedComfortRange(
  snapshot: ClimateSnapshot,
  metricKey: MetricKey,
  fallback: [number, number],
): [number, number] {
  const target = snapshot.targets?.[metricKey];

  if (target === undefined) {
    return fallback;
  }

  return [target.min, target.max];
}

function buildTargetDraft(snapshot: ClimateSnapshot): TargetDraft {
  return METRIC_DEFINITIONS.reduce<TargetDraft>((draft, metric) => {
    const [comfortMin, comfortMax] = getSavedComfortRange(snapshot, metric.key, metric.comfort);
    draft[metric.key] = {
      min: comfortMin,
      max: comfortMax,
    };
    return draft;
  }, {} as TargetDraft);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getHistoryTrend(
  history: ClimateHistoryPoint[],
  metric: MetricDefinition,
): HistoryTrend {
  if (history.length < 2) {
    return {
      label: "Накопление",
      tone: "steady",
    };
  }

  const startValue = history[0].metrics[metric.key];
  const endValue = history[history.length - 1].metrics[metric.key];
  const delta = endValue - startValue;

  if (Math.abs(delta) < metric.step / 2) {
    return {
      label: "Без изменений",
      tone: "steady",
    };
  }

  return {
    label: `Δ ${formatSignedMetricValue(delta, metric.precision)} ${metric.unit}`,
    tone: delta > 0 ? "rise" : "drop",
  };
}

function buildHistoryChart(
  history: ClimateHistoryPoint[],
  metric: MetricDefinition,
): HistoryChartModel {
  const fallbackValue = history[history.length - 1]?.metrics[metric.key] ?? metric.comfort[0];
  const rawValues =
    history.length === 0 ? [fallbackValue] : history.map((point) => point.metrics[metric.key]);
  const chartValues = rawValues.length === 1 ? [rawValues[0], rawValues[0]] : rawValues;
  const minValue = Math.min(...rawValues);
  const maxValue = Math.max(...rawValues);
  const rawSpan = maxValue - minValue;
  const basePadding = metric.key === "co2Ppm" ? 40 : metric.step * 2;
  const dynamicPadding = rawSpan === 0 ? basePadding : Math.max(rawSpan * 0.18, metric.step);

  let domainMin = Math.max(metric.min, minValue - dynamicPadding);
  let domainMax = Math.min(metric.max, maxValue + dynamicPadding);

  if (domainMax - domainMin < metric.step * 2) {
    const center = (domainMin + domainMax) / 2;
    domainMin = Math.max(metric.min, center - metric.step);
    domainMax = Math.min(metric.max, center + metric.step);
  }

  const usableWidth = HISTORY_CHART_WIDTH - HISTORY_CHART_PADDING_X * 2;
  const usableHeight = HISTORY_CHART_HEIGHT - HISTORY_CHART_PADDING_Y * 2;
  const valueRange = domainMax - domainMin || 1;

  const points = chartValues.map((value, index) => {
    const x =
      HISTORY_CHART_PADDING_X +
      (usableWidth * index) / Math.max(chartValues.length - 1, 1);
    const normalized = (value - domainMin) / valueRange;
    const y = HISTORY_CHART_HEIGHT - HISTORY_CHART_PADDING_Y - normalized * usableHeight;

    return {
      x,
      y,
    };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const baselineY = HISTORY_CHART_HEIGHT - HISTORY_CHART_PADDING_Y;
  const areaPath = `${linePath} L ${lastPoint.x.toFixed(2)} ${baselineY.toFixed(2)} L ${firstPoint.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;

  return {
    areaPath,
    currentValue: rawValues[rawValues.length - 1],
    endLabel: formatShortTime(history[history.length - 1]?.timestamp ?? ""),
    lastX: lastPoint.x,
    lastY: lastPoint.y,
    linePath,
    maxValue,
    minValue,
    startLabel: formatShortTime(history[0]?.timestamp ?? ""),
  };
}

function getMetricStatus(
  value: number,
  min: number,
  max: number,
  comfort: [number, number],
): MetricStatus {
  const [comfortMin, comfortMax] = comfort;
  const softOffset = (max - min) * 0.08;

  if (value >= comfortMin && value <= comfortMax) {
    return {
      label: "Комфорт",
      tone: "comfort",
      description: "Показатель сейчас удерживается внутри выбранной зоны.",
    };
  }

  if (value < comfortMin) {
    return {
      label: value >= comfortMin - softOffset ? "Ниже цели" : "Отклонение",
      tone: value >= comfortMin - softOffset ? "warning" : "critical",
      description: "Параметр опустился ниже рабочего коридора и требует коррекции.",
    };
  }

  return {
    label: value <= comfortMax + softOffset ? "Выше цели" : "Перегрузка",
    tone: value <= comfortMax + softOffset ? "warning" : "critical",
    description: "Параметр поднялся выше выбранной зоны и нуждается в коррекции.",
  };
}

function getActiveSystems(actuators: ActuatorState): string {
  const active = (Object.entries(actuators) as [ActuatorKey, boolean][])
    .filter(([, enabled]) => enabled)
    .map(([key]) => ACTUATOR_LABELS[key]);

  if (active.length === 0) {
    return "Оборудование в ожидании";
  }

  return active.join(", ");
}

function getComfortSummary(snapshot: ClimateSnapshot): string {
  const inComfortCount = METRIC_DEFINITIONS.filter((metric) => {
    const comfortRange = getSavedComfortRange(snapshot, metric.key, metric.comfort);
    const value = snapshot.metrics[metric.key];
    return value >= comfortRange[0] && value <= comfortRange[1];
  }).length;

  if (inComfortCount === METRIC_DEFINITIONS.length) {
    return "Комфорт поддерживается";
  }

  if (inComfortCount === 2) {
    return "Есть одно отклонение";
  }

  return "Среде нужна коррекция";
}

function getModeLabel(mode: ControlMode): string {
  return mode === "auto" ? "Автоматический" : "Ручной";
}

function getModeSummary(mode: ControlMode): string {
  return mode === "auto"
    ? "Алгоритм сам выбирает оборудование и удерживает параметры внутри выбранных диапазонов."
    : "Автоматические переключения остановлены, а поток данных с датчиков продолжает обновляться.";
}

function getInsightContent(
  mode: ControlMode,
  snapshot: ClimateSnapshot,
  actuators: ActuatorState,
): InsightContent {
  const temperatureRange = getSavedComfortRange(snapshot, "temperatureC", [21, 24]);
  const humidityRange = getSavedComfortRange(snapshot, "humidityPct", [40, 60]);
  const co2Range = getSavedComfortRange(snapshot, "co2Ppm", [450, 800]);

  if (mode === "manual") {
    return {
      title: "Сейчас решения принимает оператор.",
      observation: "Система продолжает получать телеметрию, но больше не применяет автоматические команды к оборудованию.",
      action: "Панель дает вручную зафиксировать нужное состояние каналов и спокойно показать логику стенда.",
      effect: "Ожидаемый результат: вы контролируете сценарий демонстрации, а поток данных с датчиков не прерывается.",
    };
  }

  if ((actuators.exhaust || actuators.windowLeft || actuators.windowRight) && snapshot.metrics.co2Ppm > co2Range[1]) {
    return {
      title: "Система заметила, что воздуху не хватает свежести.",
      observation: "Концентрация CO2 вышла выше выбранного диапазона и начала ухудшать качество воздуха.",
      action: "Поэтому алгоритм усиливает проветривание и включает вытяжку, чтобы быстрее вернуть комнату в рабочую зону.",
      effect: "Ожидаемый результат: воздух станет свежее, а уровень CO2 начнет плавно снижаться.",
    };
  }

  if (actuators.heater && snapshot.metrics.temperatureC < temperatureRange[0]) {
    return {
      title: "Система заметила, что в помещении становится прохладно.",
      observation: "Температура ушла ниже заданного коридора и может вывести микроклимат из комфортного состояния.",
      action: "Алгоритм включает нагреватель и мягко возвращает температуру к целевому уровню.",
      effect: "Ожидаемый результат: в комнате станет теплее без резких скачков среды.",
    };
  }

  if (actuators.airConditioner && snapshot.metrics.temperatureC > temperatureRange[1]) {
    return {
      title: "Система заметила перегрев помещения.",
      observation: "Температура поднялась выше выбранной зоны и начала влиять на комфорт.",
      action: "Алгоритм включает охлаждение, чтобы вернуть помещение к целевому диапазону.",
      effect: "Ожидаемый результат: температура начнет снижаться плавно и без лишних переключений.",
    };
  }

  if (actuators.humidifier && snapshot.metrics.humidityPct < humidityRange[0]) {
    return {
      title: "Система заметила, что воздух стал слишком сухим.",
      observation: "Влажность опустилась ниже заданной зоны и требует мягкой коррекции.",
      action: "Поэтому включается увлажнитель, чтобы вернуть воздуху более комфортное состояние.",
      effect: "Ожидаемый результат: влажность поднимется, и микроклимат станет мягче для человека.",
    };
  }

  return {
    title: "Система удерживает помещение в спокойном режиме.",
    observation: "Основные показатели близки к комфортной зоне и не требуют резкого вмешательства.",
    action: "Оборудование работает только по необходимости и не создает лишних переключений.",
    effect: "Ожидаемый результат: комфорт сохраняется без лишнего шума и перепадов среды.",
  };
}

function getRelayStateLabel(value: boolean): string {
  return value ? "Включено" : "Выключено";
}

function getActuatorStateLabel(key: ActuatorKey, value: boolean): string {
  if (key === "windowLeft" || key === "windowRight") {
    return value ? "Открыто" : "Закрыто";
  }

  return getRelayStateLabel(value);
}

function getRelayButtonLabel(
  key: ActuatorKey,
  mode: ControlMode,
  enabled: boolean,
): string {
  if (mode === "auto") {
    return "Управляется автоматически";
  }

  if (key === "windowLeft" || key === "windowRight") {
    return enabled ? "Закрыть" : "Открыть";
  }

  return enabled ? "Выключить" : "Включить";
}

function getTargetValidationMessage(metric: MetricDefinition, range: TargetRangeDraft): string | null {
  const min = typeof range.min === "string" ? parseFloat(range.min) : range.min;
  const max = typeof range.max === "string" ? parseFloat(range.max) : range.max;

  if (Number.isNaN(min) || Number.isNaN(max) || range.min === "" || range.max === "") {
    return "Заполните оба поля.";
  }

  if (min >= max) {
    return "Нижняя граница должна быть меньше верхней.";
  }

  if (min < metric.min || max > metric.max) {
    return `Допустимый диапазон: ${metric.min}-${metric.max} ${metric.unit}.`;
  }

  return null;
}

export function DashboardPreview({
  history,
  historyLimit,
  snapshot,
  onActuatorsChange,
  onModeChange,
  onTargetsSave,
}: DashboardPreviewProps) {
  const [mode, setMode] = useState<ControlMode>(snapshot.control.mode);
  const [actuators, setActuators] = useState<ActuatorState>(snapshot.actuators);
  const [isActuatorsSubmitting, setIsActuatorsSubmitting] = useState(false);
  const [targetDraft, setTargetDraft] = useState<TargetDraft>(() => buildTargetDraft(snapshot));
  const [isModeSubmitting, setIsModeSubmitting] = useState(false);
  const [isTargetsSubmitting, setIsTargetsSubmitting] = useState(false);
  const [isTargetsDirty, setIsTargetsDirty] = useState(false);
  const [actuatorsNotice, setActuatorsNotice] = useState<string | null>(null);
  const [modeNotice, setModeNotice] = useState<string | null>(null);
  const [targetsNotice, setTargetsNotice] = useState<string | null>(null);
  const [actuatorsError, setActuatorsError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [targetsError, setTargetsError] = useState<string | null>(null);

  const relayEntries = Object.entries(actuators) as [ActuatorKey, boolean][];
  const insight = getInsightContent(mode, snapshot, actuators);
  const hasTargetErrors = METRIC_DEFINITIONS.some((metric) => {
    const range = targetDraft[metric.key];
    return getTargetValidationMessage(metric, range) !== null;
  });

  useEffect(() => {
    if (!isModeSubmitting) {
      setMode(snapshot.control.mode);
    }
  }, [isModeSubmitting, snapshot.control.mode]);

  useEffect(() => {
    if (!isActuatorsSubmitting) {
      setActuators(snapshot.actuators);
    }
  }, [isActuatorsSubmitting, snapshot.actuators]);

  useEffect(() => {
    if (!isTargetsDirty && !isTargetsSubmitting) {
      setTargetDraft(buildTargetDraft(snapshot));
    }
  }, [isTargetsDirty, isTargetsSubmitting, snapshot]);

  async function toggleActuator(key: ActuatorKey) {
    if (mode !== "manual" || isActuatorsSubmitting || isModeSubmitting) {
      return;
    }

    const previousActuators = actuators;
    const nextActuators = {
      ...actuators,
      [key]: !actuators[key],
    };

    setActuators(nextActuators);
    setIsActuatorsSubmitting(true);
    setActuatorsNotice(null);
    setActuatorsError(null);

    try {
      const mqttPublished = await onActuatorsChange(nextActuators);
      setActuatorsNotice(
        mqttPublished
          ? "Состояние оборудования отправлено на сервер."
          : "Состояние на панели обновлено, но команда в MQTT не отправлена.",
      );
    } catch {
      setActuators(previousActuators);
      setActuatorsError("Не удалось отправить состояние оборудования.");
    } finally {
      setIsActuatorsSubmitting(false);
    }
  }

  async function handleModeSwitch(nextMode: ControlMode) {
    if (nextMode === mode || isModeSubmitting) {
      return;
    }

    const previousMode = mode;
    setMode(nextMode);
    setIsModeSubmitting(true);
    setModeError(null);

    try {
      const mqttPublished = await onModeChange(nextMode);
      setModeNotice(
        nextMode === "manual"
          ? mqttPublished
            ? "Ручной режим активен. Автоматические команды больше не переключают оборудование."
            : "Ручной режим включен локально, но сообщение в MQTT не было отправлено."
          : mqttPublished
            ? "Автоматический режим снова активен. Алгоритм может управлять оборудованием."
            : "Режим на панели изменен, но сообщение в MQTT не было отправлено.",
      );
    } catch {
      setMode(previousMode);
      setModeError("Не удалось переключить режим.");
    } finally {
      setIsModeSubmitting(false);
    }
  }

  function updateTargetDraftValue(metricKey: MetricKey, bound: keyof TargetRangeDraft, value: string) {
    setTargetDraft((current) => ({
      ...current,
      [metricKey]: {
        ...current[metricKey],
        [bound]: value,
      },
    }));
    setIsTargetsDirty(true);
    setTargetsNotice(null);
    setTargetsError(null);
  }

  async function saveTargets() {
    if (isTargetsSubmitting || !isTargetsDirty || hasTargetErrors) {
      return;
    }

    setIsTargetsSubmitting(true);
    setTargetsError(null);

    const validTargets = METRIC_DEFINITIONS.reduce((acc, metric) => {
      acc[metric.key] = {
        min: Number(targetDraft[metric.key].min),
        max: Number(targetDraft[metric.key].max),
      };
      return acc;
    }, {} as ClimateTargets);

    try {
      const mqttPublished = await onTargetsSave(validTargets);
      setIsTargetsDirty(false);
      setTargetsNotice(
        mqttPublished
          ? "Новые диапазоны отправлены в систему."
          : "Диапазоны сохранены на панели, но сообщение в MQTT не было отправлено.",
      );
    } catch {
      setTargetsError("Не удалось отправить новые диапазоны.");
    } finally {
      setIsTargetsSubmitting(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-section section-reveal">
        <div className="hero-copy-block">
          <p className="eyebrow">Smart Climate Control</p>
          <h1>Комфортный микроклимат под контролем системы</h1>
        </div>

        <aside className="hero-summary-card">
          <p className="panel-label">Состояние помещения</p>
          <h2>{getComfortSummary(snapshot)}</h2>

          <div className="summary-meta">
            <div>
              <span>Режим работы</span>
              <strong>{getModeLabel(mode)}</strong>
            </div>
            <div>
              <span>Активные системы</span>
              <strong>{getActiveSystems(actuators)}</strong>
            </div>
            <div>
              <span>Последнее обновление</span>
              <strong>{formatTimestamp(snapshot.timestamp)}</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="metrics-grid section-reveal">
        {METRIC_DEFINITIONS.map((metric) => {
          const comfortRange = getSavedComfortRange(snapshot, metric.key, metric.comfort);
          const value = snapshot.metrics[metric.key];
          const status = getMetricStatus(value, metric.min, metric.max, comfortRange);
          const comfortStart = toPercent(comfortRange[0], metric.min, metric.max);
          const comfortEnd = toPercent(comfortRange[1], metric.min, metric.max);
          const scaleStyle: ScaleStyle = {
            "--comfort-start": `${comfortStart}%`,
            "--comfort-width": `${comfortEnd - comfortStart}%`,
            "--marker-position": `${toPercent(value, metric.min, metric.max)}%`,
          };

          return (
            <article className={`metric-card metric-card-${metric.theme}`} key={metric.key}>
              <div className="metric-card-head">
                <span className="tile-label">{metric.label}</span>
                <span className={`metric-state metric-state-${status.tone}`}>{status.label}</span>
              </div>

              <div className="metric-value-stack">
                <strong>
                  {formatMetricValue(value, metric.precision)}
                  <span>{metric.unit}</span>
                </strong>
                <p>{metric.description}</p>
              </div>

              <div className="scale-panel">
                <div className="scale-track" style={scaleStyle}>
                  <span className="scale-comfort-band" />
                  <span className={`scale-marker scale-marker-${status.tone}`} />
                </div>

                <div className="scale-legend">
                  <span>
                    {metric.min}
                    {metric.unit}
                  </span>
                  <span>
                    Комфорт {comfortRange[0]}-{comfortRange[1]}
                    {metric.unit}
                  </span>
                  <span>
                    {metric.max}
                    {metric.unit}
                  </span>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="history-panel section-reveal">
        <div className="panel-toolbar">
          <div className="section-head-copy">
            <p className="panel-label">Динамика среды</p>
            <h2>Как меняются температура, влажность и CO2 внутри помещения.</h2>
          </div>

          <span className="status-pill status-pill-live">Скользящее окно {historyLimit} точек</span>
        </div>

        <p className="panel-note">
          Графики строятся по входной телеметрии, хранят последние {historyLimit}{" "}
          {getMeasurementLabel(historyLimit)}.
        </p>

        <div className="history-grid">
          {METRIC_DEFINITIONS.map((metric) => {
            const chart = buildHistoryChart(history, metric);
            const trend = getHistoryTrend(history, metric);
            const palette = HISTORY_PALETTES[metric.key];
            const gradientId = `history-gradient-${metric.key}`;

            return (
              <article className={`history-card history-card-${metric.theme}`} key={`history-${metric.key}`}>
                <div className="history-card-head">
                  <div>
                    <span className="tile-label">{metric.label}</span>
                    <strong className="history-current-value">
                      {formatMetricValue(chart.currentValue, metric.precision)}
                      <span>{metric.unit}</span>
                    </strong>
                  </div>

                  <span className={`history-trend history-trend-${trend.tone}`}>{trend.label}</span>
                </div>

                <div className="history-chart-shell">
                  <svg
                    aria-hidden="true"
                    className="history-chart-svg"
                    viewBox={`0 0 ${HISTORY_CHART_WIDTH} ${HISTORY_CHART_HEIGHT}`}
                  >
                    <defs>
                      <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={palette.line} stopOpacity="0.32" />
                        <stop offset="100%" stopColor={palette.line} stopOpacity="0.03" />
                      </linearGradient>
                    </defs>

                    {[0.2, 0.5, 0.8].map((offset) => (
                      <line
                        className="history-grid-line"
                        key={offset}
                        x1={HISTORY_CHART_PADDING_X}
                        x2={HISTORY_CHART_WIDTH - HISTORY_CHART_PADDING_X}
                        y1={HISTORY_CHART_HEIGHT * offset}
                        y2={HISTORY_CHART_HEIGHT * offset}
                      />
                    ))}

                    <path d={chart.areaPath} fill={`url(#${gradientId})`} />
                    <path
                      d={chart.linePath}
                      fill="none"
                      stroke={palette.line}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="4"
                    />
                    <circle cx={chart.lastX} cy={chart.lastY} fill={palette.line} r="5.5" />
                  </svg>
                </div>

                <div className="history-card-footer">
                  <div className="history-stat">
                    <span>Мин</span>
                    <strong>
                      {formatMetricValue(chart.minValue, metric.precision)}
                      {metric.unit}
                    </strong>
                  </div>

                  <div className="history-stat">
                    <span>Макс</span>
                    <strong>
                      {formatMetricValue(chart.maxValue, metric.precision)}
                      {metric.unit}
                    </strong>
                  </div>

                  <div className="history-stat">
                    <span>Период</span>
                    <strong>
                      {chart.startLabel || "сейчас"} - {chart.endLabel || "сейчас"}
                    </strong>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="targets-panel section-reveal">
        <div className="panel-toolbar">
          <div className="section-head-copy">
            <p className="panel-label">Целевая зона комфорта</p>
            <h2>Диапазон, внутри которого система должна удерживать среду.</h2>
          </div>

          <button
            className="primary-action"
            disabled={isTargetsSubmitting || !isTargetsDirty || hasTargetErrors}
            onClick={() => {
              void saveTargets();
            }}
            type="button"
          >
            {isTargetsSubmitting ? "Отправляем..." : "Применить диапазоны"}
          </button>
        </div>

        <p className="panel-note">
          Эти границы становятся ориентиром для автоматического режима и отправляются в ML-модуль
          как новая целевая зона.
        </p>

        <div className="target-grid">
          {METRIC_DEFINITIONS.map((metric) => {
            const range = targetDraft[metric.key];
            const validationMessage = getTargetValidationMessage(metric, range);
            
            const parsedMin = typeof range.min === "string" ? parseFloat(range.min) : range.min;
            const parsedMax = typeof range.max === "string" ? parseFloat(range.max) : range.max;

            const comfortStart = toPercent(Number.isNaN(parsedMin) ? metric.min : parsedMin, metric.min, metric.max);
            const comfortEnd = toPercent(Number.isNaN(parsedMax) ? metric.max : parsedMax, metric.min, metric.max);
            
            const targetScaleStyle: ScaleStyle = {
              "--comfort-start": `${comfortStart}%`,
              "--comfort-width": `${comfortEnd - comfortStart}%`,
              "--marker-position": `${toPercent(snapshot.metrics[metric.key], metric.min, metric.max)}%`,
            };

            return (
              <article className="target-card" key={metric.key}>
                <div className="target-card-head">
                  <span className="tile-label">{metric.label}</span>
                  <strong>
                    {formatRangeValue(range.min, metric.precision)}-{formatRangeValue(range.max, metric.precision)}
                    <span>{metric.unit}</span>
                  </strong>
                </div>

                <p>{metric.description}</p>

                <div className="range-fields">
                  <label>
                    <span>От</span>
                    <input
                      max={metric.max}
                      min={metric.min}
                      onChange={(event) => {
                        updateTargetDraftValue(metric.key, "min", event.target.value);
                      }}
                      step={metric.step}
                      type="number"
                      value={range.min}
                    />
                  </label>

                  <label>
                    <span>До</span>
                    <input
                      max={metric.max}
                      min={metric.min}
                      onChange={(event) => {
                        updateTargetDraftValue(metric.key, "max", event.target.value);
                      }}
                      step={metric.step}
                      type="number"
                      value={range.max}
                    />
                  </label>
                </div>

                <div className="target-track" style={targetScaleStyle}>
                  <span className="scale-comfort-band" />
                  <span className="scale-marker scale-marker-comfort" />
                </div>

                <span className={`target-hint ${validationMessage === null ? "" : "target-hint-error"}`}>
                  {validationMessage ?? `Допустимая шкала: ${metric.min}-${metric.max} ${metric.unit}.`}
                </span>
              </article>
            );
          })}
        </div>

        {(targetsNotice !== null || targetsError !== null) && (
          <div className="status-line">
            {targetsNotice !== null ? <span className="status-pill status-pill-live">{targetsNotice}</span> : null}
            {targetsError !== null ? <span className="status-pill status-pill-error">{targetsError}</span> : null}
          </div>
        )}
      </section>

      <section className="control-panel section-reveal">
        <div className="control-panel-head">
          <div className="section-head-copy">
            <p className="panel-label">Управление оборудованием</p>
            <h2>Режим работы</h2>
          </div>

          <div className="mode-switch" role="tablist" aria-label="Режим работы">
            <button
              className={mode === "auto" ? "is-active" : ""}
              disabled={isModeSubmitting || isActuatorsSubmitting}
              onClick={() => {
                void handleModeSwitch("auto");
              }}
              type="button"
            >
              Авто
            </button>
            <button
              className={mode === "manual" ? "is-active" : ""}
              disabled={isModeSubmitting || isActuatorsSubmitting}
              onClick={() => {
                void handleModeSwitch("manual");
              }}
              type="button"
            >
              Ручной
            </button>
          </div>
        </div>

        <p className="control-copy">{getModeSummary(mode)}</p>

        {(modeNotice !== null || modeError !== null) && (
          <div className="status-line">
            {modeNotice !== null ? <span className="status-pill status-pill-live">{modeNotice}</span> : null}
            {modeError !== null ? <span className="status-pill status-pill-error">{modeError}</span> : null}
          </div>
        )}

        <div className="actuator-grid">
          {relayEntries.map(([key, enabled]) => (
            <article className="actuator-card" key={key}>
              <div className="actuator-card-head">
                <div>
                  <span className="tile-label">{ACTUATOR_LABELS[key]}</span>
                  <strong>{getActuatorStateLabel(key, enabled)}</strong>
                </div>
                <span className={`relay-dot ${enabled ? "relay-dot-on" : "relay-dot-off"}`} />
              </div>

              <p>{ACTUATOR_DESCRIPTIONS[key]}</p>

              <button
                className={`actuator-button ${enabled ? "actuator-button-on" : "actuator-button-off"}`}
                disabled={mode !== "manual" || isModeSubmitting || isActuatorsSubmitting}
                onClick={() => {
                  void toggleActuator(key);
                }}
                type="button"
              >
                {getRelayButtonLabel(key, mode, enabled)}
              </button>
            </article>
          ))}
        </div>

        {(actuatorsNotice !== null || actuatorsError !== null) && (
          <div className="status-line">
            {actuatorsNotice !== null ? <span className="status-pill status-pill-live">{actuatorsNotice}</span> : null}
            {actuatorsError !== null ? <span className="status-pill status-pill-error">{actuatorsError}</span> : null}
          </div>
        )}
      </section>

      <section className="insight-panel section-reveal">
        <p className="panel-label">Почему система так поступила</p>
        <h2>{insight.title}</h2>
        <p className="insight-lead">{insight.observation}</p>

        <div className="insight-grid">
          <article className="insight-card">
            <span>Что заметила система</span>
            <p>{insight.observation}</p>
          </article>
          <article className="insight-card">
            <span>Что она делает</span>
            <p>{insight.action}</p>
          </article>
          <article className="insight-card insight-card-wide">
            <span>Какой результат ожидается</span>
            <p>{insight.effect}</p>
          </article>
        </div>
      </section>

      <section className="setup-panel section-reveal">
        <div className="setup-copy-block">
          <p className="panel-label">Подготовка комплекта</p>
          <h2>Настройте обе платы через USB перед первым запуском системы.</h2>
          <div className="setup-callout">
            <strong>Что потребуется</strong>
            <p>
              Две платы ESP32, USB-кабель, доступ к вашей Wi-Fi сети и локальная утилита
              <code> ESP32Configurator.exe</code>, которая идет в составе комплекта.
            </p>
          </div>

          <div className="setup-steps">
            <div className="setup-step">
              <strong>1</strong>
              <p>Подключите первую плату к ноутбуку по USB и запустите ESP32 Configurator.</p>
            </div>
            <div className="setup-step">
              <strong>2</strong>
              <p>Выберите COM-порт, заполните Wi-Fi, device ID и адрес брокера, затем отправьте настройки в устройство.</p>
            </div>
            <div className="setup-step">
              <strong>3</strong>
              <p>После подтверждения повторите те же действия для второй платы и только потом подключайте комплект к стенду.</p>
            </div>
          </div>
        </div>

        <div className="download-grid">
          <article className="download-card">
            <span>Windows</span>
            <h3>ESP32 Configurator</h3>
            <p>Локальная утилита для первичной настройки платы через USB без ручного редактирования файлов.</p>
            <a className="download-button" download href="/downloads/ESP32Configurator.exe">
              Скачать .exe
            </a>
          </article>

          <article className="download-card">
            <span>Инструкция</span>
            <h3>Памятка по настройке</h3>
            <p>Пошаговое описание процесса для пользователя: подключение, ввод параметров и настройка обеих плат.</p>
            <a className="download-button download-button-secondary" download href="/downloads/esp32-setup-guide.txt">
              Скачать инструкцию
            </a>
          </article>

        </div>
      </section>
    </main>
  );
}
