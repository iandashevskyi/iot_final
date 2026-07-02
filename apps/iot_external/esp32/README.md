# ESP32 Configurator

Локальная Windows-утилита для первичной настройки `ESP32` по `USB Serial`, без перепрошивки устройства.

Утилита:

- запрашивает `Device ID`, `Wi-Fi SSID`, пароль, адрес брокера и MQTT-топики;
- сохраняет конфиг в `.json`;
- отправляет тот же JSON в плату через `COM`-порт.

## Что должно быть в прошивке ESP32

Чтобы это работало, в прошивке уже должна быть логика:

1. открыть `Serial` на нужной скорости, например `115200`;
2. принять одну строку `UTF-8`, оканчивающуюся переводом строки `\n`;
3. распарсить JSON;
4. сохранить параметры во внутреннюю память (`NVS`, `Preferences`, `LittleFS`);
5. вернуть ответ, например `OK` или JSON-статус.

Если прошивка этого не умеет, утилита сможет отправить строку, но плата ее не применит.

## Формат JSON

Утилита отправляет в плату одну строку JSON такого вида:

```json
{
  "deviceId": "esp32-room-01",
  "wifi": {
    "ssid": "OfficeWiFi",
    "password": "12345678"
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

По проводу уходит именно эта строка плюс символ новой строки:

```text
{"deviceId":"...","wifi":{...},"transport":{...},"sampling":{...}}\n
```

## Запуск из Python

```powershell
cd "C:\Универ\3 курс\IOT\kurs\esp32"
py -3.13 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python configurator.py
```

## Сборка в EXE

```powershell
cd "C:\Универ\3 курс\IOT\kurs\esp32"
py -3.13 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pip install pyinstaller
pyinstaller --noconfirm --onefile --windowed --name ESP32Configurator configurator.py
```

Готовый файл будет здесь:

```text
esp32\dist\ESP32Configurator.exe
```

Если нужен более предсказуемый архив для отправки пользователю, вместо `--onefile` можно собрать папкой:

```powershell
pyinstaller --noconfirm --onedir --windowed --name ESP32Configurator configurator.py
```

Тогда пользователю можно отдать zip с:

- `ESP32Configurator.exe` или папкой `dist\ESP32Configurator\`
- `room-node.config.example.json`
- этой инструкцией

## Короткая инструкция для пользователя

1. Подключите первую плату `ESP32` к ноутбуку по USB.
2. Запустите `ESP32Configurator.exe`.
3. Выберите `COM`-порт.
4. Заполните `Wi-Fi`, `Broker URL` и нужные топики.
5. Нажмите `Отправить в устройство`.
6. Дождитесь ответа платы.
7. Отключите первую плату и повторите те же шаги для второй.
