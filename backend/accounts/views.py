"""Authentication and user API views."""

from __future__ import annotations

from django.contrib.auth import get_user_model, login, logout
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.models import AuditLog
from accounts.permissions import IsAdminRole, UserPermission, is_admin
from accounts.serializers import CurrentUserSerializer, LoginSerializer, UserSerializer

User = get_user_model()


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        login(request, serializer.validated_data["user"])
        return Response(CurrentUserSerializer(serializer.validated_data["user"]).data)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(CurrentUserSerializer(request.user).data)


class UserViewSet(viewsets.ModelViewSet):
    serializer_class = UserSerializer
    permission_classes = [UserPermission]
    queryset = User.objects.order_by("username")

    def get_queryset(self):
        if is_admin(self.request.user):
            return self.queryset
        return self.queryset.filter(pk=self.request.user.pk)

    def perform_create(self, serializer):
        user = serializer.save()
        AuditLog.objects.create(
            actor=self.request.user,
            action="user.created",
            entity_type="user",
            entity_id=user.id,
            after={"username": user.username, "role": user.role, "is_active": user.is_active},
        )

    def perform_update(self, serializer):
        before = _user_snapshot(serializer.instance)
        user = serializer.save()
        AuditLog.objects.create(
            actor=self.request.user,
            action="user.updated",
            entity_type="user",
            entity_id=user.id,
            before=before,
            after=_user_snapshot(user),
        )

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def deactivate(self, request, pk=None):
        user = self.get_object()
        before = _user_snapshot(user)
        user.is_active = False
        user.save(update_fields=["is_active"])
        AuditLog.objects.create(
            actor=request.user,
            action="user.deactivated",
            entity_type="user",
            entity_id=user.id,
            before=before,
            after=_user_snapshot(user),
        )
        return Response(self.get_serializer(user).data)


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
