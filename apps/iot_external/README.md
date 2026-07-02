# IoT Climate Control Demo

Демонстрационный проект для курсовой по управлению микроклиматом помещения.

## Структура

```text
frontend/   React + TypeScript + Vite интерфейс
backend/    Flask API и MQTT-мост
simulator/  Python-скрипт генерации телеметрии
docs/       Архитектура, JSON-контракты, конфиг устройств
esp32/      Шаблон конфигурации для ESP32
```

## Текущие MQTT-топики

- `iot_proj/sensors`: входящая телеметрия от сенсоров
- `iot_proj/actions`: входящие действия ML-агента
- `iot_proj/targets`: исходящие диапазоны комфорта с сайта
- `iot_proj/mode`: исходящий режим `auto/manual` с сайта

По умолчанию backend смотрит на брокер:

- host: `172.16.22.140`
- port: `1883`

## Переменные окружения backend

```powershell
$env:MQTT_HOST='172.16.22.140'
$env:MQTT_PORT='1883'
$env:MQTT_SENSOR_TOPIC='iot_proj/sensors'
$env:MQTT_ACTION_TOPIC='iot_proj/actions'
$env:MQTT_TARGET_TOPIC='iot_proj/targets'
$env:MQTT_MODE_TOPIC='iot_proj/mode'
python run.py
```

## Полезные файлы

- `docs/data-format.md` — JSON-контракты и формат обмена
- `docs/device-config.md` — что означает конфигурация для ESP32
- `esp32/room-node.config.example.json` — шаблон настроек устройства

## Проверка

Запуск и проверка в этой итерации не выполнялись.
