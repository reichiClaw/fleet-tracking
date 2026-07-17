"""Request metadata extraction shared by audited API endpoints."""

from __future__ import annotations

import ipaddress

from django.conf import settings


def request_metadata(request) -> dict[str, str]:
    """Return bounded, validated request metadata.

    ``X-Forwarded-For`` is untrusted user input unless the deployment explicitly
    enables it.  Reverse-proxy configuration is intentionally not inferred here.
    """

    candidate = request.META.get("REMOTE_ADDR", "")
    if getattr(settings, "TRUST_X_FORWARDED_FOR", False):
        candidate = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",", 1)[0].strip() or candidate
    try:
        ip_address = str(ipaddress.ip_address(candidate))
    except ValueError:
        ip_address = ""
    return {
        "ip_address": ip_address,
        "user_agent": request.META.get("HTTP_USER_AGENT", "")[:1000],
    }
