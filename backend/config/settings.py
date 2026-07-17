"""Environment-driven Django settings for the fleet tracking backend."""

from __future__ import annotations

import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from django.utils.translation import gettext_lazy as _

from config.storage import build_storages


BASE_DIR = Path(__file__).resolve().parent.parent


def env(name: str, default: str | None = None) -> str:
    """Return an environment value, or a default when one is provided."""
    value = os.getenv(name, default)
    if value is None:
        raise ImproperlyConfigured(f"Missing required environment variable: {name}")
    return value


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    value = os.getenv(name, default)
    return [item.strip() for item in value.split(",") if item.strip()]


ENVIRONMENT = env("ENVIRONMENT", "development")

SECRET_KEY = env("DJANGO_SECRET_KEY", "unsafe-development-secret-key-change-me")
DEBUG = env_bool("DJANGO_DEBUG", default=ENVIRONMENT != "production")

if ENVIRONMENT == "production" and SECRET_KEY == "unsafe-development-secret-key-change-me":
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set in production.")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")
CORS_ALLOWED_ORIGINS = env_list("DJANGO_CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = bool(CORS_ALLOWED_ORIGINS)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "accounts",
    "vehicles",
    "parties",
    "drivers",
    "workflows",
    "damages",
    "mediafiles",
    "imports",
    "audit",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

database_url = os.getenv("DATABASE_URL")
if ENVIRONMENT == "production" and not database_url:
    raise ImproperlyConfigured("DATABASE_URL must be set in production.")

DATABASES = {
    "default": dj_database_url.config(
        default=database_url or f"sqlite:///{BASE_DIR / 'db.sqlite3'}",
        conn_max_age=600,
        conn_health_checks=True,
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

SUPPORTED_LANGUAGES = env_list("SUPPORTED_LANGUAGES", "de,en")
LANGUAGE_NAMES = {
    "de": _("German"),
    "en": _("English"),
}
LANGUAGES = [(code, LANGUAGE_NAMES.get(code, code)) for code in SUPPORTED_LANGUAGES]
LANGUAGE_CODE = env("DEFAULT_LANGUAGE", "de")
USE_I18N = True
USE_TZ = True
TIME_ZONE = env("TIME_ZONE", "Europe/Berlin")
LOCALE_PATHS = [BASE_DIR / "locale"]

STATIC_URL = env("STATIC_URL", "/static/")
STATIC_ROOT = env("DJANGO_STATIC_ROOT", str(BASE_DIR / "staticfiles"))
WHITENOISE_AUTOREFRESH = DEBUG

MEDIA_URL = env("MEDIA_URL", "/media/")
MEDIA_ROOT = env("DJANGO_MEDIA_ROOT", str(BASE_DIR / "media"))
MAX_UPLOAD_SIZE_MB = int(env("MAX_UPLOAD_SIZE_MB", "25"))
MAX_STAGED_MEDIA_FILES = int(env("MAX_STAGED_MEDIA_FILES", "50"))
MAX_STAGED_MEDIA_SIZE_MB = int(env("MAX_STAGED_MEDIA_SIZE_MB", "100"))
STAGED_MEDIA_TTL_HOURS = int(env("STAGED_MEDIA_TTL_HOURS", "24"))
WORKFLOW_DRAFT_TTL_HOURS = int(env("WORKFLOW_DRAFT_TTL_HOURS", "72"))
MAX_WORKFLOW_DRAFT_SIZE_KB = int(env("MAX_WORKFLOW_DRAFT_SIZE_KB", "256"))
RETURN_SIGNATURE_REQUIRED = env_bool("RETURN_SIGNATURE_REQUIRED", default=False)
RESERVATION_EARLY_HANDOVER_HOURS = int(env("RESERVATION_EARLY_HANDOVER_HOURS", "2"))
MAX_PDF_SIZE_MB = int(env("MAX_PDF_SIZE_MB", "15"))
MAX_PDF_EVIDENCE_PIXELS = int(env("MAX_PDF_EVIDENCE_PIXELS", "20000000"))
MAX_IMPORT_ROWS = int(env("MAX_IMPORT_ROWS", "5000"))
MAX_IMPORT_COLUMNS = int(env("MAX_IMPORT_COLUMNS", "100"))
MAX_IMPORT_UNCOMPRESSED_SIZE_MB = int(env("MAX_IMPORT_UNCOMPRESSED_SIZE_MB", "100"))
MAX_IMPORT_ZIP_ENTRIES = int(env("MAX_IMPORT_ZIP_ENTRIES", "1000"))
MAX_IMPORT_RESULT_SIZE_MB = int(env("MAX_IMPORT_RESULT_SIZE_MB", "5"))

# Media storage backend (local filesystem, SFTP, or S3/MinIO) is selected with
# the MEDIA_STORAGE_BACKEND environment variable. Static files always use
# WhiteNoise. See config/storage.py.
MEDIA_STORAGE_BACKEND = env("MEDIA_STORAGE_BACKEND", "local")
STORAGES = build_storages(os.environ)

SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", default=ENVIRONMENT == "production")
CSRF_COOKIE_SECURE = env_bool("CSRF_COOKIE_SECURE", default=ENVIRONMENT == "production")
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Sensible cookie + clickjacking defaults. The session cookie stays HttpOnly so
# JavaScript cannot read it; the CSRF cookie is intentionally readable so the SPA
# can echo it back in the X-CSRFToken header.
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = env("SESSION_COOKIE_SAMESITE", "Lax")
CSRF_COOKIE_SAMESITE = env("CSRF_COOKIE_SAMESITE", "Lax")
CSRF_FAILURE_VIEW = "config.csrf.csrf_failure"
X_FRAME_OPTIONS = "DENY"
TRUST_X_FORWARDED_FOR = env_bool("TRUST_X_FORWARDED_FOR", default=False)

# HTTPS hardening. Defaults are conservative because TLS may terminate on an
# upstream reverse proxy. Enable these once HTTPS reaches this stack so that
# `manage.py check --deploy` passes cleanly in production.
SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", default=False)
SECURE_HSTS_SECONDS = int(env("SECURE_HSTS_SECONDS", "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", default=SECURE_HSTS_SECONDS > 0)
SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", default=False)
SECURE_CONTENT_TYPE_NOSNIFF = env_bool("SECURE_CONTENT_TYPE_NOSNIFF", default=True)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"

# The browsable API is convenient in development but exposes an HTML write UI
# that should not be served in production. Keep it only when DEBUG is on.
_API_RENDERERS = ["rest_framework.renderers.JSONRenderer"]
if DEBUG:
    _API_RENDERERS.append("rest_framework.renderers.BrowsableAPIRenderer")

REST_FRAMEWORK = {
    "EXCEPTION_HANDLER": "config.exceptions.api_exception_handler",
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": _API_RENDERERS,
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.FormParser",
        "rest_framework.parsers.MultiPartParser",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    # Scoped throttling protects the login endpoint from credential stuffing.
    # Only the login view opts in (see accounts.views.LoginView).
    "DEFAULT_THROTTLE_RATES": {
        "login": env("LOGIN_RATE_LIMIT", "10/min"),
        "media_upload": env("MEDIA_UPLOAD_RATE_LIMIT", "30/hour"),
    },
}

# Structured logging to stdout so `docker compose logs` and any log shipper can
# capture application output. Level is configurable without code changes.
LOG_LEVEL = env("DJANGO_LOG_LEVEL", "INFO").upper()
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{asctime} {levelname} {name}: {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    "loggers": {
        "django": {"handlers": ["console"], "level": LOG_LEVEL, "propagate": False},
        "django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "fleet": {"handlers": ["console"], "level": LOG_LEVEL, "propagate": False},
    },
}

PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "http://localhost")
EMAIL_BACKEND = env("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", "")
EMAIL_PORT = int(env("EMAIL_PORT", "587"))
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", default=True)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "noreply@example.com")
BACKUP_STATUS = env("BACKUP_STATUS", "")

if ENVIRONMENT == "production":
    placeholder_markers = ("change-me", "dev-only", "unsafe-development", "example-secret")
    if DEBUG:
        raise ImproperlyConfigured("DJANGO_DEBUG must be False in production.")
    if len(SECRET_KEY) < 50 or any(marker in SECRET_KEY.lower() for marker in placeholder_markers):
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY must be a non-placeholder value of at least 50 characters in production."
        )
    if not ALLOWED_HOSTS or "*" in ALLOWED_HOSTS:
        raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must contain explicit hosts in production.")
    if not CSRF_TRUSTED_ORIGINS or any(not origin.startswith("https://") for origin in CSRF_TRUSTED_ORIGINS):
        raise ImproperlyConfigured(
            "DJANGO_CSRF_TRUSTED_ORIGINS must contain only explicit HTTPS origins in production."
        )
    if not SESSION_COOKIE_SECURE or not CSRF_COOKIE_SECURE:
        raise ImproperlyConfigured("Secure session and CSRF cookies are required in production.")
    if not PUBLIC_BASE_URL.startswith("https://"):
        raise ImproperlyConfigured("PUBLIC_BASE_URL must use HTTPS in production.")
    if SECURE_HSTS_SECONDS <= 0:
        raise ImproperlyConfigured("SECURE_HSTS_SECONDS must be greater than zero in production.")
