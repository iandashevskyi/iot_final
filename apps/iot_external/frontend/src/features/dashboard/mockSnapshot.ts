import type { ClimateSnapshot } from "../../app/types";

export const mockSnapshot: ClimateSnapshot = {
  deviceId: "esp32-room-01",
  timestamp: "2026-06-18T12:00:00Z",
  metrics: {
    temperatureC: 23.6,
    humidityPct: 46.1,
    co2Ppm: 742,
  },
  outsideMetrics: {
    temperatureC: 12.0,
    humidityPct: 58.0,
    co2Ppm: 400.0,
  },
  actuators: {
    heater: false,
    airConditioner: false,
    humidifier: false,
    windowLeft: false,
    windowRight: true,
    exhaust: true,
  },
  control: {
    mode: "auto",
    controller: "rl-agent",
  },
  rl: {
    reward: 0.81,
    confidence: 0.74,
    targetZone: "comfort",
  },
  targets: {
    temperatureC: {
      min: 21.0,
      max: 24.0,
    },
    humidityPct: {
      min: 40.0,
      max: 60.0,
    },
    co2Ppm: {
      min: 450.0,
      max: 800.0,
    },
  },
  mqtt: {
    sensorTopic: "iot_proj/sensors",
    actionTopic: "iot_proj/actions",
    targetTopic: "iot_proj/targets",
    modeTopic: "iot_proj/mode",
    lastActionCode: 50,
  },
};
