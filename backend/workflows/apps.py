from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class WorkflowsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "workflows"
    verbose_name = _("Workflows")
