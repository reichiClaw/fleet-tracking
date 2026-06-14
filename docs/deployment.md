# Deployment

Target environment: Docker Compose on an Ubuntu VM hosted by Proxmox.

## Recommended Proxmox setup

- Ubuntu LTS VM.
- 2 or more vCPU.
- 4 GB RAM minimum for MVP.
- 40 GB disk minimum, larger if many photos are expected.
- Static IP address or DHCP reservation.
- Regular VM-level backups in addition to app-level backups.

## Services

| Service | Purpose |
|---|---|
| `db` | PostgreSQL database |
| `backend` | Django REST API and background-adjacent tasks |
| `frontend` | React/Vite application build or dev server during development |
| `nginx` | Reverse proxy, static/media serving, optional TLS termination |

## Volumes

| Volume | Purpose |
|---|---|
| `postgres_data` | PostgreSQL data directory |
| `media_data` | Photos, signatures, imported files, generated PDFs |
| `static_data` | Collected Django static files |

## Initial VM preparation

```bash
sudo apt update
sudo apt install -y ca-certificates curl git ufw fail2ban unattended-upgrades
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Reconnect to the VM, then verify:

```bash
docker --version
docker compose version
```

Firewall:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
# Allow 443/tcp only after TLS is configured on this VM or an upstream proxy.
sudo ufw enable
```

## Application deployment

```bash
sudo mkdir -p /opt/fleet-tracking
sudo chown "$USER:$USER" /opt/fleet-tracking
cd /opt/fleet-tracking
git clone <repo-url> .
cp .env.example .env
nano .env
docker compose up -d --build
```

The backend container runs migrations and `collectstatic` during startup. Create
an initial administrator after the stack is healthy:

```bash
docker compose exec backend python manage.py createsuperuser
```

## Environment variables

Use `.env.example` as the template. Never commit real `.env` files.

Important production values:

- `DJANGO_DEBUG=False`
- strong `DJANGO_SECRET_KEY`
- restricted `DJANGO_ALLOWED_HOSTS`
- restricted `DJANGO_CSRF_TRUSTED_ORIGINS`
- restricted `DJANGO_CORS_ALLOWED_ORIGINS`
- strong `POSTGRES_PASSWORD`
- `DEFAULT_LANGUAGE=de` or `en` according to the deployment team
- `SUPPORTED_LANGUAGES=de,en`
- secure cookie settings enabled behind HTTPS (`SESSION_COOKIE_SECURE=True`,
  `CSRF_COOKIE_SECURE=True`)
- once HTTPS reaches the stack, enable `SECURE_SSL_REDIRECT=True` and set
  `SECURE_HSTS_SECONDS` (e.g. `31536000`) so `manage.py check --deploy` passes.
  Leave both off while serving plain HTTP. If TLS terminates on an upstream
  proxy that already redirects to HTTPS, keep `SECURE_SSL_REDIRECT=False` to
  avoid redirect loops and rely on the proxy plus `SECURE_PROXY_SSL_HEADER`.
- `VITE_API_BASE_URL=/api/v1` for the Docker/Nginx deployment, or a full URL
  only when running the Vite dev server against a separately exposed API

## Backup

Use the helper target or script from the repository root. The script loads
`.env`, writes database and media backups under `backups/`, and uses the
configured Compose project name for the media volume.

```bash
make backup
# or: ./scripts/backup.sh
```

Recommended:

- Daily database backup.
- Daily or weekly media backup depending on upload volume.
- Offsite copy.
- Periodic restore test.

## Restore

Use the helper target or script from the repository root with one database dump
and one media archive. The script loads `.env`, restores PostgreSQL and the
media volume, then restarts the stack.

```bash
make restore DB=backups/fleet_tracking_YYYYMMDD_HHMMSS.dump MEDIA=backups/media_YYYYMMDD_HHMMSS.tar.gz
# or: ./scripts/restore.sh backups/fleet_tracking_YYYYMMDD_HHMMSS.dump backups/media_YYYYMMDD_HHMMSS.tar.gz
```

## Production hardening checklist

- `DJANGO_DEBUG=False`.
- HTTPS enabled on this VM or by an upstream reverse proxy.
- PostgreSQL is not exposed publicly.
- Strong unique secrets.
- Secure session and CSRF cookies.
- Upload size limits.
- Allowlisted upload content types.
- Admin users have strong passwords.
- Backups are encrypted or stored securely.
- Restore has been tested.
- VM packages receive security updates.
- Disk usage is monitored.
- Nginx request body size matches upload requirements.
- Django `check --deploy` passes or documented exceptions are reviewed.
