"""URL configuration for the fleet tracking backend."""

from django.contrib import admin
from django.urls import path

from config.views import health


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
]
