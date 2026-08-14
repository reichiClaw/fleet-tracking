# Fleet Tracking

Planning and implementation scaffold for a Dockerized fleet management web app.

The target application manages delivered vehicles and equipment, including
check-in protocols, vehicle pool availability, loans to subcontractors or
internal drivers, return handling, damage/photo documentation, signatures,
manufacturer check-out, Excel imports, and role-based administration.

## Target stack

- Backend: Django + Django REST Framework
- Frontend: React + TypeScript + Vite
- Database: PostgreSQL
- Media: pluggable storage for photos, signatures, and generated PDFs
  (local Docker volume, SFTP/NAS, or S3/MinIO via `MEDIA_STORAGE_BACKEND`)
- Languages: German and English user interface, validation text, and PDF
  protocols
- Runtime: Docker Compose on an Ubuntu VM hosted by Proxmox
- Reverse proxy: Nginx behind mandatory production HTTPS via Caddy

## Repository structure

```text
.
├── AGENTS.md                  # Guidance for future coding agents
├── backend/                   # Django REST backend
├── deploy/                    # Nginx and Caddy (HTTPS) reverse-proxy assets
├── docs/                      # Product, architecture, API, deployment docs
├── frontend/                  # React + TypeScript + Vite frontend
├── scripts/                   # Setup, backup, and restore scripts
├── .env.example               # Development environment template
├── .env.production.example    # Fail-closed production template
├── Makefile                   # Development and production helper targets
├── docker-compose.yml         # Loopback-only development topology
├── docker-compose.prod.yml    # Production security overrides
└── docker-compose.tls.yml     # Mandatory production HTTPS edge
```

## Current state

A working backend and frontend implementation: authentication and roles,
vehicle and master-data management, the check-in/loan/return/manufacturer-checkout
workflows, QR quick access, media uploads and PDF protocols, Excel import,
German/English localization, and a Docker Compose deployment with backup/restore
tooling.

## Documentation

- `docs/requirements.md` - product scope, roles, statuses, and workflows.
- `docs/architecture.md` - architecture, modules, and data-consistency rules.
- `docs/api-design.md` and `docs/data-model.md` - API and data model reference.
- `docs/i18n.md` - German/English translation strategy.
- `docs/vehicle-import.md` - Excel import format.
- `docs/deployment.md` - full deployment, HTTPS, media storage, backup/restore.

## Deployment

The application runs as a Docker Compose stack (`db`, `backend`, `frontend`,
`nginx`). Development HTTP is bound to loopback. Production adds the
fail-closed production and TLS overlays so Caddy is the only public edge.
Database migrations and `collectstatic` run as an explicit release job before
the application containers start.

`docs/deployment.md` is the full reference (VM/Proxmox setup, firewall,
production hardening, backups). The essentials:

### Prerequisites

- A host with Docker Engine and the Docker Compose plugin
  (`curl -fsSL https://get.docker.com | sudo sh`).
- For HTTPS: a domain pointing at the host and ports 80/443 reachable.

### Local/development start

```bash
git clone <repo-url> fleet-tracking && cd fleet-tracking
cp .env.example .env
# Keep this environment development-only.
make up                      # build, release, and start on 127.0.0.1:8080
make logs                    # follow logs until healthy
docker compose exec backend python manage.py createsuperuser  # first admin
```

The app is then served on `http://127.0.0.1:${NGINX_HTTP_PORT}` (default
`8080`). Do not expose this development listener to a network.
Sign in with the superuser, or create additional users in the in-app Users
screen (admin) or Django admin at `/admin/`.

Alternatively, `./scripts/setup.sh` automates dependency install, checks, and
(optionally) deployment: `./scripts/setup.sh --install-system-packages --deploy
--create-superuser`.

To populate the app with realistic demo data for testing (categories,
companies, drivers, vehicles across every status, an active and a returned
loan, a damage report, and protocols), run:

```bash
docker compose exec backend python manage.py seed_demo_data
```

It creates demo users `demo-operations` and `demo-readonly` (default password
`demo-pass-1234`, override with `--password`). It is idempotent and must not be
run in production.

### Production deployment (HTTPS required)

Create an owner-only production environment, fill every required secret and
public URL, validate it, then deploy:

```bash
make prod-init-env
chmod 600 .env.production
$EDITOR .env.production
make prod-config
make prod-deploy
```

Caddy terminates TLS and redirects HTTP to HTTPS. Set `TLS_DOMAIN` to the
hostname only (no `https://`) and choose `TLS_MODE`:

- `acme` (default): Let's Encrypt for a public DNS name with ports 80/443 open
- `internal`: Caddy local CA for LAN/Proxmox names; run `make prod-ca` and trust
  the exported root certificate to clear browser certificate warnings
- `file`: your own PEM certificate and key

`make prod-tls-status` shows the live issuer and recent ACME logs. Production
deployment refuses missing or placeholder secrets, insecure cookies, non-HTTPS
origins, URL-shaped TLS hostnames, and an unencrypted backup configuration. See
the production checklist in `docs/deployment.md`.

### Media storage

Uploaded media is stored via `MEDIA_STORAGE_BACKEND`:

- `local` (default): the `media_data` Docker volume.
- `sftp`: a remote SFTP/NAS server (set the `SFTP_*` variables and pin its SSH
  host key; unknown keys are rejected).
- `s3`: S3-compatible storage / MinIO (set the `AWS_*` variables).

See "Media storage backend" in `docs/deployment.md`.

### Backup and restore

```bash
make backup-prod
make backup-status
make restore-prod BUNDLE=/var/backups/fleet-tracking/<bundle>.tar.gz.age CONFIRM=YES
```

### Helper targets

```bash
make compose-config      # validate development Compose
make up / make down      # start / stop loopback-only development
make prod-config         # validate fail-closed production configuration
make prod-deploy         # build, migrate, and start mandatory-TLS production
make prod-logs           # follow production logs
make backup-prod         # encrypted database/media/Caddy-state backup
make monitor-prod        # HTTPS, certificate, backup-age, and disk checks
make prod-tls-status     # live certificate issuer and Caddy ACME logs
make prod-ca             # export the Caddy local CA (TLS_MODE=internal)
make cleanup-media-prod  # remove expired unattached uploads
```

### Local development

Run the backend and frontend directly (without Docker) for development:

```bash
# Backend (PostgreSQL or SQLite via DATABASE_URL)
cd backend && pip install -r requirements.txt
python manage.py migrate && python manage.py runserver

# Frontend (proxies /api to the backend automatically)
cd frontend && npm install && npm run dev
```

See `frontend/README.md` for frontend configuration (`DEV_BACKEND_URL`,
`VITE_API_BASE_URL`).

### Browser usability smoke

With Django and Vite already running on the same origin, run the dependency-free
Chrome/CDP smoke:

```bash
node scripts/usability-smoke.mjs
```

It checks ordered operator, workflow, reliability, admin, responsive, keyboard,
localization, and role-specific journeys and prints timing/control observations
as JSON. The default URL is `http://127.0.0.1:5173`; override it and the demo
credentials with `USABILITY_APP_URL`, `USABILITY_USERNAME`,
`USABILITY_PASSWORD`, `USABILITY_OPERATIONS_USERNAME`, and
`USABILITY_READONLY_USERNAME`. Use a disposable seeded database because opening
workflow pages exercises draft autosave.

## MVP definition

The MVP is complete when:

- Admin and operations users can log in.
- Admins can manage users, vehicle categories, vehicles, drivers, companies,
  and Excel imports.
- Operations users can check in vehicles, loan vehicles, return vehicles, and
  check vehicles out to manufacturers.
- Vehicle status changes are validated and visible in a status overview.
- Photos, damage reports, signatures, and generated PDF protocols are stored.
- The application is usable in German and English.
- The app runs through Docker Compose with persistent database and media
  volumes.
