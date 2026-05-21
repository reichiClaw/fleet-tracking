"""Role-based DRF permissions."""

from __future__ import annotations

from rest_framework.permissions import SAFE_METHODS, BasePermission


ADMIN_ROLE = "admin"
OPERATIONS_ROLE = "operations"
READONLY_ROLE = "readonly"


def is_admin(user) -> bool:
    return bool(user and user.is_authenticated and (user.is_superuser or getattr(user, "role", None) == ADMIN_ROLE))


def is_operations(user) -> bool:
    return bool(is_admin(user) or (user and user.is_authenticated and getattr(user, "role", None) == OPERATIONS_ROLE))


def is_authenticated(user) -> bool:
    return bool(user and user.is_authenticated)


class IsAdminRole(BasePermission):
    """Allow only administrators."""

    def has_permission(self, request, view) -> bool:
        return is_admin(request.user)


class AuthenticatedReadAdminWrite(BasePermission):
    """Authenticated users can read; only admins can mutate."""

    def has_permission(self, request, view) -> bool:
        if not is_authenticated(request.user):
            return False
        if request.method in SAFE_METHODS:
            return True
        return is_admin(request.user)


class AuthenticatedReadAdminOperationsWriteNoDelete(BasePermission):
    """Authenticated users can read; admin/operations can write except delete."""

    def has_permission(self, request, view) -> bool:
        if not is_authenticated(request.user):
            return False
        if request.method in SAFE_METHODS:
            return True
        if request.method == "DELETE":
            return is_admin(request.user)
        return is_operations(request.user)


class VehiclePermission(BasePermission):
    """Vehicle access: all roles read, admins create/delete, operations update."""

    def has_permission(self, request, view) -> bool:
        if not is_authenticated(request.user):
            return False
        if request.method in SAFE_METHODS:
            return True
        if request.method in {"PUT", "PATCH"}:
            return is_operations(request.user)
        return is_admin(request.user)


class UserPermission(BasePermission):
    """Admins manage users; non-admins can only read their own user record."""

    def has_permission(self, request, view) -> bool:
        if not is_authenticated(request.user):
            return False
        if is_admin(request.user):
            return True
        return request.method in SAFE_METHODS

    def has_object_permission(self, request, view, obj) -> bool:
        if is_admin(request.user):
            return True
        return request.method in SAFE_METHODS and obj.pk == request.user.pk


class AdminReadOnly(BasePermission):
    """Admins may read immutable resources; no API mutations are allowed."""

    def has_permission(self, request, view) -> bool:
        return bool(is_admin(request.user) and request.method in SAFE_METHODS)
