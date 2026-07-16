"""Central JSON error contract for the REST API."""

from __future__ import annotations

from django.utils.translation import gettext as _
from rest_framework.views import exception_handler as drf_exception_handler


def api_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None

    details = response.data
    code = getattr(exc, "default_code", "error")
    message = _("Request validation failed.")
    if isinstance(details, dict) and set(details) == {"detail"}:
        detail = details["detail"]
        message = str(detail)
        code = getattr(detail, "code", code)
        details = {}

    response.data = {
        "error": {
            "code": str(code),
            "message": str(message),
            "details": details,
        }
    }
    return response
