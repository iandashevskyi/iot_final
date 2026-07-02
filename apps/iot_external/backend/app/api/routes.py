from http import HTTPStatus

from flask import jsonify, request

from . import api_blueprint
from ..mqtt_bridge import publish_action_update, publish_mode_update, publish_targets_update
from ..state import SnapshotValidationError, snapshot_store


@api_blueprint.get("/health")
def healthcheck():
    return jsonify(
        {
            "status": "ok",
            "service": "backend",
        }
    )


@api_blueprint.get("/demo/snapshot")
def demo_snapshot():
    return jsonify({"snapshot": snapshot_store.get_snapshot()})


@api_blueprint.get("/snapshot")
def current_snapshot():
    return jsonify({"snapshot": snapshot_store.get_snapshot()})


@api_blueprint.post("/telemetry")
def ingest_telemetry():
    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        return (
            jsonify({"error": "Request body must be a JSON object"}),
            HTTPStatus.BAD_REQUEST,
        )

    try:
        snapshot = snapshot_store.update_snapshot(payload)
    except SnapshotValidationError as exc:
        return jsonify({"error": str(exc)}), HTTPStatus.BAD_REQUEST

    return jsonify({"status": "accepted", "snapshot": snapshot}), HTTPStatus.ACCEPTED


@api_blueprint.post("/control/mode")
def update_control_mode():
    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        return (
            jsonify({"error": "Request body must be a JSON object"}),
            HTTPStatus.BAD_REQUEST,
        )

    mode = payload.get("mode")

    try:
        snapshot = snapshot_store.apply_control_mode(mode)
    except SnapshotValidationError as exc:
        return jsonify({"error": str(exc)}), HTTPStatus.BAD_REQUEST

    mqtt_published = publish_mode_update(mode)
    return (
        jsonify(
            {
                "status": "accepted",
                "snapshot": snapshot,
                "mqttPublished": mqtt_published,
            }
        ),
        HTTPStatus.ACCEPTED,
    )


@api_blueprint.post("/control/actuators")
def update_manual_actuators():
    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        return (
            jsonify({"error": "Request body must be a JSON object"}),
            HTTPStatus.BAD_REQUEST,
        )

    try:
        snapshot = snapshot_store.apply_manual_actuators_payload(payload)
    except SnapshotValidationError as exc:
        return jsonify({"error": str(exc)}), HTTPStatus.BAD_REQUEST

    mqtt_published = publish_action_update(snapshot["actuators"])
    return (
        jsonify(
            {
                "status": "accepted",
                "snapshot": snapshot,
                "mqttPublished": mqtt_published,
            }
        ),
        HTTPStatus.ACCEPTED,
    )


@api_blueprint.post("/control/targets")
def update_control_targets():
    payload = request.get_json(silent=True)

    if not isinstance(payload, dict):
        return (
            jsonify({"error": "Request body must be a JSON object"}),
            HTTPStatus.BAD_REQUEST,
        )

    try:
        snapshot = snapshot_store.apply_targets_payload(payload)
    except SnapshotValidationError as exc:
        return jsonify({"error": str(exc)}), HTTPStatus.BAD_REQUEST

    mqtt_published = publish_targets_update(payload)
    return (
        jsonify(
            {
                "status": "accepted",
                "snapshot": snapshot,
                "mqttPublished": mqtt_published,
            }
        ),
        HTTPStatus.ACCEPTED,
    )
