# Конфигурация устройства

Под `SSID` и паролем здесь имеется в виду обычная Wi-Fi-настройка для `ESP32`.

## Что должно быть в конфиге

- `deviceId`: имя устройства в системе
- `wifi.ssid`: имя Wi-Fi сети
- `wifi.password`: пароль Wi-Fi сети
- `transport.type`: способ передачи данных
- `transport.brokerUrl`: адрес брокера, если используется MQTT по WebSocket
- `transport.telemetryTopic`: топик отправки показаний
- `transport.commandTopic`: топик получения управляющих действий
- `sampling.telemetryIntervalMs`: частота отправки телеметрии

## Актуальный шаблон

Файл лежит в:

- `esp32/room-node.config.example.json`

Текущий пример внутри шаблона:

```json
{
  "deviceId": "esp32-room-01",
  "wifi": {
    "ssid": "YOUR_WIFI_SSID",
    "password": "YOUR_WIFI_PASSWORD"
  },
  "transport": {
    "type": "mqtt_ws",
    "brokerUrl": "ws://172.16.22.140:1886",
    "telemetryTopic": "iot_proj/sensors",
    "commandTopic": "iot_proj/actions"
  },
  "sampling": {
    "telemetryIntervalMs": 5000
  }
}
```

## Если настройка идет не через JSON

Если инженер на месте скажет, что устройство принимает параметры через терминал или первичную консольную настройку, использовать нужно те же самые поля:

- имя сети
- пароль сети
- адрес брокера
- топик телеметрии
- топик команд

То есть JSON здесь нужен как понятный шаблон значений, а не как единственный возможный способ загрузки параметров в ESP32.
