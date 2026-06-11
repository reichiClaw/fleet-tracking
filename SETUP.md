# Fleet Tracking Setup Guide

This guide explains how to deploy Fleet Tracking with Docker Compose, how to
size a Proxmox VM, and which online hosting options are realistic for this
application.

## Recommended deployment model

Use one Ubuntu LTS VM on Proxmox and run the bundled Docker Compose stack:

- PostgreSQL database container
- Django REST backend container
- React frontend static container
- Nginx reverse proxy container
- Persistent Docker volumes for PostgreSQL, uploaded media, generated PDFs, and
  Django static files

This is the recommended production model because the app depends on:

- Durable PostgreSQL storage
- Durable media storage for photos, signatures, imports, and PDFs
- Same-origin session authentication through Nginx
- Backend-generated immutable PDF protocols
- Simple backup and restore of both database and media

## Proxmox environment recommendations

### VM sizing

Minimum for a small MVP deployment:

| Resource | Recommendation |
|---|---|
| OS | Ubuntu 24.04 LTS or newer LTS |
| CPU | 2 vCPU |
| RAM | 4 GB |
| Disk | 40 GB minimum |
| Network | Static IP or DHCP reservation |
| Backup | Proxmox VM backup plus app-level database/media backup |

Recommended for heavier photo/PDF usage:

| Resource | Recommendation |
|---|---|
| CPU | 4 vCPU |
| RAM | 8 GB |
| Disk | 80-200 GB, depending on upload volume |
| Storage | SSD-backed Proxmox storage |
| Backup | Daily VM backup and daily app backup copied off-host |

### Proxmox VM settings

- Use a full VM instead of an unprivileged LXC container for the simplest Docker
  networking and volume behavior.
- Use VirtIO SCSI for disks and VirtIO for networking.
- Enable QEMU guest agent.
- Keep the VM clock synchronized with the Proxmox host or NTP.
- Put the VM on a VLAN or subnet that matches your internal access model.
- If the app is internet-facing, use an upstream firewall or reverse proxy.
- Snapshot before major upgrades, but rely on scheduled backups for recovery.

### Network and TLS

Recommended options:

1. Internal-only deployment:
   - Expose port 80 only inside the company network.
   - Use `DJANGO_DEBUG=False` and strong secrets.
   - Keep `SESSION_COOKIE_SECURE=False`, `CSRF_COOKIE_SECURE=False`, and
     `SECURE_SSL_REDIRECT=False` only if HTTP is truly internal and accepted.

2. HTTPS with an upstream reverse proxy:
   - Put Caddy, Traefik, Nginx Proxy Manager, HAProxy, or an existing appliance
     in front of the VM.
   - Forward `/`, `/api/`, `/admin/`, and `/static/` to the Compose Nginx
     service.
   - Set `PUBLIC_BASE_URL=https://your-domain.example`.
   - Set `SESSION_COOKIE_SECURE=True`, `CSRF_COOKIE_SECURE=True`, and
     `SECURE_SSL_REDIRECT=True`.

3. HTTPS directly on the VM:
   - Replace or extend `deploy/nginx/fleet-tracking.conf` with TLS certificates.
   - Allow port 443 through the firewall.
   - Keep port 80 only for redirects or ACME validation.

## Fresh Ubuntu VM setup

Run these commands on the VM:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git ufw fail2ban unattended-upgrades
```

Clone the repository:

```bash
sudo mkdir -p /opt/fleet-tracking
sudo chown "$USER:$USER" /opt/fleet-tracking
cd /opt/fleet-tracking
git clone <repo-url> .
```

Install Docker, Compose, Python venv support, install dependencies, run checks,
validate Compose, build images, and start the stack:

```bash
./scripts/setup.sh --install-system-packages --deploy
```

If Docker group membership was just added and your shell cannot access Docker
without `sudo`, log out and back in, then rerun:

```bash
./scripts/setup.sh --deploy
```

## Environment configuration

Create and edit `.env` before production use:

```bash
cp .env.example .env
nano .env
```

Important production values:

```dotenv
ENVIRONMENT=production
DJANGO_DEBUG=False
DJANGO_SECRET_KEY=<long-random-secret>
DJANGO_ALLOWED_HOSTS=fleet.example.com
DJANGO_CSRF_TRUSTED_ORIGINS=https://fleet.example.com
DJANGO_CORS_ALLOWED_ORIGINS=

POSTGRES_DB=fleet_tracking
POSTGRES_USER=fleet_tracking
POSTGRES_PASSWORD=<strong-random-password>
DATABASE_URL=postgres://fleet_tracking:<strong-random-password>@db:5432/fleet_tracking

PUBLIC_BASE_URL=https://fleet.example.com
VITE_API_BASE_URL=/api/v1

SESSION_COOKIE_SECURE=True
CSRF_COOKIE_SECURE=True
SECURE_SSL_REDIRECT=True
SECURE_HSTS_SECONDS=31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS=True
SECURE_HSTS_PRELOAD=True
```

For a same-origin Docker/Nginx deployment, keep `VITE_API_BASE_URL=/api/v1`.
Use a full URL only for local Vite development against a separately exposed API.

## Start, stop, and inspect the stack

Validate Compose:

```bash
make compose-config
```

Start:

```bash
make up
```

Inspect containers:

```bash
docker compose ps
```

Follow logs:

```bash
make logs
```

Stop:

```bash
make down
```

## First administrator

After the backend is healthy, create the initial admin:

```bash
docker compose exec backend python manage.py createsuperuser
```

Then log in through the web UI and create operational users from the admin area.

## Post-deploy checks

Run these after every first deploy or major upgrade:

```bash
docker compose ps
curl -f http://localhost/api/health/
docker compose exec backend python manage.py check --deploy
```

Functional smoke test:

1. Log in as admin.
2. Create a vehicle category.
3. Create or import a vehicle.
4. Create an operations user.
5. Log in as operations.
6. Complete check-in.
7. Loan an available vehicle.
8. Return the loan.
9. Check the vehicle out to manufacturer.
10. Generate and download PDFs.
11. Upload and download at least one photo/signature.

## Backup and restore

Create a backup:

```bash
make backup
```

Backups are written under `backups/`:

- `fleet_tracking_YYYYMMDD_HHMMSS.dump`
- `media_YYYYMMDD_HHMMSS.tar.gz`

Restore on a test VM before trusting backups:

```bash
make restore DB=backups/fleet_tracking_YYYYMMDD_HHMMSS.dump MEDIA=backups/media_YYYYMMDD_HHMMSS.tar.gz
```

Recommended backup policy:

- Daily database backup
- Daily media backup if uploads are frequent
- Offsite copy
- Periodic restore test
- Proxmox VM backup in addition to app backups

## Updates

Pull the latest code, rerun checks, rebuild, and restart:

```bash
cd /opt/fleet-tracking
git pull
./scripts/setup.sh --deploy
```

If you need a rollback, restore the previous Git revision and use the matching
database/media backup if migrations or data shape changed.

## Can this be deployed on Vercel, Cloudflare, or other online platforms?

### Short answer

The full application is **not a good fit for Vercel or Cloudflare Pages as-is**
because it is a multi-container Django/PostgreSQL/media-volume application.

The frontend can be hosted on Vercel or Cloudflare Pages, but the backend still
needs:

- A long-running Django runtime
- PostgreSQL
- Durable private media storage
- Secure session and CSRF configuration across origins
- PDF generation support

For the complete app, use Proxmox/Docker Compose or a container platform that
supports a persistent database and object storage.

### Platform matrix

| Platform | Full app as-is? | Practical use | Notes |
|---|---:|---|---|
| Proxmox VM + Docker Compose | Yes | Recommended production deployment | Best match for this repository. Persistent volumes and simple backups are included. |
| Vercel | No | Frontend only | Vercel is suitable for the React static frontend. Run Django elsewhere and use managed PostgreSQL/object storage. |
| Cloudflare Pages | No | Frontend only | Good for static frontend. Cloudflare Workers is not a drop-in Django runtime. |
| Cloudflare Tunnel | Yes, with Proxmox | Secure access path | Useful to expose the Proxmox VM without opening inbound ports. The app still runs on the VM. |
| Render | Possible with changes | Backend container + managed PostgreSQL | Move media to S3-compatible storage. Configure frontend separately or as static site. |
| Railway | Possible with changes | Backend + PostgreSQL | Move media to object storage. Verify persistent volume and backup requirements. |
| Fly.io | Possible with changes | Container backend near users | Use managed Postgres or Fly Postgres and object storage for media. |
| DigitalOcean App Platform | Possible with changes | Container backend + managed DB | Use Spaces/S3 for media; frontend can be static. |
| AWS/GCP/Azure | Yes, with more ops | ECS/Cloud Run/App Service + managed DB/storage | More flexible but more operational complexity than Proxmox. |

### What would be needed for split hosted deployment?

If you want frontend on Vercel/Cloudflare and backend elsewhere:

1. Build frontend with:

   ```dotenv
   VITE_API_BASE_URL=https://api.fleet.example.com/api/v1
   ```

2. Configure backend:

   ```dotenv
   DJANGO_ALLOWED_HOSTS=api.fleet.example.com
   DJANGO_CSRF_TRUSTED_ORIGINS=https://app.fleet.example.com,https://api.fleet.example.com
   DJANGO_CORS_ALLOWED_ORIGINS=https://app.fleet.example.com
   SESSION_COOKIE_SECURE=True
   CSRF_COOKIE_SECURE=True
   ```

3. Use HTTPS on both domains.
4. Confirm browser cookie behavior for cross-site requests.
5. Replace local media volume with S3-compatible storage before scaling beyond a
   single backend host.

### Recommended online option

If the goal is to keep operations simple but avoid public inbound firewall
rules, use:

- Proxmox VM + Docker Compose for the app
- Cloudflare DNS for the domain
- Cloudflare Tunnel or an upstream reverse proxy for HTTPS access
- Offsite backup storage for database/media archives

This keeps the application architecture intact while adding managed DNS/TLS and
remote access.

## Troubleshooting

### Backend is unhealthy

Check logs:

```bash
docker compose logs backend
```

Common causes:

- `DATABASE_URL` password does not match `POSTGRES_PASSWORD`
- `DJANGO_ALLOWED_HOSTS` does not include the requested host
- Database container is not healthy
- `.env` has production HTTPS settings but traffic is still plain HTTP

### Login fails in production

Check:

- Browser is using HTTPS when secure cookies are enabled
- `DJANGO_CSRF_TRUSTED_ORIGINS` includes the exact scheme and host
- `DJANGO_ALLOWED_HOSTS` includes the public host
- Frontend and API are same-origin, or CORS origins are configured correctly

### Uploads fail

Check:

- `MAX_UPLOAD_SIZE_MB`
- Nginx `client_max_body_size`
- File extension and content type
- Free disk space on the Docker volume

### Docker build fails on a restricted cloud agent

Some nested or restricted container environments block Docker bridge networking
or overlay storage. On a normal Ubuntu VM this is not expected. In restricted
environments, a Docker daemon may need host build networking and a non-overlay
storage driver. This repository sets Compose build networking to `host` for the
backend and frontend image builds.
