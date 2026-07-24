#!/usr/bin/env node

/**
 * Real-browser usability smoke test for an already running Fleet Tracking app.
 *
 * The script intentionally uses Chrome DevTools Protocol directly so it does
 * not add a browser automation dependency. It validates route availability,
 * responsive overflow, accessible controls, workflow deep links, keyboard
 * combobox operation, validation focus, language switching, and role-specific
 * navigation. It does not mutate workflow records, making repeated runs safe.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const appUrl = (process.env.USABILITY_APP_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const username = process.env.USABILITY_USERNAME ?? 'demo-admin';
const password = process.env.USABILITY_PASSWORD ?? 'demo-pass-1234';
const operationsUsername = process.env.USABILITY_OPERATIONS_USERNAME ?? 'demo-operations';
const readonlyUsername = process.env.USABILITY_READONLY_USERNAME ?? 'demo-readonly';
const chromePath = process.env.CHROME_BIN ?? 'google-chrome';
const debugPort = Number(process.env.USABILITY_DEBUG_PORT ?? 9223);
const maxRouteMs = Number(process.env.USABILITY_MAX_ROUTE_MS ?? 8_000);
const userDataDir = await mkdtemp(join(tmpdir(), 'fleet-usability-'));
const results = [];
const failures = [];

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-sandbox',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeError = '';
chrome.stderr.on('data', (chunk) => { chromeError += String(chunk); });

try {
  const target = await waitForTarget();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Network.enable'),
  ]);

  const browserErrors = [];
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    browserErrors.push(`exception: ${exceptionDetails?.text ?? 'unknown'}`);
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') browserErrors.push(`console: ${args.map((arg) => arg.value ?? arg.description).join(' ')}`);
  });
  cdp.on('Network.loadingFailed', ({ errorText, canceled, type }) => {
    if (!canceled && type !== 'Image') browserErrors.push(`network: ${errorText}`);
  });
  cdp.on('Network.responseReceived', ({ response, type }) => {
    if (response.status >= 500 && ['Fetch', 'XHR', 'Document'].includes(type)) {
      browserErrors.push(`HTTP ${response.status}: ${response.url}`);
    }
  });
  cdp.on('Page.javascriptDialogOpening', () => {
    void cdp.send('Page.handleJavaScriptDialog', { accept: true });
  });

  await setViewport(cdp, 1440, 1000);
  await navigate(cdp, `${appUrl}/login`);
  await setLanguage(cdp, 'en');
  await login(cdp, username, password);

  const fixtures = await apiFixtures(cdp);
  assert(fixtures.announced, 'Seed data needs an announced vehicle');
  assert(fixtures.available, 'Seed data needs an available vehicle');
  assert(fixtures.loan, 'Seed data needs an active loan');
  assert(fixtures.damaged, 'Seed data needs a damaged vehicle');

  // Ordered operator navigation and task/action discovery.
  await inspectRoute(cdp, browserErrors, 'operator-home', '/app', 1440, 1000, {
    minControls: 10,
    check: (snapshot) => {
      assert(snapshot.taskActionLinks > 0, 'Operator home has no actionable task links');
      assert(snapshot.scanLinks > 0, 'Operator home has no scan navigation');
    },
  });
  await inspectRoute(cdp, browserErrors, 'operator-tasks', '/app/tasks', 390, 844, { minControls: 5 });
  await assertTaskDeepLinks(cdp);

  // Create/check-in, checkout, return, damage/maintenance and manufacturer return.
  await inspectWorkflow(cdp, browserErrors, 'atomic-intake', '/app/workflows/intake', 768, 1024);
  await validationFocus(cdp, '/app/workflows/intake');
  await inspectWorkflow(
    cdp,
    browserErrors,
    'announced-check-in',
    `/app/workflows/check-in?vehicle=${fixtures.announced.id}`,
    1440,
    1000,
    { requireContext: true },
  );
  await inspectWorkflow(
    cdp,
    browserErrors,
    'reservation-checkout',
    `/app/workflows/loan-checkout?vehicle=${fixtures.available.id}`,
    768,
    1024,
    { requireContext: true },
  );
  await inspectWorkflow(
    cdp,
    browserErrors,
    'loan-return',
    `/app/workflows/loan-return?loan=${fixtures.loan.id}`,
    390,
    844,
    { requireContext: true },
  );
  await inspectWorkflow(
    cdp,
    browserErrors,
    'damage-maintenance',
    `/app/tasks/maintenance?vehicle=${fixtures.damaged.id}&action=resolve`,
    768,
    1024,
    { requireContext: true },
  );
  await inspectWorkflow(
    cdp,
    browserErrors,
    'manufacturer-return',
    `/app/workflows/manufacturer-return?vehicle=${fixtures.available.id}`,
    1440,
    1000,
    { requireContext: true },
  );

  // Draft/reliability affordances.
  await inspectRoute(cdp, browserErrors, 'draft-resume-board', '/app/tasks', 1440, 1000, { minControls: 5 });

  // Admin surfaces in workflow order.
  const adminRoutes = [
    ['first-run-setup', '/app/setup'],
    ['password-reset-users', '/app/users'],
    ['category-meter-mode', '/app/categories'],
    ['directory-merge', '/app/directory'],
    ['safe-import', '/app/imports'],
    ['document-retry', '/app/documents'],
    ['audit-export', '/app/audit'],
    ['qr-label-printing', `/app/qr/print?vehicle=${fixtures.available.id}`],
  ];
  for (const [name, path] of adminRoutes) {
    await inspectRoute(cdp, browserErrors, name, path, 1440, 1000, { minControls: 2 });
  }
  await assertQrControls(cdp);

  // Responsive navigation, keyboard and language behavior.
  await inspectRoute(cdp, browserErrors, 'mobile-home', '/app', 390, 844, { minControls: 8 });
  await assertMobileNavigation(cdp);
  await inspectRoute(cdp, browserErrors, 'tablet-fleet', '/app/vehicles', 768, 1024, { minControls: 5 });
  await keyboardCombobox(cdp, `/app/workflows/check-in?vehicle=${fixtures.announced.id}`);
  await languageSwitch(cdp);

  // Role-specific action visibility.
  await login(cdp, operationsUsername, password);
  await inspectRoute(cdp, browserErrors, 'operations-home', '/app', 390, 844, {
    minControls: 7,
    check: (snapshot) => assert(snapshot.adminLinks === 0, 'Operations user can see admin navigation'),
  });
  await login(cdp, readonlyUsername, password);
  await inspectRoute(cdp, browserErrors, 'readonly-home', '/app', 390, 844, {
    minControls: 4,
    check: (snapshot) => assert(snapshot.workflowLinks === 0, 'Read-only user can see workflow actions'),
  });
  // Run last because a genuine beforeunload handler intentionally blocks later
  // full-page CDP navigations.
  await login(cdp, operationsUsername, password);
  await assertDirtyNavigationGuard(cdp, `/app/workflows/check-in?vehicle=${fixtures.announced.id}`);

  cdp.close();
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  chrome.kill('SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => chrome.once('exit', resolvePromise)),
    sleep(2_000),
  ]);
  await rm(userDataDir, { recursive: true, force: true });
}

console.log(JSON.stringify({
  appUrl,
  passed: failures.length === 0,
  routeCount: results.length,
  observations: results,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;

async function inspectWorkflow(cdp, errors, name, path, width, height, options = {}) {
  const snapshot = await inspectRoute(cdp, errors, name, path, width, height, { minControls: 3 });
  assert(snapshot.wizardSteps === 4, `${name}: expected four wizard steps`);
  assert(snapshot.currentWizardStep === 1, `${name}: wizard did not start at step one`);
  if (options.requireContext) {
    assert(snapshot.vehicleContexts > 0, `${name}: deep link did not load vehicle context`);
  }
  if (width < 600) {
    assert(snapshot.wizardActionsPosition === 'sticky', `${name}: mobile wizard actions are not sticky`);
  }
}

async function inspectRoute(cdp, errors, name, path, width, height, options = {}) {
  await setViewport(cdp, width, height);
  const errorOffset = errors.length;
  const started = performance.now();
  await navigate(cdp, `${appUrl}${path}`);
  await settle(cdp, '.page-header h2', maxRouteMs);
  const durationMs = Math.round(performance.now() - started);
  const snapshot = await evaluate(cdp, `
    (() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const controls = [...document.querySelectorAll('a[href],button,input,select,textarea')].filter(visible);
      const accessibleName = (element) => {
        if (element.getAttribute('aria-label')) return element.getAttribute('aria-label').trim();
        if (element.getAttribute('aria-labelledby')) {
          return element.getAttribute('aria-labelledby').split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
        }
        if (element.id) {
          const label = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
          if (label?.textContent?.trim()) return label.textContent.trim();
        }
        return (element.closest('label')?.textContent || element.textContent || element.getAttribute('title') || element.getAttribute('alt') || '').trim();
      };
      const actions = document.querySelector('.wizard-actions');
      const actionRect = actions?.getBoundingClientRect();
      return {
        path: location.pathname + location.search,
        title: (document.querySelector('.page-header h2') || document.querySelector('main h2') || document.querySelector('main h1'))?.textContent?.trim() || '',
        controls: controls.length,
        unlabeledControls: controls.filter((element) => !accessibleName(element)).length,
        overflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        overflowElements: [...document.querySelectorAll('body *')].filter((element) => {
          const rect = element.getBoundingClientRect();
          return visible(element) && (rect.right > innerWidth + 1 || rect.left < -1);
        }).slice(0, 5).map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          left: Math.round(element.getBoundingClientRect().left),
          right: Math.round(element.getBoundingClientRect().right),
        })),
        taskActionLinks: document.querySelectorAll('.task-board a[href]').length,
        scanLinks: document.querySelectorAll('a[href*="/app/qr"]').length,
        adminLinks: document.querySelectorAll('a[href="/app/setup"],a[href="/app/users"],a[href="/app/imports"],a[href="/app/audit"]').length,
        workflowLinks: document.querySelectorAll('a[href*="/app/workflows/"],a[href="/app/reservations"]').length,
        wizardSteps: document.querySelectorAll('.wizard-progress__step').length,
        currentWizardStep: Number(document.querySelector('.wizard-progress [aria-current="step"] span')?.textContent || 0),
        vehicleContexts: document.querySelectorAll('.vehicle-context-banner').length,
        wizardActionsVisible: !actions || (actionRect.bottom > 0 && actionRect.top < innerHeight),
        wizardActionsPosition: actions ? getComputedStyle(actions).position : '',
      };
    })()
  `);
  assert(durationMs <= maxRouteMs, `${name}: route took ${durationMs}ms (limit ${maxRouteMs}ms)`);
  assert(snapshot.title, `${name}: no page heading`);
  assert(snapshot.controls >= (options.minControls ?? 1), `${name}: only ${snapshot.controls} interactive controls`);
  assert(snapshot.unlabeledControls === 0, `${name}: ${snapshot.unlabeledControls} visible controls have no accessible name`);
  assert(snapshot.overflowPx <= 1, `${name}: horizontal overflow is ${snapshot.overflowPx}px at ${width}px (${JSON.stringify(snapshot.overflowElements)})`);
  const routeErrors = errors.slice(errorOffset);
  assert(routeErrors.length === 0, `${name}: browser errors: ${routeErrors.join('; ')}`);
  options.check?.(snapshot);
  results.push({ name, viewport: `${width}x${height}`, durationMs, ...snapshot });
  return snapshot;
}

async function apiFixtures(cdp) {
  return evaluate(cdp, `
    (async () => {
      const page = async (path) => {
        const response = await fetch('/api/v1/' + path, { credentials: 'include' });
        if (!response.ok) throw new Error(path + ': HTTP ' + response.status);
        const body = await response.json();
        return Array.isArray(body) ? body : body.results || [];
      };
      const [vehicles, loans] = await Promise.all([
        page('vehicles/?page_size=100'),
        page('loans/?status=active&page_size=100'),
      ]);
      return {
        announced: vehicles.find((item) => item.status === 'announced') || null,
        available: vehicles.find((item) => item.status === 'available') || null,
        damaged: vehicles.find((item) => item.status === 'damaged') || null,
        loan: loans[0] || null,
      };
    })()
  `);
}

async function assertTaskDeepLinks(cdp) {
  const hrefs = await evaluate(cdp, `[...document.querySelectorAll('.task-board a[href]')].map((item) => item.getAttribute('href'))`);
  assert(hrefs.some((href) => href?.includes('/workflows/check-in?vehicle=')), 'Tasks lack announced check-in deep link');
  assert(hrefs.some((href) => href?.includes('/workflows/loan-return?loan=')), 'Tasks lack overdue return deep link');
  results.push({ name: 'task-deep-links', controlCount: hrefs.length });
}

async function validationFocus(cdp, path) {
  await navigate(cdp, `${appUrl}${path}`);
  await settle(cdp, '.workflow-wizard');
  await evaluate(cdp, `document.querySelector('.wizard-actions button:last-child')?.click()`);
  await settle(cdp, '.error-summary');
  const focused = await evaluate(cdp, `document.activeElement?.classList.contains('error-summary') === true`);
  assert(focused, 'Validation error summary did not receive focus');
  results.push({ name: 'validation-focus', focused });
}

async function keyboardCombobox(cdp, path) {
  await navigate(cdp, `${appUrl}${path}`);
  await settle(cdp, '[role="combobox"]');
  await evaluate(cdp, `document.querySelector('[role="combobox"]')?.focus()`);
  await sleep(500);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' });
  const state = await evaluate(cdp, `({
    expanded: document.querySelector('[role="combobox"]')?.getAttribute('aria-expanded'),
    value: document.querySelector('[role="combobox"]')?.value || '',
  })`);
  assert(state.value, 'Keyboard combobox selection produced no value');
  assert(state.expanded === 'false', 'Keyboard combobox remained expanded after selection');
  results.push({ name: 'keyboard-combobox', selected: Boolean(state.value) });
}

async function assertDirtyNavigationGuard(cdp, path) {
  await navigate(cdp, `${appUrl}${path}`);
  await settle(cdp, '.workflow-wizard');
  const guarded = await evaluate(cdp, `
    (() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })()
  `);
  assert(guarded, 'Started workflow does not warn before browser navigation');
  results.push({ name: 'dirty-navigation-warning', guarded });
}

async function assertMobileNavigation(cdp) {
  await evaluate(cdp, `
    document.querySelector('.mobile-bottom-nav button:last-child')?.click()
  `);
  await sleep(100);
  const state = await evaluate(cdp, `
    (() => {
      const nav = document.querySelector('.mobile-bottom-nav');
      const drawer = document.querySelector('.side-nav');
      return {
        bottomLinks: nav?.querySelectorAll('a,button').length || 0,
        drawerOpen: drawer?.classList.contains('is-open') || false,
        modal: drawer?.getAttribute('aria-modal') || '',
      };
    })()
  `);
  assert(state.bottomLinks === 5, `Mobile bottom navigation has ${state.bottomLinks} items, expected 5`);
  assert(state.drawerOpen && state.modal === 'true', 'Mobile drawer did not open as a modal');
  results.push({ name: 'mobile-navigation', controlCount: state.bottomLinks });
}

async function languageSwitch(cdp) {
  await setViewport(cdp, 1440, 1000);
  await navigate(cdp, `${appUrl}/app`);
  await settle(cdp, '.page-header h2');
  const state = await evaluate(cdp, `
    (async () => {
      const select = [...document.querySelectorAll('.language-selector select')].find((item) => item.getBoundingClientRect().width > 0);
      if (!select) return null;
      const before = document.querySelector('.page-header h2')?.textContent;
      select.value = select.value === 'de' ? 'en' : 'de';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { before, after: document.querySelector('.page-header h2')?.textContent, language: document.documentElement.lang };
    })()
  `);
  assert(state && state.before !== state.after, 'DE/EN switch did not update the page heading');
  assert(['de', 'en'].includes(state.language), 'Language switch did not update document language');
  results.push({ name: 'language-switch', language: state.language });
}

async function assertQrControls(cdp) {
  const controls = await evaluate(cdp, `
    (() => {
      const options = [...document.querySelectorAll('.bulk-toolbar select option')].map((item) => item.value);
      const labels = [...document.querySelectorAll('.qr-label code,.qr-label__code,.qr-code-card code')].map((item) => item.textContent?.trim()).filter(Boolean);
      return { options, labels };
    })()
  `);
  for (const preset of ['62x29', 'custom', 'a4-sheet', 'letter-sheet']) {
    assert(controls.options.includes(preset), `QR labels lack ${preset} preset`);
  }
  results.push({ name: 'qr-label-controls', presetCount: controls.options.length, plainTextCodes: controls.labels.length });
}

async function login(cdp, nextUsername, nextPassword) {
  await navigate(cdp, `${appUrl}/login`);
  const response = await evaluate(cdp, `
    (async () => {
      await fetch('/api/v1/auth/csrf/', { credentials: 'include' });
      const csrf = decodeURIComponent((document.cookie.split('; ').find((item) => item.startsWith('csrftoken=')) || '=').split('=')[1]);
      const response = await fetch('/api/v1/auth/login/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify(${JSON.stringify({ username: nextUsername, password: nextPassword })}),
      });
      return { status: response.status, body: await response.text() };
    })()
  `);
  assert(response.status === 200, `Login failed for ${nextUsername} (${response.status}): ${response.body}`);
}

async function navigate(cdp, url) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
}

async function settle(cdp, selector, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)})) && !document.querySelector('.loading-state,.skeleton-grid')`);
    if (ready) {
      await sleep(150);
      return;
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function setLanguage(cdp, language) {
  await evaluate(cdp, `localStorage.setItem('fleet-language', ${JSON.stringify(language)})`);
}

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

async function waitForTarget() {
  const deadline = Date.now() + 10_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((item) => item.type === 'page');
      if (page) return page;
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Chrome DevTools did not start: ${lastError ?? chromeError}`);
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const onceListeners = new Map();
  const listeners = new Map();
  let nextId = 1;
  await new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener('open', resolvePromise, { once: true });
    socket.addEventListener('error', rejectPromise, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) ?? []) listener(message.params);
    const waiting = onceListeners.get(message.method);
    if (waiting?.length) waiting.shift()(message.params);
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolvePromise, rejectPromise) => {
        pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method, timeout = 10_000) {
      return new Promise((resolvePromise, rejectPromise) => {
        const queue = onceListeners.get(method) ?? [];
        const timer = setTimeout(() => rejectPromise(new Error(`Timed out waiting for ${method}`)), timeout);
        queue.push((params) => {
          clearTimeout(timer);
          resolvePromise(params);
        });
        onceListeners.set(method, queue);
      });
    },
    on(method, listener) {
      listeners.set(method, [...(listeners.get(method) ?? []), listener]);
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
