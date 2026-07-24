# App Screenshots

These screenshots were refreshed on 24 July 2026 from the actual app during the
usability pass based on `54085cb`, with:

- Django's local server and the Vite same-origin development proxy;
- a fresh temporary SQLite database populated by `python manage.py
  seed_demo_data`;
- the deterministic `demo-admin` account added only to that local database; and
- headless Google Chrome at device scale factor 1.

The database and generated local media are not committed. Recreate the images
while both local servers are running with:

```bash
node scripts/capture-screenshots.mjs
```

`SCREENSHOT_APP_URL`, `SCREENSHOT_USERNAME`, `SCREENSHOT_PASSWORD`,
`SCREENSHOT_OUTPUT_DIR`, and `CHROME_BIN` can override the local defaults.

## Captured views

| View | Language | Viewport | File |
|---|---|---:|---|
| Sign in | English | 390 × 844 | [login-en-mobile-390.png](login-en-mobile-390.png) |
| Dashboard and task counts | German | 1440 × 1000 | [dashboard-de-desktop-1440.png](dashboard-de-desktop-1440.png) |
| Vehicle pool | English | 768 × 1024 | [vehicle-pool-en-tablet-768.png](vehicle-pool-en-tablet-768.png) |
| Tasks | German | 390 × 844 | [tasks-de-mobile-390.png](tasks-de-mobile-390.png) |
| Mobile navigation drawer | German | 390 × 844 | [mobile-drawer-de-390.png](mobile-drawer-de-390.png) |
| Loan checkout wizard | English | 768 × 1024 | [loan-checkout-en-tablet-768.png](loan-checkout-en-tablet-768.png) |
| Document register | German | 1440 × 1000 | [document-register-de-desktop-1440.png](document-register-de-desktop-1440.png) |
| First-run setup | English | 1440 × 1000 | [setup-en-desktop-1440.png](setup-en-desktop-1440.png) |
| Driver directory | English | 768 × 1024 | [drivers-en-tablet-768.png](drivers-en-tablet-768.png) |
| Import review entry | German | 390 × 844 | [import-review-de-mobile-390.png](import-review-de-mobile-390.png) |
| Not found | English | 390 × 844 | [not-found-en-mobile-390.png](not-found-en-mobile-390.png) |
