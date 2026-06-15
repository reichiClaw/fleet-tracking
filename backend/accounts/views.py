"""Authentication and user API views."""

from __future__ import annotations

from django.contrib.auth import get_user_model, login, logout
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.permissions import IsAdminRole, UserPermission, is_admin
from accounts.serializers import CurrentUserSerializer, LoginSerializer, UserSerializer

User = get_user_model()


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Issue a CSRF cookie so the SPA can send the X-CSRFToken header on writes."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response(status=status.HTTP_204_NO_CONTENT)


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

    def get_queryset(self):
        if is_admin(self.request.user):
            return self.queryset
        return self.queryset.filter(pk=self.request.user.pk)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminRole])
    def deactivate(self, request, pk=None):
        user = self.get_object()
        user.is_active = False
        user.save(update_fields=["is_active"])
        return Response(self.get_serializer(user).data)
