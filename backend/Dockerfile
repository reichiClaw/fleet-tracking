FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gettext \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install --upgrade pip "setuptools>=78.1.1" \
    && python -m pip install -r requirements.txt \
    && python -m pip install --upgrade "msgpack>=1.2.1"

COPY . .
RUN python manage.py compilemessages

RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /app/staticfiles /app/media \
    && chown -R appuser:appuser /app/staticfiles /app/media

USER appuser

EXPOSE 8000

CMD ["sh", "-c", "exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers ${GUNICORN_WORKERS:-3} --worker-tmp-dir /tmp --access-logfile - --error-logfile -"]
