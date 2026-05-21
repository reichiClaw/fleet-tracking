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

This repository currently contains the complete planning, architecture,
documentation, agent task breakdown, and deployment scaffold. The backend and
frontend folders are intentionally prepared as implementation targets for the
next coding-agent passes.

## Start here

1. Read `docs/requirements.md`.
2. Review `docs/architecture.md` and `docs/api-design.md`.
3. Use `docs/backlog.md` to sequence implementation.
4. Assign agents using `docs/agent-prompts.md` or the focused prompts in
   `agent-tasks/`.
5. Use `docs/deployment.md` when turning the implementation into a running
   Docker Compose deployment.

## MVP definition

The MVP is complete when:

- Admin and operations users can log in.
- Admins can manage users, vehicle categories, vehicles, drivers, companies,
  and Excel imports.
- Operations users can check in vehicles, loan vehicles, return vehicles, and
  check vehicles out to manufacturers.
- Vehicle status changes are validated and visible in a status overview.
- Photos, damage reports, signatures, and generated PDF protocols are stored.
- The app runs through Docker Compose with persistent database and media
  volumes.
