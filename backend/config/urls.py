"""URL configuration for the fleet tracking backend."""

from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from accounts.views import CsrfView, LoginView, LogoutView, MeView, UserViewSet
from audit.views import AuditLogViewSet
from config.views import health, readiness
from damages.views import DamageReportViewSet
from drivers.views import DriverViewSet
from imports.views import ImportJobViewSet
from mediafiles.views import GeneratedDocumentViewSet, MediaFileViewSet
from parties.views import CompanyViewSet
from vehicles.views import VehicleCategoryViewSet, VehicleViewSet
from workflows.views import CheckInProtocolViewSet, LoanViewSet, ManufacturerCheckOutProtocolViewSet


router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("vehicle-categories", VehicleCategoryViewSet, basename="vehicle-category")
router.register("vehicles", VehicleViewSet, basename="vehicle")
router.register("companies", CompanyViewSet, basename="company")
router.register("drivers", DriverViewSet, basename="driver")
router.register("loans", LoanViewSet, basename="loan")
router.register("workflows/check-ins", CheckInProtocolViewSet, basename="check-in-protocol")
router.register(
    "workflows/manufacturer-checkouts",
    ManufacturerCheckOutProtocolViewSet,
    basename="manufacturer-checkout-protocol",
)
router.register("damage-reports", DamageReportViewSet, basename="damage-report")
router.register("media", MediaFileViewSet, basename="media-file")
router.register("documents", GeneratedDocumentViewSet, basename="document")
router.register("imports", ImportJobViewSet, basename="import-job")
router.register("audit-logs", AuditLogViewSet, basename="audit-log")

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/health/ready/", readiness, name="readiness"),
    path("api/v1/auth/csrf/", CsrfView.as_view(), name="auth-csrf"),
    path("api/v1/auth/login/", LoginView.as_view(), name="auth-login"),
    path("api/v1/auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("api/v1/auth/me/", MeView.as_view(), name="auth-me"),
    path("api/v1/", include(router.urls)),
]
