from django.apps import AppConfig
from django.utils.translation import gettext_lazy as _


class MediafilesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "mediafiles"
    verbose_name = _("Media files")
