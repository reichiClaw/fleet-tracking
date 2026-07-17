#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const appUrl = process.env.SCREENSHOT_APP_URL ?? 'http://127.0.0.1:4173';
const outputDir = resolve(process.env.SCREENSHOT_OUTPUT_DIR ?? 'docs/screenshots');
const username = process.env.SCREENSHOT_USERNAME ?? 'demo-admin';
const password = process.env.SCREENSHOT_PASSWORD ?? 'demo-pass-1234';
const debugPort = Number(process.env.SCREENSHOT_DEBUG_PORT ?? 9222);
const chromePath = process.env.CHROME_BIN ?? 'google-chrome';
const userDataDir = await mkdtemp(join(tmpdir(), 'fleet-screenshots-'));

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-sandbox',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeError = '';
chrome.stderr.on('data', (chunk) => {
  chromeError += String(chunk);
});

try {
  const target = await waitForTarget();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  await navigate(cdp, `${appUrl}/login`);
  await setLanguage(cdp, 'en');
  await navigate(cdp, `${appUrl}/login`);
  await setViewport(cdp, 390, 844);
  await settle(cdp, 'form');
  await capture(cdp, 'login-en-mobile-390.png');

  const login = await evaluate(cdp, `
    (async () => {
      await fetch('/api/v1/auth/csrf/', { credentials: 'include' });
      const csrf = decodeURIComponent(
        (document.cookie.split('; ').find((item) => item.startsWith('csrftoken=')) || '=').split('=')[1]
      );
      const response = await fetch('/api/v1/auth/login/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify(${JSON.stringify({ username, password })}),
      });
      return { status: response.status, body: await response.text() };
    })()
  `);
  if (login.status !== 200) {
    throw new Error(`Screenshot login failed (${login.status}): ${login.body}`);
  }

  await setLanguage(cdp, 'de');
  await setViewport(cdp, 1440, 1000);
  await navigate(cdp, `${appUrl}/app`);
  await settle(cdp, '.page-header h2');
  await capture(cdp, 'dashboard-de-desktop-1440.png');

  await setLanguage(cdp, 'en');
  await setViewport(cdp, 768, 1024);
  await navigate(cdp, `${appUrl}/app/vehicles`);
  await settle(cdp, '.page-header h2');
  await capture(cdp, 'vehicle-pool-en-tablet-768.png');

  await setLanguage(cdp, 'de');
  await setViewport(cdp, 390, 844);
  await navigate(cdp, `${appUrl}/app/tasks`);
  await settle(cdp, '.page-header h2');
  await capture(cdp, 'tasks-de-mobile-390.png');
  await evaluate(cdp, `
    (() => {
      const buttons = [...document.querySelectorAll('.mobile-bottom-nav button')];
      buttons.at(-1)?.click();
      return true;
    })()
  `);
  await sleep(250);
  await capture(cdp, 'mobile-drawer-de-390.png');

  await setLanguage(cdp, 'en');
  await setViewport(cdp, 768, 1024);
  await navigate(cdp, `${appUrl}/app/workflows/loan-checkout`);
  await settle(cdp, '.page-header h2');
  await capture(cdp, 'loan-checkout-en-tablet-768.png');

  await setLanguage(cdp, 'de');
  await setViewport(cdp, 1440, 1000);
  await navigate(cdp, `${appUrl}/app/documents`);
  await settle(cdp, '.page-header h2');
  await capture(cdp, 'document-register-de-desktop-1440.png');

  await setLanguage(cdp, 'en');
  await setViewport(cdp, 1440, 1000);
  await navigate(cdp, `${appUrl}/app/setup`);
  await settle(cdp, '.page-header h2');
  await capture(cdp, 'setup-en-desktop-1440.png');

  await setViewport(cdp, 768, 1024);
  await navigate(cdp, `${appUrl}/app/directory`);
  await settle(cdp, '.page-header h2');
  await evaluate(cdp, `
    (() => {
      const tab = [...document.querySelectorAll('[role="tab"]')]
        .find((item) => item.textContent?.trim() === 'Drivers');
      tab?.click();
      return Boolean(tab);
    })()
  `);
  await sleep(500);
  await capture(cdp, 'drivers-en-tablet-768.png');

  await setLanguage(cdp, 'de');
  await setViewport(cdp, 390, 844);
  await navigate(cdp, `${appUrl}/app/imports`);
  await settle(cdp, '.page-header h2');
  await capture(cdp, 'import-review-de-mobile-390.png');

  await setLanguage(cdp, 'en');
  await navigate(cdp, `${appUrl}/app/not-a-real-route`);
  await settle(cdp, '.page-header h2');
  await capture(cdp, 'not-found-en-mobile-390.png');

  cdp.close();
} finally {
  chrome.kill('SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => chrome.once('exit', resolvePromise)),
    sleep(2_000),
  ]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rm(userDataDir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await sleep(100);
    }
  }
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
    const waiting = listeners.get(message.method);
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
        const queue = listeners.get(method) ?? [];
        const timer = setTimeout(() => rejectPromise(new Error(`Timed out waiting for ${method}`)), timeout);
        queue.push((params) => {
          clearTimeout(timer);
          resolvePromise(params);
        });
        listeners.set(method, queue);
      });
    },
    close() {
      socket.close();
    },
  };
}

async function navigate(cdp, url) {
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  await evaluate(cdp, `
    (() => {
      const style = document.createElement('style');
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
      document.head.append(style);
      return true;
    })()
  `);
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

async function settle(cdp, selector) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(cdp, `
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        return Boolean(element) && !document.querySelector('.loading-state');
      })()
    `);
    if (ready) {
      await sleep(400);
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for UI selector: ${selector}`);
}

async function capture(cdp, filename) {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const path = join(outputDir, filename);
  await writeFile(path, Buffer.from(result.data, 'base64'));
  console.log(path);
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }
  return result.result.value;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
