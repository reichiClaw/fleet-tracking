from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class DriversConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "drivers"
    verbose_name = _("Drivers")
