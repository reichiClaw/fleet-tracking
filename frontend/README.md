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

## Implemented application areas

- React Router routes for login, dashboard, vehicle pool/detail, workflows,
  imports, and administration.
- API client that reads `VITE_API_BASE_URL`, sends JSON requests with
  credentials, includes CSRF headers, and follows paginated API lists.
- German and English i18n resources with persisted language preference.
- Workflow screens for check-in, loan checkout/return, manufacturer check-out,
  media uploads, signatures, and PDF generation.
- Admin screens for users, categories, vehicles, imports, and audit review.
- Smoke tests for rendering, language persistence, role-aware navigation, API
  client behavior, and translations.
- Dockerfile for building static assets and serving them with Nginx.
