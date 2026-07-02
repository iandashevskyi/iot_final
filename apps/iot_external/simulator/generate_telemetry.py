from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from datetime import datetime, timezone
from urllib import error, request


def build_payload(step: int, device_id: str, target_zone: str) -> dict:
    phase = step / 6
    temperature = round(22.5 + math.sin(phase) * 1.7 + random.uniform(-0.2, 0.2), 1)
    humidity = round(44.0 + math.cos(phase / 2) * 5.5 + random.uniform(-0.5, 0.5), 1)
    co2 = int(680 + (math.sin(phase / 1.5) + 1) * 120 + random.uniform(-20, 20))

    ventilation_on = co2 > 780
    humidifier_on = humidity < 40
    heater_on = temperature < 21.5

    return {
        "deviceId": device_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "temperatureC": temperature,
            "humidityPct": humidity,
            "co2Ppm": co2,
        },
        "outsideMetrics": {
            "temperatureC": 12.0,
            "humidityPct": 58.0,
            "co2Ppm": 400.0,
        },
        "actuators": {
            "heater": heater_on,
            "airConditioner": temperature > 24.4,
            "humidifier": humidifier_on,
            "windowLeft": co2 > 820,
            "windowRight": co2 > 900,
            "exhaust": ventilation_on,
        },
        "control": {
            "mode": "auto",
            "controller": "simulator",
        },
        "rl": {
            "reward": round(random.uniform(0.68, 0.93), 2),
            "confidence": round(random.uniform(0.64, 0.9), 2),
            "targetZone": target_zone,
        },
        "targets": {
            "temperatureC": {
                "min": 21.0,
                "max": 24.0,
            },
            "humidityPct": {
                "min": 40.0,
                "max": 60.0,
            },
            "co2Ppm": {
                "min": 450,
                "max": 800,
            },
        },
        "mqtt": {
            "sensorTopic": "iot_proj/sensors",
            "actionTopic": "iot_proj/actions",
            "lastActionCode": 0,
        },
    }


def post_payload(post_url: str, payload: dict) -> int:
    encoded_payload = json.dumps(payload).encode("utf-8")
    http_request = request.Request(
        url=post_url,
        data=encoded_payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with request.urlopen(http_request, timeout=5) as response:
        return response.status


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate climate telemetry and optionally push it to Flask API."
    )
    parser.add_argument(
        "--post-url",
        default="",
        help="POST endpoint for backend ingestion, e.g. http://localhost:5000/api/telemetry",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=5.0,
        help="Telemetry interval in seconds.",
    )
    parser.add_argument(
        "--device-id",
        default="esp32-room-01",
        help="Device identifier used in generated packets.",
    )
    parser.add_argument(
        "--target-zone",
        default="comfort",
        help="Logical target zone label for future goal-conditioned RL integration.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    step = 0

    while True:
        payload = build_payload(step, args.device_id, args.target_zone)
        print(json.dumps(payload, ensure_ascii=False))

        if args.post_url:
            try:
                status_code = post_payload(args.post_url, payload)
                print(
                    f"[simulator] snapshot accepted by backend ({status_code})",
                    file=sys.stderr,
                )
            except error.URLError as exc:
                print(
                    f"[simulator] failed to post telemetry: {exc.reason}",
                    file=sys.stderr,
                )

        time.sleep(args.interval)
        step += 1


if __name__ == "__main__":
    main()
