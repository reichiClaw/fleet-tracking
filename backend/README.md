# Fleet Tracking Backend

Django + Django REST Framework backend for the fleet tracking application.

## Local setup

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

The health endpoint is available at:

```text
GET /api/health/
```

## Configuration

Settings are driven by environment variables. Important values:

- `DATABASE_URL` - PostgreSQL connection string, for example
  `postgres://fleet_tracking:change-me@localhost:5432/fleet_tracking`
- `DJANGO_SECRET_KEY`
- `DJANGO_DEBUG`
- `DJANGO_ALLOWED_HOSTS`
- `DEFAULT_LANGUAGE` (`de` by default)
- `SUPPORTED_LANGUAGES` (`de,en` by default)
- `DJANGO_STATIC_ROOT` and `DJANGO_MEDIA_ROOT`

Without `DATABASE_URL`, local development and tests fall back to SQLite. In
`ENVIRONMENT=production`, both `DATABASE_URL` and a real `DJANGO_SECRET_KEY`
are required.

## Tests

```bash
cd backend
. .venv/bin/activate
python manage.py test
```

## Translations

Backend user-facing messages use Django's translation framework with German and
English catalogs under `locale/`.

```bash
cd backend
python manage.py makemessages -l de -l en
python manage.py compilemessages
```

## Docker

```bash
cd backend
docker build -t fleet-tracking-backend .
docker run --rm -p 8000:8000 --env-file ../.env fleet-tracking-backend
```
