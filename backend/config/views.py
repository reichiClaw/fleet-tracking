"""Project-level API views."""

from django.utils.translation import gettext_lazy as _
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    """Return a lightweight health response for load balancers and Compose."""
    return Response(
        {
            "status": "ok",
            "detail": _("Service is healthy."),
        }
    )
