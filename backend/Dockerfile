FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gettext \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN python -m pip install --upgrade pip \
    && python -m pip install -r requirements.txt \
    && python -m pip install --upgrade --force-reinstall "msgpack>=1.2.1" \
    && python -m pip uninstall -y setuptools wheel \
    && rm -rf /usr/local/lib/python3.13/ensurepip /root/.cache/pip \
    && find /usr -type d \( -name 'setuptools-70.*' -o -name 'msgpack-1.1.*' \) -prune -exec rm -rf {} + \
    && find /usr -type f \( -name 'setuptools-70.*' -o -name 'msgpack-1.1.*' \) -delete

COPY . .
RUN python manage.py compilemessages

RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /app/staticfiles /app/media \
    && chown -R appuser:appuser /app/staticfiles /app/media

USER appuser

EXPOSE 8000

CMD ["sh", "-c", "exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers ${GUNICORN_WORKERS:-3} --worker-tmp-dir /tmp --access-logfile - --error-logfile -"]
