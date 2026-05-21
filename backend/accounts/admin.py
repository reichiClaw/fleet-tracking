"""Django admin registration for users and role assignment."""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from accounts.models import User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    fieldsets = DjangoUserAdmin.fieldsets + (("Fleet role", {"fields": ("full_name", "role")}),)
    add_fieldsets = DjangoUserAdmin.add_fieldsets + (("Fleet role", {"fields": ("full_name", "role", "email")}),)
    list_display = ("username", "email", "full_name", "role", "is_active", "is_staff", "last_login")
    list_filter = DjangoUserAdmin.list_filter + ("role",)
    search_fields = ("username", "email", "full_name", "first_name", "last_name")
    readonly_fields = DjangoUserAdmin.readonly_fields + ("id",)
