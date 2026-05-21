# Frontend

React + TypeScript + Vite frontend for the fleet tracking application.

## Requirements

- Node.js 22+
- npm 10+

## Configuration

Create a local environment file when the backend is not served from the same origin:

```bash
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

If `VITE_API_BASE_URL` is not set, the API client falls back to `/api/v1`.

## Commands

```bash
npm install
npm run dev
npm run build
npm run preview
npm test
```

## Implemented foundation

- React Router routes for login and authenticated app pages.
- API client that reads `VITE_API_BASE_URL` and sends JSON requests with credentials.
- German and English i18n resources with persisted language preference.
- Placeholder login flow, authenticated layout, dashboard, vehicle pool, and admin navigation entries.
- Smoke tests for rendering, language persistence, and role-aware navigation.
- Dockerfile for building static assets and serving them with Nginx.
