from flask import Blueprint

api_blueprint = Blueprint("api", __name__)

from . import routes  # noqa: E402,F401
