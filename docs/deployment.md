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
sudo ufw allow 443/tcp
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

After backend implementation exists:

```bash
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py collectstatic --noinput
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
- secure cookie settings enabled behind HTTPS

## Backup

Database backup:

```bash
mkdir -p backups
docker compose exec -T db pg_dump \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --format=custom \
  > backups/fleet_tracking_$(date +%Y%m%d_%H%M%S).dump
```

Media backup:

```bash
docker run --rm \
  -v fleet-tracking_media_data:/media:ro \
  -v "$PWD/backups:/backups" \
  alpine tar czf /backups/media_$(date +%Y%m%d_%H%M%S).tar.gz -C /media .
```

Recommended:

- Daily database backup.
- Daily or weekly media backup depending on upload volume.
- Offsite copy.
- Periodic restore test.

## Restore

Stop app and start only database:

```bash
docker compose down
docker compose up -d db
```

Restore database:

```bash
docker compose exec -T db dropdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose exec -T db createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose exec -T db pg_restore \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --clean \
  --if-exists \
  < backups/fleet_tracking_YYYYMMDD_HHMMSS.dump
```

Restore media:

```bash
docker compose down
docker volume rm fleet-tracking_media_data
docker volume create fleet-tracking_media_data
docker run --rm \
  -v fleet-tracking_media_data:/media \
  -v "$PWD/backups:/backups" \
  alpine tar xzf /backups/media_YYYYMMDD_HHMMSS.tar.gz -C /media
```

Restart:

```bash
docker compose up -d
```

## Production hardening checklist

- `DJANGO_DEBUG=False`.
- HTTPS enabled.
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
