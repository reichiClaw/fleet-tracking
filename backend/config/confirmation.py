"""Short-lived signed confirmation tokens for destructive admin corrections."""

from django.core import signing
from django.core.signing import BadSignature, SignatureExpired
from django.utils.translation import gettext_lazy as _
from rest_framework import serializers


def make_confirmation_token(*, action: str, source_id, target_id) -> str:
    return signing.dumps(
        {"action": action, "source_id": str(source_id), "target_id": str(target_id)},
        salt="fleet-admin-confirmation",
        compress=True,
    )


def verify_confirmation_token(*, token: str, action: str, source_id, target_id) -> None:
    try:
        payload = signing.loads(
            token,
            salt="fleet-admin-confirmation",
            max_age=900,
        )
    except (BadSignature, SignatureExpired) as exc:
        raise serializers.ValidationError({"confirmation_token": _("Confirmation token is invalid or expired.")}) from exc
    expected = {
        "action": action,
        "source_id": str(source_id),
        "target_id": str(target_id),
    }
    if payload != expected:
        raise serializers.ValidationError({"confirmation_token": _("Confirmation token does not match this merge.")})
