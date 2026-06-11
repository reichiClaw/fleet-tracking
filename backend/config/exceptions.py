"""Consistent API error formatting for DRF responses."""

from __future__ import annotations

from rest_framework import exceptions, status
from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return None

    if isinstance(exc, exceptions.ValidationError):
        response.data = {
            "type": "validation_error",
            "errors": response.data,
        }
        return response

    if response.status_code == status.HTTP_403_FORBIDDEN:
        response.data = {
            "type": "permission_denied",
            "detail": _detail(response.data),
        }
        return response

    if response.status_code == status.HTTP_404_NOT_FOUND:
        response.data = {
            "type": "not_found",
            "detail": _detail(response.data),
        }
        return response

    response.data = {
        "type": "api_error",
        "detail": _detail(response.data),
    }
    return response


def _detail(data):
    if isinstance(data, dict):
        return data.get("detail", data)
    return data
