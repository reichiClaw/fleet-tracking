"""Django admin registration for audit logs."""

from django.contrib import admin

from audit.models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("action", "entity_type", "entity_id", "actor", "created_at")
    list_filter = ("entity_type", "action", "created_at")
    search_fields = ("action", "entity_type", "entity_id", "user_agent")
    readonly_fields = ("id", "actor", "action", "entity_type", "entity_id", "before", "after", "ip_address", "user_agent", "created_at", "updated_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
