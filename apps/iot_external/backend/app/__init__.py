from flask import Flask
from flask_cors import CORS

from .api import api_blueprint
from .config import Config
from .mqtt_bridge import start_mqtt_bridge


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)

    CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})
    app.register_blueprint(api_blueprint, url_prefix="/api")
    start_mqtt_bridge(app.config)

    return app
