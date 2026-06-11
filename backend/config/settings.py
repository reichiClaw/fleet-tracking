"""Environment-driven Django settings for the fleet tracking backend."""

from __future__ import annotations

import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from django.utils.translation import gettext_lazy as _


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
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"
WHITENOISE_AUTOREFRESH = DEBUG

MEDIA_URL = env("MEDIA_URL", "/media/")
MEDIA_ROOT = env("DJANGO_MEDIA_ROOT", str(BASE_DIR / "media"))
MAX_UPLOAD_SIZE_MB = int(env("MAX_UPLOAD_SIZE_MB", "25"))

SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", default=ENVIRONMENT == "production")
CSRF_COOKIE_SECURE = env_bool("CSRF_COOKIE_SECURE", default=ENVIRONMENT == "production")
SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", default=ENVIRONMENT == "production")
SECURE_HSTS_SECONDS = int(env("SECURE_HSTS_SECONDS", "31536000" if ENVIRONMENT == "production" else "0"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", default=ENVIRONMENT == "production")
SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", default=ENVIRONMENT == "production")
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"

_DEFAULT_RENDERERS = ["rest_framework.renderers.JSONRenderer"]
if DEBUG:
    _DEFAULT_RENDERERS.append("rest_framework.renderers.BrowsableAPIRenderer")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": _DEFAULT_RENDERERS,
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.FormParser",
        "rest_framework.parsers.MultiPartParser",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "EXCEPTION_HANDLER": "config.exceptions.api_exception_handler",
}

CORS_ALLOW_CREDENTIALS = True

PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "http://localhost")
EMAIL_BACKEND = env("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", "")
EMAIL_PORT = int(env("EMAIL_PORT", "587"))
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", default=True)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "noreply@example.com")
