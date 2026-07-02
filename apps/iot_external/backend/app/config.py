import os


def _env_bool(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    APP_NAME = "IoT Climate Control Demo API"
    CORS_ORIGINS = ["http://localhost:5173"]
    MQTT_ENABLED = _env_bool("MQTT_ENABLED", True)
    MQTT_HOST = os.getenv("MQTT_HOST", "172.16.22.117")
    MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
    MQTT_KEEPALIVE = int(os.getenv("MQTT_KEEPALIVE", "60"))
    MQTT_SENSOR_TOPIC = os.getenv("MQTT_SENSOR_TOPIC", "iot_proj/sensors")
    MQTT_ACTION_TOPIC = os.getenv("MQTT_ACTION_TOPIC", "iot_proj/actions")
    MQTT_TARGET_TOPIC = os.getenv("MQTT_TARGET_TOPIC", "iot_proj/targets")
    MQTT_MODE_TOPIC = os.getenv("MQTT_MODE_TOPIC", "iot_proj/mode")
