export type ControlMode = "auto" | "manual";

export interface ClimateMetrics {
  temperatureC: number;
  humidityPct: number;
  co2Ppm: number;
}

export interface ClimateHistoryPoint {
  timestamp: string;
  metrics: ClimateMetrics;
}

export interface OutdoorMetrics {
  temperatureC: number;
  humidityPct: number;
  co2Ppm: number;
}

export interface ActuatorState {
  heater: boolean;
  airConditioner: boolean;
  humidifier: boolean;
  windowLeft: boolean;
  windowRight: boolean;
  exhaust: boolean;
}

export interface RlInfo {
  reward: number;
  confidence: number;
  targetZone: string;
}

export interface TargetRange {
  min: number;
  max: number;
}

export interface ClimateTargets {
  temperatureC?: TargetRange;
  humidityPct?: TargetRange;
  co2Ppm?: TargetRange;
}

export interface ClimateSnapshot {
  deviceId: string;
  timestamp: string;
  metrics: ClimateMetrics;
  outsideMetrics?: OutdoorMetrics;
  actuators: ActuatorState;
  control: {
    mode: ControlMode;
    controller: string;
  };
  rl: RlInfo;
  targets?: ClimateTargets;
  mqtt?: {
    sensorTopic?: string;
    actionTopic?: string;
    targetTopic?: string;
    modeTopic?: string;
    lastActionCode?: number;
  };
}
