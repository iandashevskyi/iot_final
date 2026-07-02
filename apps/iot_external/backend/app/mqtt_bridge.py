from __future__ import annotations

import json
import logging
from typing import Any

import paho.mqtt.client as mqtt

from .state import SnapshotValidationError, encode_action_state, snapshot_store

LOGGER = logging.getLogger(__name__)
_mqtt_bridge_started = False
_mqtt_client: mqtt.Client | None = None
_mqtt_enabled = True
_action_topic = "iot_proj/actions"
_mode_topic = "iot_proj/mode"
_target_topic = "iot_proj/targets"


def _safe_parse_payload(raw_payload: bytes) -> dict[str, Any] | None:
    try:
        payload = json.loads(raw_payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        LOGGER.warning("MQTT payload is not valid JSON")
        return None

    if not isinstance(payload, dict):
        LOGGER.warning("MQTT payload must be a JSON object")
        return None

    return payload


def _publish_json(topic: str, payload: dict[str, Any]) -> bool:
    if not _mqtt_enabled or _mqtt_client is None:
        LOGGER.warning("MQTT publish skipped because bridge is disabled or not initialized")
        return False

    message_info = _mqtt_client.publish(topic, json.dumps(payload, ensure_ascii=False))
    return message_info.rc == mqtt.MQTT_ERR_SUCCESS


def publish_mode_update(mode: str) -> bool:
    return _publish_json(_mode_topic, {"mode": mode})


def publish_targets_update(targets: dict[str, Any]) -> bool:
    return _publish_json(_target_topic, targets)


def publish_action_update(actuators: dict[str, bool]) -> bool:
    return _publish_json(_action_topic, {"action": encode_action_state(actuators)})


def start_mqtt_bridge(config: dict[str, Any]) -> None:
    global _mqtt_bridge_started, _mqtt_client, _mqtt_enabled, _action_topic, _mode_topic, _target_topic

    _mqtt_enabled = bool(config.get("MQTT_ENABLED", True))

    if _mqtt_bridge_started or not _mqtt_enabled:
        return

    sensor_topic = config["MQTT_SENSOR_TOPIC"]
    action_topic = config["MQTT_ACTION_TOPIC"]
    _action_topic = action_topic
    _target_topic = config["MQTT_TARGET_TOPIC"]
    _mode_topic = config["MQTT_MODE_TOPIC"]
    host = config["MQTT_HOST"]
    port = config["MQTT_PORT"]
    keepalive = config["MQTT_KEEPALIVE"]

    snapshot_store.set_mqtt_details(
        sensor_topic=sensor_topic,
        action_topic=action_topic,
        target_topic=_target_topic,
        mode_topic=_mode_topic,
    )

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.reconnect_delay_set(min_delay=1, max_delay=15)
    _mqtt_client = client

    def on_connect(
        mqtt_client: mqtt.Client,
        _userdata: Any,
        _flags: Any,
        reason_code: int,
        _properties: Any,
    ) -> None:
        if reason_code == 0:
            LOGGER.info("Connected to MQTT broker %s:%s", host, port)
            mqtt_client.subscribe(sensor_topic)
            mqtt_client.subscribe(action_topic)
            return

        LOGGER.warning("MQTT connection failed with code %s", reason_code)

    def on_disconnect(
        _mqtt_client: mqtt.Client,
        _userdata: Any,
        _disconnect_flags: Any,
        reason_code: int,
        _properties: Any,
    ) -> None:
        if reason_code != 0:
            LOGGER.warning("MQTT disconnected unexpectedly with code %s", reason_code)

    def on_message(
        _mqtt_client: mqtt.Client,
        _userdata: Any,
        message: mqtt.MQTTMessage,
    ) -> None:
        payload = _safe_parse_payload(message.payload)
        if payload is None:
            return

        try:
            if message.topic == sensor_topic:
                snapshot_store.apply_sensor_payload(payload)
            elif message.topic == action_topic:
                if snapshot_store.get_control_mode() == "manual":
                    LOGGER.info("Ignoring action payload because manual mode is active")
                    return
                snapshot_store.apply_action_payload(payload)
        except SnapshotValidationError as exc:
            LOGGER.warning("MQTT payload rejected: %s", exc)

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message
    client.connect_async(host, port, keepalive)
    client.loop_start()
    _mqtt_bridge_started = True
