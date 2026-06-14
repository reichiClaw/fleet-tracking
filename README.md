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
- Reverse proxy: Nginx, with optional automatic HTTPS via Caddy

## Repository structure

```text
.
├── AGENTS.md                  # Guidance for future coding agents
├── agent-tasks/               # Direct prompts for implementation agents
├── backend/                   # Django REST backend
├── deploy/                    # Nginx and Caddy (HTTPS) reverse-proxy assets
├── docs/                      # Product, architecture, API, backlog, deployment docs
├── frontend/                  # React + TypeScript + Vite frontend
├── scripts/                   # Backup/restore operational scripts
├── .env.example               # Environment template
├── Makefile                   # Helper targets (up, up-tls, backup, restore, ...)
├── docker-compose.yml         # Production/local service topology
└── docker-compose.tls.yml     # Optional automatic-HTTPS (Caddy) overlay
```

## Current repository state

This repository contains the planning and documentation set plus a working
backend and frontend implementation: authentication and roles, vehicle and
master-data management, the check-in/loan/return/manufacturer-checkout
workflows, media uploads and PDF protocols, Excel import, German/English
localization, and a Docker Compose deployment with backup/restore tooling.

## Start here

1. Read `docs/requirements.md`.
2. Review `docs/architecture.md` and `docs/api-design.md`.
3. Review `docs/i18n.md` for German/English translation requirements.
4. Use `docs/backlog.md` to sequence implementation.
5. Assign agents using `docs/agent-prompts.md` or the focused prompts in
   `agent-tasks/`.
6. Use `docs/deployment.md` when turning the implementation into a running
   Docker Compose deployment.

## Deployment

The application runs as a Docker Compose stack (`db`, `backend`, `frontend`,
`nginx`). The bundled Nginx service listens on `NGINX_HTTP_PORT`, proxies
`/api/` and `/admin/` to the backend, and serves the frontend. The backend
container runs database migrations and `collectstatic` on startup.

`docs/deployment.md` is the full reference (VM/Proxmox setup, firewall,
production hardening, backups). The essentials:

### Prerequisites

- A host with Docker Engine and the Docker Compose plugin
  (`curl -fsSL https://get.docker.com | sudo sh`).
- For HTTPS: a domain pointing at the host and ports 80/443 reachable.

### Quick start (HTTP)

```bash
git clone <repo-url> fleet-tracking && cd fleet-tracking
cp .env.example .env
# Edit .env: set ENVIRONMENT=production, a strong DJANGO_SECRET_KEY,
# DJANGO_ALLOWED_HOSTS, and a strong POSTGRES_PASSWORD/DATABASE_URL.
make up                      # build and start the stack
make logs                    # follow logs until healthy
docker compose exec backend python manage.py createsuperuser  # first admin
```

The app is then served on `http://<host>:${NGINX_HTTP_PORT}` (default `80`).
Sign in with the superuser, or create additional users in the in-app Users
screen (admin) or Django admin at `/admin/`.

### HTTPS (recommended for production)

Set `TLS_DOMAIN`/`TLS_EMAIL` in `.env`, enable secure cookies
(`SESSION_COOKIE_SECURE=True`, `CSRF_COOKIE_SECURE=True`), then:

```bash
make up-tls                  # adds a Caddy edge proxy (auto Let's Encrypt TLS)
```

Caddy obtains and renews certificates automatically and redirects HTTP to
HTTPS. See the HTTPS checklist in `docs/deployment.md`.

### Media storage

Uploaded media is stored via `MEDIA_STORAGE_BACKEND`:

- `local` (default): the `media_data` Docker volume.
- `sftp`: a remote SFTP/NAS server (set the `SFTP_*` variables).
- `s3`: S3-compatible storage / MinIO (set the `AWS_*` variables).

See "Media storage backend" in `docs/deployment.md`.

### Backup and restore

```bash
make backup
make restore DB=backups/fleet_tracking_YYYYMMDD_HHMMSS.dump MEDIA=backups/media_YYYYMMDD_HHMMSS.tar.gz
```

### Helper targets

```bash
make compose-config   # validate the Compose configuration
make up / make down   # start / stop the HTTP stack
make up-tls / down-tls# start / stop the HTTPS (Caddy) stack
make logs             # follow logs
make backup / restore # database + media backup and restore
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
