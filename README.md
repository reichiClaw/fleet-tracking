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
- Media: Docker volume for photos, signatures, and generated PDFs
- Languages: German and English user interface, validation text, and PDF
  protocols
- Runtime: Docker Compose on an Ubuntu VM hosted by Proxmox
- Reverse proxy: Nginx or an existing infrastructure proxy

## Repository structure

```text
.
├── AGENTS.md                  # Guidance for future coding agents
├── agent-tasks/               # Direct prompts for implementation agents
├── backend/                   # Backend implementation target
├── deploy/                    # Nginx and deployment assets
├── docs/                      # Product, architecture, API, backlog, deployment docs
├── frontend/                  # Frontend implementation target
├── scripts/                   # Operational scripts
├── .env.example               # Environment template
└── docker-compose.yml         # Planned production/local service topology
```

## Current repository state

This repository contains the planning, architecture, documentation, agent task
breakdown, deployment scaffold, and initial backend/frontend implementation
foundations.

## Start here

1. Read `docs/requirements.md`.
2. Review `docs/architecture.md` and `docs/api-design.md`.
3. Review `docs/i18n.md` for German/English translation requirements.
4. Use `docs/backlog.md` to sequence implementation.
5. Assign agents using `docs/agent-prompts.md` or the focused prompts in
   `agent-tasks/`.
6. Use `SETUP.md` for the complete Docker and Proxmox setup guide.
7. Use `docs/deployment.md` for the shorter deployment reference.

## Common Docker commands

```bash
cp .env.example .env
./scripts/setup.sh
make compose-config
make up
make logs
make backup
make restore DB=backups/fleet_tracking_YYYYMMDD_HHMMSS.dump MEDIA=backups/media_YYYYMMDD_HHMMSS.tar.gz
```

Use `./scripts/setup.sh --install-system-packages --deploy` on a fresh Ubuntu VM
to install prerequisites, prepare dependencies, run checks, validate Compose, and
start the stack. Review `.env` before production use.

The bundled Nginx service listens on `NGINX_HTTP_PORT` and proxies `/api/` and
`/admin/` to the backend while serving the frontend from the frontend static
container.

For production sizing, Proxmox recommendations, backup/restore steps, HTTPS
settings, and hosted-platform options such as Vercel, Cloudflare, Render,
Railway, Fly.io, and DigitalOcean, see `SETUP.md`.

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
