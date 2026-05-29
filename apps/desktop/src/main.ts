import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ServerMode = 'auto' | 'spawn' | 'external';
type ActiveServerMode = 'auto' | 'spawn' | 'existing' | 'spawned' | 'external';
type ServerStatus = 'checking' | 'starting' | 'healthy' | 'failed';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const backendDir = path.join(repoRoot, 'backend');

const serverPort = Number(process.env.FORMIC_SERVER_PORT ?? '8080');
const serverUrl = process.env.FORMIC_SERVER_URL ?? `http://127.0.0.1:${serverPort}`;
const rendererUrl = process.env.FORMIC_RENDERER_URL ?? 'http://127.0.0.1:5173';
const healthUrl = new URL('/health', serverUrl).toString();
const configuredServerMode = parseServerMode(process.env.FORMIC_SERVER_MODE);

let serverProcess: ChildProcessWithoutNullStreams | null = null;
let serverStatus: ServerStatus = 'checking';
let activeServerMode: ActiveServerMode = configuredServerMode;
let lastServerError: string | null = null;

function parseServerMode(mode: string | undefined): ServerMode {
  if (mode === 'spawn' || mode === 'external') {
    return mode;
  }

  return 'auto';
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function isServerHealthy(): Promise<boolean> {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

function shouldWaitForRenderer(): boolean {
  try {
    const url = new URL(rendererUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function isRendererReady(): Promise<boolean> {
  if (!shouldWaitForRenderer()) {
    return true;
  }

  try {
    const response = await fetch(rendererUrl, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 120000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerHealthy()) {
      serverStatus = 'healthy';
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  serverStatus = 'failed';
  throw new Error(`Timed out waiting for Formic server at ${healthUrl}`);
}

async function waitForRenderer(timeoutMs = 120000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isRendererReady()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for Formic renderer at ${rendererUrl}`);
}

function spawnServer(): void {
  if (serverProcess) {
    return;
  }

  const uvLockPath = path.join(repoRoot, 'uv.lock');
  const python = process.env.FORMIC_PYTHON;
  const command = python ?? (existsSync(uvLockPath) ? 'uv' : 'python3');
  const args = python
    ? ['-m', 'uvicorn']
    : existsSync(uvLockPath)
      ? ['run', '--frozen', '--project', repoRoot, 'python', '-m', 'uvicorn']
      : ['-m', 'uvicorn'];

  serverProcess = spawn(command, [
    ...args,
    'open_webui.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    String(serverPort),
    '--forwarded-allow-ips',
    '*'
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CORS_ALLOW_ORIGIN: [rendererUrl, serverUrl].join(';'),
      FORMIC_DESKTOP: 'true',
      FORMIC_LAZY_EMBEDDINGS: process.env.FORMIC_LAZY_EMBEDDINGS ?? 'true',
      FORWARDED_ALLOW_IPS: '*',
      PORT: String(serverPort),
      PYTHONPATH: backendDir
    }
  });

  serverProcess.stdout.on('data', (chunk) => {
    console.log(`[formic-server] ${chunk.toString().trimEnd()}`);
  });

  serverProcess.stderr.on('data', (chunk) => {
    console.error(`[formic-server] ${chunk.toString().trimEnd()}`);
  });

  serverProcess.once('exit', (code, signal) => {
    if (serverStatus !== 'healthy') {
      serverStatus = 'failed';
    }

    lastServerError = `Server exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`;
    serverProcess = null;
  });
}

async function ensureServer(): Promise<void> {
  serverStatus = 'checking';
  lastServerError = null;

  if (await isServerHealthy()) {
    activeServerMode = configuredServerMode === 'external' ? 'external' : 'existing';
    serverStatus = 'healthy';
    return;
  }

  if (configuredServerMode === 'external') {
    serverStatus = 'failed';
    throw new Error(`External Formic server is not healthy at ${healthUrl}`);
  }

  activeServerMode = 'spawned';
  serverStatus = 'starting';
  spawnServer();
  await waitForServer();
}

function htmlDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function startupHtml(): string {
  return [
    '<!doctype html>',
    '<meta charset="utf-8">',
    '<title>Starting Formic</title>',
    '<style>',
    ':root { color-scheme: light dark; }',
    'body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101418; color: #eef3f6; }',
    'main { width: min(520px, calc(100vw - 48px)); }',
    'h1 { margin: 0 0 12px; font-size: 28px; font-weight: 650; letter-spacing: 0; }',
    'p { margin: 0 0 18px; color: #b7c1c8; line-height: 1.5; }',
    '.bar { height: 6px; overflow: hidden; border-radius: 999px; background: #28313a; }',
    '.bar span { display: block; width: 42%; height: 100%; border-radius: inherit; background: #67d391; animation: slide 1.2s ease-in-out infinite; }',
    'dl { display: grid; grid-template-columns: 92px 1fr; gap: 8px 14px; margin: 22px 0 0; color: #d7dee3; }',
    'dt { color: #83909a; }',
    'dd { margin: 0; overflow-wrap: anywhere; }',
    '@keyframes slide { 0% { transform: translateX(-100%); } 50% { transform: translateX(80%); } 100% { transform: translateX(250%); } }',
    '</style>',
    '<main>',
    '<h1>Starting Formic</h1>',
    '<p id="message">Checking the local Formic server...</p>',
    '<div class="bar"><span></span></div>',
    '<dl>',
    '<dt>Status</dt><dd id="status">checking</dd>',
    '<dt>Mode</dt><dd id="mode">auto</dd>',
    '<dt>Health</dt><dd id="health"></dd>',
    '</dl>',
    '</main>',
    '<script>',
    'async function refresh() {',
    '  if (!window.formicDesktop) return;',
    '  const state = await window.formicDesktop.getServerStatus();',
    '  document.getElementById("status").textContent = state.status;',
    '  document.getElementById("mode").textContent = state.mode;',
    '  document.getElementById("health").textContent = state.healthUrl;',
    '  document.getElementById("message").textContent = state.status === "starting" ? "Starting the bundled FastAPI sidecar..." : "Checking the local Formic server...";',
    '}',
    'refresh(); setInterval(refresh, 500);',
    '</script>'
  ].join('');
}

function serverFailureHtml(message: string): string {
  return [
    '<!doctype html>',
    '<meta charset="utf-8">',
    '<title>Formic Server Failed</title>',
    '<body style="font: 14px system-ui; margin: 32px; max-width: 760px; line-height: 1.5;">',
    '<h1>Formic Server Failed</h1>',
    '<p>The Electron shell started, but the FastAPI sidecar did not become healthy.</p>',
    `<pre style="white-space: pre-wrap; padding: 16px; background: #f5f5f5;">${escapeHtml(message)}</pre>`,
    `<p>Mode: <code>${activeServerMode}</code></p>`,
    `<p>Health URL: <code>${healthUrl}</code></p>`,
    '</body>'
  ].join('');
}

function rendererFailureHtml(message: string): string {
  return [
    '<!doctype html>',
    '<meta charset="utf-8">',
    '<title>Formic Renderer Failed</title>',
    '<body style="font: 14px system-ui; margin: 32px; max-width: 760px; line-height: 1.5;">',
    '<h1>Formic Renderer Failed</h1>',
    '<p>The local Formic server is healthy, but the Svelte renderer did not become available.</p>',
    `<pre style="white-space: pre-wrap; padding: 16px; background: #f5f5f5;">${escapeHtml(message)}</pre>`,
    `<p>Renderer URL: <code>${rendererUrl}</code></p>`,
    '</body>'
  ].join('');
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'Formic',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  await window.loadURL(htmlDataUrl(startupHtml()));

  try {
    await ensureServer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await window.loadURL(htmlDataUrl(serverFailureHtml(message)));
    return;
  }

  try {
    await waitForRenderer();
    await window.loadURL(rendererUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await window.loadURL(htmlDataUrl(rendererFailureHtml(message)));
  }
}

ipcMain.handle('formic:server-status', () => ({
  status: serverStatus,
  mode: activeServerMode,
  configuredMode: configuredServerMode,
  serverUrl,
  healthUrl,
  lastServerError
}));

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on('before-quit', async () => {
  if (!serverProcess) {
    return;
  }

  serverProcess.kill('SIGTERM');
  await Promise.race([
    once(serverProcess, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);

  if (serverProcess) {
    serverProcess.kill('SIGKILL');
  }
});
