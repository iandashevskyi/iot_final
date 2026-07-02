from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
from threading import Lock
from typing import Any


ACTUATOR_KEYS = (
    "heater",
    "airConditioner",
    "humidifier",
    "windowLeft",
    "windowRight",
    "exhaust",
)

TARGET_DEFAULTS = {
    "temperatureC": {
        "min": 21.0,
        "max": 24.0,
    },
    "humidityPct": {
        "min": 40.0,
        "max": 60.0,
    },
    "co2Ppm": {
        "min": 450.0,
        "max": 800.0,
    },
}

TARGET_LIMITS = {
    "temperatureC": (16.0, 30.0),
    "humidityPct": (20.0, 70.0),
    "co2Ppm": (400.0, 1600.0),
}

LOGGER = logging.getLogger(__name__)
SNAPSHOT_STATE_PATH = Path(__file__).resolve().parents[1] / ".runtime" / "snapshot.json"


class SnapshotValidationError(ValueError):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_default_snapshot() -> dict[str, Any]:
    return {
        "deviceId": "mqtt-room-bridge",
        "timestamp": _utc_now(),
        "metrics": {
            "temperatureC": 23.4,
            "humidityPct": 45.8,
            "co2Ppm": 718,
        },
        "outsideMetrics": {
            "temperatureC": 12.0,
            "humidityPct": 56.0,
            "co2Ppm": 400.0,
        },
        "actuators": {
            "heater": False,
            "airConditioner": False,
            "humidifier": False,
            "windowLeft": False,
            "windowRight": False,
            "exhaust": False,
        },
        "control": {
            "mode": "auto",
            "controller": "ml-agent",
        },
        "rl": {
            "reward": 0.0,
            "confidence": 0.0,
            "targetZone": "comfort",
        },
        "targets": deepcopy(TARGET_DEFAULTS),
        "mqtt": {
            "sensorTopic": "iot_proj/sensors",
            "actionTopic": "iot_proj/actions",
            "targetTopic": "iot_proj/targets",
            "modeTopic": "iot_proj/mode",
            "lastActionCode": 0,
        },
    }


def _compose_snapshot(
    snapshot: dict[str, Any],
    *,
    base_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    merged_snapshot = deepcopy(base_snapshot) if base_snapshot is not None else build_default_snapshot()
    merged_snapshot["deviceId"] = snapshot["deviceId"]
    merged_snapshot["timestamp"] = snapshot["timestamp"]
    merged_snapshot["metrics"] = deepcopy(snapshot["metrics"])
    merged_snapshot["actuators"] = deepcopy(snapshot["actuators"])
    merged_snapshot["control"] = deepcopy(snapshot["control"])
    merged_snapshot["rl"] = deepcopy(snapshot["rl"])

    if "outsideMetrics" in snapshot:
        merged_snapshot["outsideMetrics"] = deepcopy(snapshot["outsideMetrics"])

    if "targets" in snapshot:
        merged_snapshot["targets"] = deepcopy(snapshot["targets"])

    if "mqtt" in snapshot and isinstance(snapshot["mqtt"], dict):
        merged_snapshot.setdefault("mqtt", {})
        merged_snapshot["mqtt"].update(deepcopy(snapshot["mqtt"]))

    return merged_snapshot


def _load_persisted_snapshot() -> dict[str, Any]:
    if not SNAPSHOT_STATE_PATH.exists():
        return build_default_snapshot()

    try:
        raw_payload = SNAPSHOT_STATE_PATH.read_text(encoding="utf-8")
        parsed_payload = json.loads(raw_payload)
        if not isinstance(parsed_payload, dict):
            raise SnapshotValidationError("Persisted snapshot must be a JSON object")

        return _compose_snapshot(normalize_snapshot(parsed_payload))
    except (OSError, json.JSONDecodeError, SnapshotValidationError) as exc:
        LOGGER.warning("Failed to restore snapshot from %s: %s", SNAPSHOT_STATE_PATH, exc)
        return build_default_snapshot()


def decode_action_code(action_code: int) -> dict[str, bool]:
    if action_code < 0 or action_code > 63:
        raise SnapshotValidationError("Field 'action' must be between 0 and 63")

    return {
        "heater": bool(action_code & (1 << 0)),
        "airConditioner": bool(action_code & (1 << 1)),
        "humidifier": bool(action_code & (1 << 2)),
        "windowLeft": bool(action_code & (1 << 3)),
        "windowRight": bool(action_code & (1 << 4)),
        "exhaust": bool(action_code & (1 << 5)),
    }


def _normalize_actuators(
    payload: Any,
    field_name: str = "actuators",
) -> dict[str, bool]:
    actuator_mapping = _require_mapping(payload, field_name)
    return {key: _require_bool(actuator_mapping, key) for key in ACTUATOR_KEYS}


def encode_action_state(actuators: dict[str, bool]) -> int:
    action_code = 0

    for bit, key in enumerate(ACTUATOR_KEYS):
        if actuators[key]:
            action_code |= 1 << bit

    return action_code


def _require_mapping(payload: Any, field_name: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise SnapshotValidationError(f"Field '{field_name}' must be an object")
    return payload


def _require_number(payload: dict[str, Any], field_name: str) -> float:
    value = payload.get(field_name)
    if not isinstance(value, (int, float)):
        raise SnapshotValidationError(f"Field '{field_name}' must be numeric")
    return float(value)


def _require_bool(payload: dict[str, Any], field_name: str) -> bool:
    value = payload.get(field_name)
    if not isinstance(value, bool):
        raise SnapshotValidationError(f"Field '{field_name}' must be boolean")
    return value


def _normalize_targets(payload: Any) -> dict[str, dict[str, float]] | None:
    if payload is None:
        return None

    if not isinstance(payload, dict):
        raise SnapshotValidationError("Field 'targets' must be an object")

    targets: dict[str, dict[str, float]] = {}

    for metric_key in ("temperatureC", "humidityPct", "co2Ppm"):
        target = payload.get(metric_key)
        if target is None:
            continue

        target_mapping = _require_mapping(target, f"targets.{metric_key}")
        min_value = target_mapping.get("min")
        max_value = target_mapping.get("max")

        if not isinstance(min_value, (int, float)) or not isinstance(max_value, (int, float)):
            raise SnapshotValidationError(
                f"Fields 'targets.{metric_key}.min' and 'targets.{metric_key}.max' must be numeric"
            )

        min_value = float(min_value)
        max_value = float(max_value)
        absolute_min, absolute_max = TARGET_LIMITS[metric_key]

        if min_value >= max_value:
            raise SnapshotValidationError(
                f"Field 'targets.{metric_key}' must have min lower than max"
            )

        if min_value < absolute_min or max_value > absolute_max:
            raise SnapshotValidationError(
                f"Field 'targets.{metric_key}' must stay within {absolute_min}..{absolute_max}"
            )

        targets[metric_key] = {
            "min": min_value,
            "max": max_value,
        }

    return targets or None


def normalize_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise SnapshotValidationError("Snapshot payload must be an object")

    device_id = payload.get("deviceId")
    if not isinstance(device_id, str) or not device_id.strip():
        raise SnapshotValidationError("Field 'deviceId' must be a non-empty string")

    timestamp = payload.get("timestamp")
    if not isinstance(timestamp, str) or not timestamp.strip():
        raise SnapshotValidationError("Field 'timestamp' must be a non-empty string")

    metrics = _require_mapping(payload.get("metrics"), "metrics")
    outside_metrics = payload.get("outsideMetrics")
    actuators = _normalize_actuators(payload.get("actuators"), "actuators")
    control = _require_mapping(payload.get("control"), "control")
    rl = _require_mapping(payload.get("rl"), "rl")
    targets = _normalize_targets(payload.get("targets"))

    mode = control.get("mode")
    if mode not in {"auto", "manual"}:
        raise SnapshotValidationError("Field 'control.mode' must be 'auto' or 'manual'")

    controller = control.get("controller")
    if not isinstance(controller, str) or not controller.strip():
        raise SnapshotValidationError("Field 'control.controller' must be a non-empty string")

    target_zone = rl.get("targetZone")
    if not isinstance(target_zone, str) or not target_zone.strip():
        raise SnapshotValidationError("Field 'rl.targetZone' must be a non-empty string")

    normalized_snapshot: dict[str, Any] = {
        "deviceId": device_id.strip(),
        "timestamp": timestamp.strip(),
        "metrics": {
            "temperatureC": round(_require_number(metrics, "temperatureC"), 1),
            "humidityPct": round(_require_number(metrics, "humidityPct"), 1),
            "co2Ppm": round(_require_number(metrics, "co2Ppm"), 1),
        },
        "actuators": actuators,
        "control": {
            "mode": mode,
            "controller": controller.strip(),
        },
        "rl": {
            "reward": round(_require_number(rl, "reward"), 2),
            "confidence": round(_require_number(rl, "confidence"), 2),
            "targetZone": target_zone.strip(),
        },
    }

    if outside_metrics is not None:
        outside_mapping = _require_mapping(outside_metrics, "outsideMetrics")
        normalized_snapshot["outsideMetrics"] = {
            "temperatureC": round(_require_number(outside_mapping, "temperatureC"), 1),
            "humidityPct": round(_require_number(outside_mapping, "humidityPct"), 1),
            "co2Ppm": round(_require_number(outside_mapping, "co2Ppm"), 1),
        }

    if targets is not None:
        normalized_snapshot["targets"] = targets

    mqtt_payload = payload.get("mqtt")
    if isinstance(mqtt_payload, dict):
        normalized_snapshot["mqtt"] = deepcopy(mqtt_payload)

    return normalized_snapshot


class SnapshotStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._snapshot = _load_persisted_snapshot()

    def _persist_snapshot_locked(self) -> None:
        try:
            SNAPSHOT_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
            temp_path = SNAPSHOT_STATE_PATH.with_suffix(".tmp")
            temp_path.write_text(json.dumps(self._snapshot, ensure_ascii=False), encoding="utf-8")
            temp_path.replace(SNAPSHOT_STATE_PATH)
        except OSError as exc:
            LOGGER.warning("Failed to persist snapshot to %s: %s", SNAPSHOT_STATE_PATH, exc)

    def get_snapshot(self) -> dict[str, Any]:
        with self._lock:
            return deepcopy(self._snapshot)

    def update_snapshot(self, payload: dict[str, Any]) -> dict[str, Any]:
        normalized_snapshot = normalize_snapshot(payload)
        with self._lock:
            self._snapshot = _compose_snapshot(normalized_snapshot, base_snapshot=self._snapshot)
            self._persist_snapshot_locked()
            return deepcopy(self._snapshot)

    def get_control_mode(self) -> str:
        with self._lock:
            return str(self._snapshot["control"]["mode"])

    def set_mqtt_details(
        self,
        *,
        sensor_topic: str,
        action_topic: str,
        target_topic: str,
        mode_topic: str,
    ) -> dict[str, Any]:
        with self._lock:
            self._snapshot.setdefault("mqtt", {})
            self._snapshot["mqtt"]["sensorTopic"] = sensor_topic
            self._snapshot["mqtt"]["actionTopic"] = action_topic
            self._snapshot["mqtt"]["targetTopic"] = target_topic
            self._snapshot["mqtt"]["modeTopic"] = mode_topic
            self._persist_snapshot_locked()
            return deepcopy(self._snapshot)

    def apply_sensor_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise SnapshotValidationError("Sensor payload must be an object")

        with self._lock:
            self._snapshot["timestamp"] = _utc_now()
            
            if "in_temp" in payload:
                self._snapshot["metrics"]["temperatureC"] = round(_require_number(payload, "in_temp"), 1)
            if "in_hum" in payload:
                self._snapshot["metrics"]["humidityPct"] = round(_require_number(payload, "in_hum"), 1)
            if "in_co2" in payload:
                self._snapshot["metrics"]["co2Ppm"] = round(_require_number(payload, "in_co2"), 1)
                
            if "out_temp" in payload:
                self._snapshot["outsideMetrics"]["temperatureC"] = round(_require_number(payload, "out_temp"), 1)
            if "out_hum" in payload:
                self._snapshot["outsideMetrics"]["humidityPct"] = round(_require_number(payload, "out_hum"), 1)
            if "out_co2" in payload:
                self._snapshot["outsideMetrics"]["co2Ppm"] = round(_require_number(payload, "out_co2"), 1)
            self._persist_snapshot_locked()
            return deepcopy(self._snapshot)

    def apply_action_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise SnapshotValidationError("Action payload must be an object")

        action_value = payload.get("action")
        if not isinstance(action_value, int):
            raise SnapshotValidationError("Field 'action' must be an integer")

        actuators = decode_action_code(action_value)

        with self._lock:
            self._snapshot["timestamp"] = _utc_now()
            self._snapshot["actuators"] = actuators
            self._snapshot["control"]["mode"] = "auto"
            self._snapshot["control"]["controller"] = "ml-agent"
            self._snapshot.setdefault("mqtt", {})
            self._snapshot["mqtt"]["lastActionCode"] = action_value
            self._persist_snapshot_locked()
            return deepcopy(self._snapshot)

    def apply_control_mode(self, mode: Any) -> dict[str, Any]:
        if not isinstance(mode, str) or mode not in {"auto", "manual"}:
            raise SnapshotValidationError("Field 'mode' must be 'auto' or 'manual'")

        with self._lock:
            self._snapshot["timestamp"] = _utc_now()
            self._snapshot["control"]["mode"] = mode
            self._snapshot["control"]["controller"] = "ml-agent" if mode == "auto" else "operator"
            self._persist_snapshot_locked()
            return deepcopy(self._snapshot)

    def apply_manual_actuators_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        actuators = _normalize_actuators(payload, "actuators")
        action_value = encode_action_state(actuators)

        with self._lock:
            if self._snapshot["control"]["mode"] != "manual":
                raise SnapshotValidationError("Manual actuator control requires manual mode")

            self._snapshot["timestamp"] = _utc_now()
            self._snapshot["actuators"] = actuators
            self._snapshot["control"]["controller"] = "operator"
            self._snapshot.setdefault("mqtt", {})
            self._snapshot["mqtt"]["lastActionCode"] = action_value
            self._persist_snapshot_locked()
            return deepcopy(self._snapshot)

    def apply_targets_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        targets = _normalize_targets(payload)
        if targets is None:
            raise SnapshotValidationError("Targets payload must contain at least one metric")

        with self._lock:
            self._snapshot["timestamp"] = _utc_now()
            current_targets = deepcopy(self._snapshot.get("targets", TARGET_DEFAULTS))
            current_targets.update(targets)
            self._snapshot["targets"] = current_targets
            self._persist_snapshot_locked()
            return deepcopy(self._snapshot)


snapshot_store = SnapshotStore()
