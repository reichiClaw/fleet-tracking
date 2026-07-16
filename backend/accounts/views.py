"""Authentication and user API views."""

from __future__ import annotations

from django.contrib.auth import get_user_model, login, logout, update_session_auth_hash
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.permissions import IsAdminRole, UserPermission, is_admin
from accounts.serializers import CurrentUserSerializer, LoginSerializer, PasswordUpdateSerializer, UserSerializer
from audit.services import audit_event
from config.request import request_metadata

User = get_user_model()


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Issue a CSRF cookie so the SPA can send the X-CSRFToken header on writes."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    # Rate-limit anonymous login attempts to slow credential stuffing. The rate
    # is configured via the LOGIN_RATE_LIMIT env var (settings DEFAULT_THROTTLE_RATES).
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        login(request, serializer.validated_data["user"])
        # Ensure a fresh CSRF cookie is issued for the authenticated session.
        get_token(request)
        return Response(CurrentUserSerializer(serializer.validated_data["user"]).data)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(CurrentUserSerializer(request.user).data)


class UserViewSet(viewsets.ModelViewSet):
    serializer_class = UserSerializer
    permission_classes = [UserPermission]
    queryset = User.objects.order_by("username")
    http_method_names = ["get", "post", "put", "patch", "head", "options"]

    def get_queryset(self):
        if self.request.user.is_superuser:
            return self.queryset
        if is_admin(self.request.user):
            return self.queryset.filter(is_staff=False, is_superuser=False)
        return self.queryset.filter(pk=self.request.user.pk)

    def perform_create(self, serializer):
        user = serializer.save()
        audit_event(
            actor=self.request.user,
            action="user.created",
            entity_type="user",
            entity_id=user.id,
            after=_user_snapshot(user),
            request_meta=request_metadata(self.request),
        )

    def perform_update(self, serializer):
        before = _user_snapshot(serializer.instance)
        user = serializer.save()
        audit_event(
            actor=self.request.user,
            action="user.updated",
            entity_type="user",
            entity_id=user.id,
            before=before,
            after=_user_snapshot(user),
            request_meta=request_metadata(self.request),
        )

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def deactivate(self, request, pk=None):
        user = self.get_object()
        before = _user_snapshot(user)
        user.is_active = False
        user.save(update_fields=["is_active"])
        audit_event(
            actor=request.user,
            action="user.deactivated",
            entity_type="user",
            entity_id=user.id,
            before=before,
            after=_user_snapshot(user),
            request_meta=request_metadata(request),
        )
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=["post"], url_path="set-password", permission_classes=[IsAuthenticated])
    def set_password(self, request, pk=None):
        target = self.get_object()
        if target.pk != request.user.pk and not is_admin(request.user):
            raise serializers.ValidationError({"detail": _("You may only change your own password.")})
        if target.is_superuser and not request.user.is_superuser:
            raise serializers.ValidationError({"detail": _("Application administrators cannot modify a superuser.")})
        serializer = PasswordUpdateSerializer(data=request.data, context={"request": request, "target": target})
        serializer.is_valid(raise_exception=True)
        target.set_password(serializer.validated_data["new_password"])
        target.save(update_fields=["password"])
        if target.pk == request.user.pk:
            update_session_auth_hash(request, target)
        audit_event(
            actor=request.user,
            action="user.password_changed",
            entity_type="user",
            entity_id=target.id,
            after={"password_changed": True},
            request_meta=request_metadata(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


def _user_snapshot(user) -> dict[str, object]:
    return {
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
    }
