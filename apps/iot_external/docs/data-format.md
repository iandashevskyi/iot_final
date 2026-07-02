# JSON-контракты и MQTT-топики

## 1. Входящие данные от ML и сенсоров

### Топик `iot_proj/sensors`

Используется для телеметрии по помещению и улице.

```json
{
  "in_temp": 26.4,
  "in_hum": 31.3,
  "in_co2": 723.2,
  "out_temp": 7.4,
  "out_hum": 59.8,
  "out_co2": 400.0
}
```

Поля `in_*` считаются показателями внутри помещения и отображаются на сайте как основные.

### Топик `iot_proj/actions`

Используется для решения, которое принимает ML-агент.

```json
{
  "action": 50
}
```

`action` — целое число в диапазоне `0..63`.

### Декодирование `action` в 6 реле

- `bit 0`: обогреватель
- `bit 1`: кондиционер
- `bit 2`: увлажнитель
- `bit 3`: окно 1
- `bit 4`: окно 2
- `bit 5`: вытяжка

Пример для `{"action": 50}`:

- обогреватель: `0`
- кондиционер: `1`
- увлажнитель: `0`
- окно 1: `0`
- окно 2: `1`
- вытяжка: `1`

## 2. Исходящие сообщения с сайта и backend

### Топик `iot_proj/targets`

Используется для передачи целевых диапазонов, которые пользователь выбирает на сайте.

```json
{
  "temperatureC": {
    "min": 21.0,
    "max": 24.0
  },
  "humidityPct": {
    "min": 40.0,
    "max": 60.0
  },
  "co2Ppm": {
    "min": 450.0,
    "max": 800.0
  }
}
```

Текущие ограничения на backend:

- `temperatureC`: `16..30`
- `humidityPct`: `20..70`
- `co2Ppm`: `400..1600`

Для каждого параметра `min` должен быть строго меньше `max`.

### Топик `iot_proj/mode`

Используется для переключения режима работы.

```json
{
  "mode": "manual"
}
```

Допустимые значения:

- `auto`
- `manual`

Когда сайт переводит систему в `manual`, backend перестает применять входящие сообщения из `iot_proj/actions`, но продолжает принимать телеметрию из `iot_proj/sensors`.

## 3. Снимок состояния для фронтенда

`GET /api/snapshot`

```json
{
  "snapshot": {
    "deviceId": "mqtt-room-bridge",
    "timestamp": "2026-06-22T12:00:00+00:00",
    "metrics": {
      "temperatureC": 23.6,
      "humidityPct": 41.2,
      "co2Ppm": 801.4
    },
    "outsideMetrics": {
      "temperatureC": -4.7,
      "humidityPct": 69.4,
      "co2Ppm": 400.0
    },
    "actuators": {
      "heater": false,
      "airConditioner": true,
      "humidifier": false,
      "windowLeft": false,
      "windowRight": true,
      "exhaust": true
    },
    "control": {
      "mode": "auto",
      "controller": "ml-agent"
    },
    "rl": {
      "reward": 0.0,
      "confidence": 0.0,
      "targetZone": "comfort"
    },
    "targets": {
      "temperatureC": {
        "min": 21.0,
        "max": 24.0
      },
      "humidityPct": {
        "min": 40.0,
        "max": 60.0
      },
      "co2Ppm": {
        "min": 450.0,
        "max": 800.0
      }
    },
    "mqtt": {
      "sensorTopic": "iot_proj/sensors",
      "actionTopic": "iot_proj/actions",
      "targetTopic": "iot_proj/targets",
      "modeTopic": "iot_proj/mode",
      "lastActionCode": 50
    }
  }
}
```

## 4. API для управления с сайта

### `POST /api/control/targets`

Тело запроса:

```json
{
  "temperatureC": {
    "min": 21.0,
    "max": 24.0
  },
  "humidityPct": {
    "min": 40.0,
    "max": 60.0
  },
  "co2Ppm": {
    "min": 450.0,
    "max": 800.0
  }
}
```

### `POST /api/control/mode`

Тело запроса:

```json
{
  "mode": "manual"
}
```

Обе ручки отвечают так:

```json
{
  "status": "accepted",
  "snapshot": {},
  "mqttPublished": true
}
```

`mqttPublished` показывает, удалось ли backend поставить сообщение в очередь MQTT-клиента.
