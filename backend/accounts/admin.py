"""Django admin registration for users and role assignment."""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from accounts.models import User
from audit.admin_mixins import AuditedAdminMixin


@admin.register(User)
class UserAdmin(AuditedAdminMixin, DjangoUserAdmin):
    fieldsets = DjangoUserAdmin.fieldsets + (
        ("Fleet role", {"fields": ("full_name", "role", "must_change_password")}),
    )
    add_fieldsets = DjangoUserAdmin.add_fieldsets + (
        ("Fleet role", {"fields": ("full_name", "role", "email", "must_change_password")}),
    )
    list_display = (
        "username",
        "email",
        "full_name",
        "role",
        "must_change_password",
        "is_active",
        "is_staff",
        "last_login",
    )
    list_filter = DjangoUserAdmin.list_filter + ("role", "must_change_password")
    search_fields = ("username", "email", "full_name", "first_name", "last_name")
    readonly_fields = DjangoUserAdmin.readonly_fields + ("id",)
