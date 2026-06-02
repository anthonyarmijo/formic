import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ServerMode = 'auto' | 'spawn' | 'external';
type ActiveServerMode = 'auto' | 'spawn' | 'existing' | 'spawned' | 'external';
type ServerStatus = 'checking' | 'starting' | 'healthy' | 'ready' | 'failed';
type RendererStatus = 'waiting' | 'checking' | 'ready' | 'loading' | 'loaded' | 'skipped' | 'failed';

type ProbeResult = {
  ok: boolean;
  detail: string;
  statusCode?: number;
};

type ServerLaunchPlan = {
  command: string;
  args: string[];
  cwd: string;
  backendDir: string;
  source: string;
  error?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const packagedServerRoot = path.join(process.resourcesPath, 'formic-server');
const shouldUseBundledServerRoot =
  Boolean(process.env.FORMIC_SERVER_BUNDLE_DIR) || (app.isPackaged && existsSync(packagedServerRoot));
const serverRoot =
  process.env.FORMIC_SERVER_BUNDLE_DIR ?? (shouldUseBundledServerRoot ? packagedServerRoot : repoRoot);

const serverPort = Number(process.env.FORMIC_SERVER_PORT ?? '8080');
const serverUrl = process.env.FORMIC_SERVER_URL ?? `http://127.0.0.1:${serverPort}`;
const rendererUrl = process.env.FORMIC_RENDERER_URL ?? (app.isPackaged ? serverUrl : 'http://127.0.0.1:5173');
const healthUrl = new URL('/health', serverUrl).toString();
const readinessUrl = new URL('/ready', serverUrl).toString();
const serverReadyTimeoutMs = parseTimeout(process.env.FORMIC_SERVER_READY_TIMEOUT_MS, 120000);
const rendererReadyTimeoutMs = parseTimeout(process.env.FORMIC_RENDERER_READY_TIMEOUT_MS, 120000);
const serverLogLineLimit = parseTimeout(process.env.FORMIC_SERVER_LOG_LINES, 24);
const configuredServerMode = parseServerMode(process.env.FORMIC_SERVER_MODE);

let serverProcess: ChildProcessWithoutNullStreams | null = null;
let serverStatus: ServerStatus = 'checking';
let rendererStatus: RendererStatus = 'waiting';
let activeServerMode: ActiveServerMode = configuredServerMode;
let lastServerError: string | null = null;
let lastServerProbe: string | null = null;
let lastRendererError: string | null = null;
let lastRendererProbe: string | null = null;
let activeServerLaunchPlan: ServerLaunchPlan | null = null;
const recentServerOutput: string[] = [];
let isQuitting = false;

function parseServerMode(mode: string | undefined): ServerMode {
  if (mode === 'spawn' || mode === 'external') {
    return mode;
  }

  return 'auto';
}

function parseTimeout(value: string | undefined, fallbackMs: number): number {
  if (!value) {
    return fallbackMs;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function desktopUserDataDir(): string {
  return process.env.FORMIC_DESKTOP_USER_DATA_DIR ?? app.getPath('userData');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function originFor(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function buildCorsAllowOrigin(): string {
  const origins = [
    originFor(rendererUrl),
    originFor(serverUrl),
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    `http://127.0.0.1:${serverPort}`,
    `http://localhost:${serverPort}`
  ].filter((origin): origin is string => Boolean(origin));

  return [...new Set(origins)].join(';');
}

function findBundledPython(root: string): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(root, '.venv', 'Scripts', 'python.exe'),
          path.join(root, 'venv', 'Scripts', 'python.exe'),
          path.join(root, 'python-runtime', 'python.exe')
        ]
      : [
          path.join(root, '.venv', 'bin', 'python'),
          path.join(root, 'venv', 'bin', 'python'),
          path.join(root, 'python-runtime', 'bin', 'python3.11'),
          path.join(root, 'python-runtime', 'bin', 'python3'),
          path.join(root, 'python-runtime', 'bin', 'python')
        ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function bundledPythonCandidates(root: string): string[] {
  return process.platform === 'win32'
    ? [
        path.join(root, '.venv', 'Scripts', 'python.exe'),
        path.join(root, 'venv', 'Scripts', 'python.exe'),
        path.join(root, 'python-runtime', 'python.exe')
      ]
    : [
        path.join(root, '.venv', 'bin', 'python'),
        path.join(root, 'venv', 'bin', 'python'),
        path.join(root, 'python-runtime', 'bin', 'python3.11'),
        path.join(root, 'python-runtime', 'bin', 'python3'),
        path.join(root, 'python-runtime', 'bin', 'python')
      ];
}

function missingServerRootFiles(root: string, backendDir: string): string[] {
  const required: Array<[string, string]> = [
    ['backend directory', backendDir],
    ['FastAPI app', path.join(backendDir, 'open_webui', 'main.py')],
    ['backend env module', path.join(backendDir, 'open_webui', 'env.py')]
  ];

  if (shouldUseBundledServerRoot) {
    required.push(
      ['dependency project file', path.join(root, 'pyproject.toml')],
      ['dependency lockfile', path.join(root, 'uv.lock')],
      ['package metadata', path.join(root, 'package.json')],
      ['changelog', path.join(root, 'CHANGELOG.md')]
    );
  }

  return required
    .filter(([, filePath]) => !existsSync(filePath))
    .map(([label, filePath]) => `${label}: ${filePath}`);
}

function buildServerLaunchPlan(): ServerLaunchPlan {
  const backendDir = path.join(serverRoot, 'backend');
  const python = process.env.FORMIC_PYTHON;
  const bundledPython = shouldUseBundledServerRoot ? findBundledPython(serverRoot) : null;
  const uvLockPath = path.join(serverRoot, 'uv.lock');

  if (python) {
    return {
      command: python,
      args: ['-m', 'uvicorn'],
      cwd: serverRoot,
      backendDir,
      source: 'FORMIC_PYTHON'
    };
  }

  if (bundledPython) {
    const isManagedRuntime = bundledPython.includes(`${path.sep}python-runtime${path.sep}`);
    return {
      command: bundledPython,
      args: ['-m', 'uvicorn'],
      cwd: serverRoot,
      backendDir,
      source: process.env.FORMIC_SERVER_BUNDLE_DIR
        ? isManagedRuntime
          ? 'FORMIC_SERVER_BUNDLE_DIR managed Python runtime'
          : 'FORMIC_SERVER_BUNDLE_DIR venv'
        : isManagedRuntime
          ? 'bundled managed Python runtime'
          : 'bundled venv'
    };
  }

  if (shouldUseBundledServerRoot) {
    return {
      command: '',
      args: [],
      cwd: serverRoot,
      backendDir,
      source: 'missing bundled Python',
      error: [
        `Bundled server root was selected at ${serverRoot}, but no bundled Python executable was found.`,
        `Expected one of:\n${bundledPythonCandidates(serverRoot).map((candidate) => `- ${candidate}`).join('\n')}`,
        'Run `npm run desktop:bundle:build` to create a rehearsal bundle with a .venv, or set FORMIC_PYTHON explicitly for local debugging.'
      ].join('\n')
    };
  }

  if (existsSync(uvLockPath)) {
    return {
      command: 'uv',
      args: ['run', '--frozen', '--project', serverRoot, 'python', '-m', 'uvicorn'],
      cwd: serverRoot,
      backendDir,
      source: 'uv lockfile'
    };
  }

  return {
    command: 'python3',
    args: ['-m', 'uvicorn'],
    cwd: serverRoot,
    backendDir,
    source: 'system python3'
  };
}

function formatServerLaunchPlan(plan: ServerLaunchPlan | null): string {
  if (!plan) {
    return 'not selected';
  }

  return [
    `${plan.command} ${plan.args.join(' ')}`,
    `source=${plan.source}`,
    `cwd=${plan.cwd}`,
    `pythonpath=${plan.backendDir}`
  ].join('\n');
}

function recordServerOutput(stream: 'stdout' | 'stderr', chunk: Buffer): void {
  const lines = chunk
    .toString()
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  for (const line of lines) {
    recentServerOutput.push(`[${stream}] ${line.slice(0, 1000)}`);
  }

  while (recentServerOutput.length > serverLogLineLimit) {
    recentServerOutput.shift();
  }
}

async function probeUrl(
  url: string,
  options: {
    label: string;
    timeoutMs?: number;
    requiredText?: string[];
    requireJsonStatus?: boolean;
  }
): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? 1200;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.text();
    const bodyPreview = body.trim().slice(0, 240);

    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.status,
        detail: `${options.label} responded ${response.status}${bodyPreview ? `: ${bodyPreview}` : ''}`
      };
    }

    if (options.requireJsonStatus) {
      try {
        const json = JSON.parse(body) as { status?: unknown };
        if (json.status !== true) {
          return {
            ok: false,
            statusCode: response.status,
            detail: `${options.label} responded ${response.status}, but status was not true`
          };
        }
      } catch {
        return {
          ok: false,
          statusCode: response.status,
          detail: `${options.label} responded ${response.status}, but did not return JSON`
        };
      }
    }

    if (options.requiredText?.length && !options.requiredText.some((marker) => body.includes(marker))) {
      return {
        ok: false,
        statusCode: response.status,
        detail: `${options.label} responded ${response.status}, but did not look like the Formic renderer`
      };
    }

    return { ok: true, statusCode: response.status, detail: `${options.label} responded ${response.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `${options.label} probe failed: ${message}` };
  }
}

async function waitForServer(timeoutMs = serverReadyTimeoutMs): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (lastServerError && !serverProcess && activeServerMode === 'spawned') {
      serverStatus = 'failed';
      throw new Error(lastServerError);
    }

    const healthProbe = await probeUrl(healthUrl, {
      label: 'Backend health',
      requireJsonStatus: true
    });
    lastServerProbe = healthProbe.detail;

    if (healthProbe.ok) {
      serverStatus = serverStatus === 'starting' ? 'healthy' : serverStatus;

      const readinessProbe = await probeUrl(readinessUrl, {
        label: 'Backend readiness',
        requireJsonStatus: true
      });
      lastServerProbe = readinessProbe.detail;

      if (readinessProbe.ok) {
        serverStatus = 'ready';
        console.log(`[formic-desktop] Backend ready at ${readinessUrl}`);
        return;
      }
    }

    await sleep(500);
  }

  serverStatus = 'failed';
  throw new Error(
    [
      `Timed out waiting for Formic server readiness at ${readinessUrl}`,
      lastServerProbe ? `Last probe: ${lastServerProbe}` : null,
      lastServerError ? `Last server error: ${lastServerError}` : null
    ]
      .filter(Boolean)
      .join('\n')
  );
}

function shouldWaitForRenderer(): boolean {
  try {
    const url = new URL(rendererUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function shouldSkipRendererLoad(): boolean {
  return rendererUrl === 'about:blank';
}

async function waitForRenderer(timeoutMs = rendererReadyTimeoutMs): Promise<void> {
  if (!shouldWaitForRenderer()) {
    rendererStatus = 'ready';
    return;
  }

  rendererStatus = 'checking';
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const rendererProbe = await probeUrl(rendererUrl, {
      label: 'Renderer',
      requiredText: ['<title>Formic</title>', '/static/loader.js']
    });
    lastRendererProbe = rendererProbe.detail;

    if (rendererProbe.ok) {
      rendererStatus = 'ready';
      console.log(`[formic-desktop] Renderer ready at ${rendererUrl}`);
      return;
    }

    await sleep(500);
  }

  rendererStatus = 'failed';
  lastRendererError = [
    `Timed out waiting for Formic renderer at ${rendererUrl}`,
    lastRendererProbe ? `Last probe: ${lastRendererProbe}` : null
  ]
    .filter(Boolean)
    .join('\n');
  throw new Error(lastRendererError);
}

function spawnServer(): void {
  if (serverProcess) {
    return;
  }

  const launchPlan = buildServerLaunchPlan();
  const userDataDir = desktopUserDataDir();
  const dataDir = process.env.DATA_DIR ?? path.join(userDataDir, 'backend-data');
  const staticDir = process.env.STATIC_DIR ?? path.join(userDataDir, 'backend-static');
  activeServerLaunchPlan = launchPlan;
  recentServerOutput.length = 0;

  const missingFiles = missingServerRootFiles(launchPlan.cwd, launchPlan.backendDir);
  if (missingFiles.length) {
    serverStatus = 'failed';
    lastServerError = `Server root is missing required files:\n${missingFiles.map((item) => `- ${item}`).join('\n')}`;
    return;
  }

  if (launchPlan.error) {
    serverStatus = 'failed';
    lastServerError = launchPlan.error;
    return;
  }

  try {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(staticDir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    serverStatus = 'failed';
    lastServerError = `Could not create writable desktop backend directories: ${message}`;
    return;
  }

  console.log(
    `[formic-desktop] Server launch plan: ${launchPlan.command} ${launchPlan.args.join(' ')} (${launchPlan.source})`
  );
  console.log(`[formic-desktop] Server root: ${launchPlan.cwd}`);
  console.log(`[formic-desktop] Server data dir: ${dataDir}`);

  serverProcess = spawn(launchPlan.command, [
    ...launchPlan.args,
    'open_webui.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    String(serverPort),
    '--forwarded-allow-ips',
    '*'
  ], {
    cwd: launchPlan.cwd,
    env: {
      ...process.env,
      CORS_ALLOW_ORIGIN: buildCorsAllowOrigin(),
      DATA_DIR: dataDir,
      FORMIC_DESKTOP: 'true',
      FORMIC_LAZY_EMBEDDINGS: process.env.FORMIC_LAZY_EMBEDDINGS ?? 'true',
      FORWARDED_ALLOW_IPS: '*',
      PORT: String(serverPort),
      PYTHONDONTWRITEBYTECODE: process.env.PYTHONDONTWRITEBYTECODE ?? '1',
      PYTHONPATH: launchPlan.backendDir,
      STATIC_DIR: staticDir,
      WEBUI_URL: serverUrl
    }
  });

  serverProcess.stdout.on('data', (chunk) => {
    recordServerOutput('stdout', chunk);
    console.log(`[formic-server] ${chunk.toString().trimEnd()}`);
  });

  serverProcess.stderr.on('data', (chunk) => {
    recordServerOutput('stderr', chunk);
    console.error(`[formic-server] ${chunk.toString().trimEnd()}`);
  });

  serverProcess.once('error', (error) => {
    serverStatus = 'failed';
    lastServerError = `Failed to start server process: ${error.message}`;
    serverProcess = null;
  });

  serverProcess.once('exit', (code, signal) => {
    if (!isQuitting) {
      serverStatus = 'failed';
      lastServerError = `Server exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`;
    }

    serverProcess = null;
  });
}

async function ensureServer(): Promise<void> {
  serverStatus = 'checking';
  lastServerError = null;
  lastServerProbe = null;

  const healthProbe = await probeUrl(healthUrl, {
    label: 'Backend health',
    requireJsonStatus: true
  });
  lastServerProbe = healthProbe.detail;

  if (healthProbe.ok) {
    activeServerMode = configuredServerMode === 'external' ? 'external' : 'existing';
    console.log(`[formic-desktop] Connecting to ${activeServerMode} backend at ${serverUrl}`);
    await waitForServer();
    return;
  }

  if (configuredServerMode === 'external') {
    activeServerMode = 'external';
    await waitForServer();
    return;
  }

  activeServerMode = 'spawned';
  serverStatus = 'starting';
  console.log(`[formic-desktop] Starting FastAPI backend at ${serverUrl}`);
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
    'main { width: min(560px, calc(100vw - 48px)); }',
    'h1 { margin: 0 0 12px; font-size: 28px; font-weight: 650; letter-spacing: 0; }',
    'p { margin: 0 0 18px; color: #b7c1c8; line-height: 1.5; }',
    '.bar { height: 6px; overflow: hidden; border-radius: 999px; background: #28313a; }',
    '.bar span { display: block; width: 42%; height: 100%; border-radius: inherit; background: #67d391; animation: slide 1.2s ease-in-out infinite; }',
    'dl { display: grid; grid-template-columns: 112px 1fr; gap: 8px 14px; margin: 22px 0 0; color: #d7dee3; }',
    'dt { color: #83909a; }',
    'dd { margin: 0; overflow-wrap: anywhere; }',
    'code { color: #eef3f6; }',
    '@keyframes slide { 0% { transform: translateX(-100%); } 50% { transform: translateX(80%); } 100% { transform: translateX(250%); } }',
    '</style>',
    '<main>',
    '<h1>Starting Formic</h1>',
    '<p id="message">Checking the local Formic backend...</p>',
    '<div class="bar"><span></span></div>',
    '<dl>',
    '<dt>Backend</dt><dd id="backend">checking</dd>',
    '<dt>Renderer</dt><dd id="renderer">waiting</dd>',
    '<dt>Mode</dt><dd id="mode">auto</dd>',
    '<dt>Backend URL</dt><dd id="server"></dd>',
    '<dt>Renderer URL</dt><dd id="renderer-url"></dd>',
    '<dt>Last probe</dt><dd id="probe"></dd>',
    '</dl>',
    '</main>',
    '<script>',
    'function messageFor(state) {',
    '  if (state.serverStatus === "starting") return "Starting the bundled FastAPI sidecar...";',
    '  if (state.serverStatus === "healthy") return "Backend is healthy; waiting for readiness...";',
    '  if (state.rendererStatus === "skipped") return "API-only smoke is running without loading a renderer.";',
    '  if (state.serverStatus === "ready" && state.rendererStatus !== "ready") return "Backend is ready; waiting for the Svelte renderer...";',
    '  if (state.rendererStatus === "loading") return "Loading the Formic app...";',
    '  return "Checking the local Formic backend...";',
    '}',
    'async function refresh() {',
    '  if (!window.formicDesktop) return;',
    '  const state = await window.formicDesktop.getServerStatus();',
    '  document.getElementById("backend").textContent = state.serverStatus;',
    '  document.getElementById("renderer").textContent = state.rendererStatus;',
    '  document.getElementById("mode").textContent = state.mode;',
    '  document.getElementById("server").textContent = state.serverUrl;',
    '  document.getElementById("renderer-url").textContent = state.rendererUrl;',
    '  document.getElementById("probe").textContent = state.lastServerProbe || state.lastRendererProbe || "";',
    '  document.getElementById("message").textContent = messageFor(state);',
    '}',
    'refresh(); setInterval(refresh, 500);',
    '</script>'
  ].join('');
}

function failureHtml(title: string, intro: string, details: string[]): string {
  return [
    '<!doctype html>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<body style="font: 14px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; margin: 32px; max-width: 800px; line-height: 1.5;">',
    `<h1>${escapeHtml(title)}</h1>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<pre style="white-space: pre-wrap; padding: 16px; background: #f5f5f5; border-radius: 8px;">${escapeHtml(details.filter(Boolean).join('\n'))}</pre>`,
    '</body>'
  ].join('');
}

function serverFailureHtml(message: string): string {
  return failureHtml('Formic Backend Failed', 'Electron opened, but the FastAPI backend did not become ready.', [
    message,
    `Mode: ${activeServerMode}`,
    `Launch plan:\n${formatServerLaunchPlan(activeServerLaunchPlan)}`,
    `Health URL: ${healthUrl}`,
    `Readiness URL: ${readinessUrl}`,
    lastServerProbe ? `Last probe: ${lastServerProbe}` : '',
    lastServerError ? `Last process error: ${lastServerError}` : '',
    recentServerOutput.length ? `Recent server output:\n${recentServerOutput.join('\n')}` : ''
  ]);
}

function rendererFailureHtml(message: string): string {
  return failureHtml('Formic Renderer Failed', 'The FastAPI backend is ready, but the Svelte renderer did not become available.', [
    message,
    `Renderer URL: ${rendererUrl}`,
    lastRendererProbe ? `Last probe: ${lastRendererProbe}` : ''
  ]);
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'Formic',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  await window.loadURL(htmlDataUrl(startupHtml()));

  try {
    await ensureServer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[formic-desktop] Backend startup failed: ${message}`);
    await window.loadURL(htmlDataUrl(serverFailureHtml(message)));
    return;
  }

  try {
    await waitForRenderer();

    if (shouldSkipRendererLoad()) {
      rendererStatus = 'skipped';
      console.log(`[formic-desktop] Renderer load skipped for API-only smoke: ${rendererUrl}`);
      return;
    }

    rendererStatus = 'loading';
    await window.loadURL(rendererUrl);
    rendererStatus = 'loaded';
    console.log(`[formic-desktop] Loaded renderer in Electron from ${rendererUrl}`);
  } catch (error) {
    rendererStatus = 'failed';
    const message = error instanceof Error ? error.message : String(error);
    lastRendererError = message;
    console.error(`[formic-desktop] Renderer startup failed: ${message}`);
    await window.loadURL(htmlDataUrl(rendererFailureHtml(message)));
  }
}

ipcMain.handle('formic:server-status', () => ({
  status: serverStatus,
  serverStatus,
  rendererStatus,
  mode: activeServerMode,
  configuredMode: configuredServerMode,
  serverUrl,
  healthUrl,
  readinessUrl,
  rendererUrl,
  lastServerError,
  lastServerProbe,
  lastRendererError,
  lastRendererProbe,
  serverRoot,
  serverLaunchPlan: activeServerLaunchPlan,
  recentServerOutput
}));

ipcMain.handle('formic:select-project-directory', async () => {
  const focusedWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options: OpenDialogOptions = {
    properties: ['openDirectory']
  };
  const result = focusedWindow
    ? await dialog.showOpenDialog(focusedWindow, options)
    : await dialog.showOpenDialog(options);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

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
  isQuitting = true;

  if (!serverProcess) {
    return;
  }

  const child = serverProcess;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), sleep(3000)]);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
});
