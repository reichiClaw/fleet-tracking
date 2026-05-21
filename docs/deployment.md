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
./scripts/setup.sh --deploy
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
- `SECURE_SSL_REDIRECT=True` and secure cookie settings enabled behind HTTPS
- `SECURE_HSTS_SECONDS` set only after HTTPS is confirmed for the final domain
- `VITE_API_BASE_URL=/api/v1` for the Docker/Nginx deployment, or a full URL
  only when running the Vite dev server against a separately exposed API

## Automated setup script

The repository includes `scripts/setup.sh` to automate dependency setup and
deployment checks:

```bash
./scripts/setup.sh --install-system-packages --deploy --create-superuser
```

The script can install Python venv support, Docker, and Compose on Ubuntu, copy
`.env.example` to `.env` when needed, install backend/frontend dependencies, run
tests and builds, validate `docker compose config`, and optionally start the
stack. Use `./scripts/setup.sh --help` for all options.

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
