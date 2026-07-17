"""JSON response for middleware-level CSRF failures."""

from django.http import JsonResponse
from django.utils.translation import gettext as _


def csrf_failure(request, reason=""):
    return JsonResponse(
        {
            "error": {
                "code": "csrf_failed",
                "message": str(_("CSRF verification failed.")),
                "details": {},
            }
        },
        status=403,
    )
