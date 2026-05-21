# Frontend Implementation Target

This directory is reserved for the React + TypeScript + Vite frontend.

## Expected contents after implementation

```text
frontend/
├── Dockerfile
├── index.html
├── package.json
├── vite.config.ts
├── src/
│   ├── api/
│   ├── components/
│   ├── features/
│   ├── pages/
│   ├── routes/
│   └── main.tsx
└── tests/
```

## Frontend agent handoff

Start with:

- `agent-tasks/02-frontend-foundation.md`
- `agent-tasks/08-frontend-workflows.md`

## Key requirements

- API base URL from `VITE_API_BASE_URL`.
- Mobile-first workflow wizards.
- Vehicle pool with status filtering.
- Camera/photo upload support.
- Signature capture.
- Role-aware navigation and actions.
- Clear loading, empty, and error states.
