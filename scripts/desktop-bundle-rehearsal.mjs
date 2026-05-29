#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultBundleDir = path.join(repoRoot, 'build', 'desktop-rehearsal', 'formic-server');
const defaultPackageDir = path.join(repoRoot, 'build', 'desktop-rehearsal', 'packaged-app');
const defaultRuntimeDir = path.join(repoRoot, 'build', 'desktop-rehearsal', 'runtime-data');
const defaultPort = 18080;
const defaultTimeoutMs = 180000;

const rootContextFiles = [
  'pyproject.toml',
  'uv.lock',
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'CHANGELOG_TECHNICAL.md',
  'hatch_build.py'
];

const requiredBundleFiles = [
  'backend/open_webui/main.py',
  'backend/open_webui/env.py',
  'backend/open_webui/config.py',
  'backend/open_webui/static/loader.js',
  'pyproject.toml',
  'uv.lock',
  'package.json',
  'CHANGELOG.md'
];

function parseArgs(argv) {
  const options = {
    command: 'build',
    bundleDir: process.env.FORMIC_REHEARSAL_BUNDLE_DIR || defaultBundleDir,
    packageDir: process.env.FORMIC_REHEARSAL_PACKAGE_DIR || defaultPackageDir,
    port: Number(process.env.FORMIC_REHEARSAL_SERVER_PORT || defaultPort),
    timeoutMs: Number(process.env.FORMIC_REHEARSAL_TIMEOUT_MS || defaultTimeoutMs),
    clean: false,
    skipSync: false
  };

  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) {
    options.command = args.shift();
  }

  while (args.length > 0) {
    const arg = args.shift();

    if (arg === '--bundle-dir') {
      const value = args.shift();
      if (!value) {
        throw new Error('--bundle-dir requires a path');
      }
      options.bundleDir = path.resolve(repoRoot, value);
    } else if (arg === '--port') {
      const value = Number(args.shift());
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--port requires a positive number');
      }
      options.port = value;
    } else if (arg === '--timeout-ms') {
      const value = Number(args.shift());
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--timeout-ms requires a positive number');
      }
      options.timeoutMs = value;
    } else if (arg === '--clean') {
      options.clean = true;
    } else if (arg === '--skip-sync') {
      options.skipSync = true;
    } else if (arg === '--package-dir') {
      const value = args.shift();
      if (!value) {
        throw new Error('--package-dir requires a path');
      }
      options.packageDir = path.resolve(repoRoot, value);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!['build', 'smoke', 'resources-package', 'resources-smoke', 'print-path'].includes(options.command)) {
    throw new Error(`Unknown command: ${options.command}`);
  }

  return options;
}

function displayPath(value) {
  return path.relative(repoRoot, value) || '.';
}

function pythonPathForBundle(bundleDir) {
  return process.platform === 'win32'
    ? path.join(bundleDir, '.venv', 'Scripts', 'python.exe')
    : path.join(bundleDir, '.venv', 'bin', 'python');
}

async function pathExists(value) {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: options.env || process.env,
      stdio: options.stdio || 'inherit'
    });

    let stdout = '';
    if (options.stdio === 'pipe') {
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`));
      }
    });
  });
}

async function gitTrackedFiles(prefix) {
  const output = await run('git', ['ls-files', '-z', prefix], { stdio: 'pipe' });
  return output.split('\0').filter(Boolean);
}

async function copyFilePreservingMode(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);

  const sourceStat = await stat(source);
  await import('node:fs/promises').then(({ chmod }) => chmod(destination, sourceStat.mode));
}

async function copyTrackedBackend(bundleDir) {
  const backendDestination = path.join(bundleDir, 'backend');
  await rm(backendDestination, { recursive: true, force: true });

  const files = await gitTrackedFiles('backend');
  for (const file of files) {
    await copyFilePreservingMode(path.join(repoRoot, file), path.join(bundleDir, file));
  }

  return files.length;
}

async function copyRootContext(bundleDir) {
  for (const file of rootContextFiles) {
    const source = path.join(repoRoot, file);
    if (await pathExists(source)) {
      await copyFilePreservingMode(source, path.join(bundleDir, file));
    }
  }
}

async function validateBundle(bundleDir) {
  const missing = [];

  for (const file of requiredBundleFiles) {
    const fullPath = path.join(bundleDir, file);
    if (!(await pathExists(fullPath))) {
      missing.push(file);
    }
  }

  const pythonPath = pythonPathForBundle(bundleDir);
  if (!(await pathExists(pythonPath))) {
    missing.push(path.relative(bundleDir, pythonPath));
  }

  if (missing.length > 0) {
    throw new Error(
      [
        `The desktop server bundle is incomplete at ${bundleDir}.`,
        'Missing required files:',
        ...missing.map((file) => `- ${file}`),
        'Run `npm run desktop:bundle:build` to rebuild the rehearsal bundle.'
      ].join('\n')
    );
  }
}

async function writeManifest(bundleDir, backendFileCount) {
  const commit = (await run('git', ['rev-parse', '--short=12', 'HEAD'], { stdio: 'pipe' })).trim();
  const packageData = JSON.parse(await readFile(path.join(bundleDir, 'package.json'), 'utf8'));
  const manifest = {
    name: 'formic-server',
    rehearsal: true,
    createdAt: new Date().toISOString(),
    sourceRepo: repoRoot,
    sourceCommit: commit,
    version: packageData.version,
    backendFileCount,
    python: path.relative(bundleDir, pythonPathForBundle(bundleDir)),
    contains: ['backend/', 'pyproject.toml', 'uv.lock', '.venv/']
  };

  await writeFile(path.join(bundleDir, 'bundle-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function buildBundle(options) {
  const bundleDir = path.resolve(options.bundleDir);

  if (options.clean) {
    await rm(bundleDir, { recursive: true, force: true });
  }

  await mkdir(bundleDir, { recursive: true });
  const backendFileCount = await copyTrackedBackend(bundleDir);
  await copyRootContext(bundleDir);

  if (!options.skipSync) {
    await run('uv', ['sync', '--frozen', '--project', bundleDir, '--no-dev', '--no-install-project']);
  }

  await validateBundle(bundleDir);

  const importCheckDataDir = path.join(defaultRuntimeDir, 'import-check-data');
  const importCheckStaticDir = path.join(defaultRuntimeDir, 'import-check-static');
  await mkdir(importCheckDataDir, { recursive: true });
  await mkdir(importCheckStaticDir, { recursive: true });

  await run(
    pythonPathForBundle(bundleDir),
    [
      '-c',
      [
        'import fastapi, pydantic, sqlalchemy, starsessions, uvicorn',
        'print("bundle dependency imports ok")'
      ].join('; ')
    ],
    {
      cwd: bundleDir,
      env: {
        ...process.env,
        DATA_DIR: importCheckDataDir,
        FORMIC_DESKTOP: 'true',
        FORMIC_LAZY_EMBEDDINGS: 'true',
        PYTHONPATH: path.join(bundleDir, 'backend'),
        STATIC_DIR: importCheckStaticDir
      }
    }
  );

  await writeManifest(bundleDir, backendFileCount);
  console.log(`[formic-rehearsal] Bundle ready: ${displayPath(bundleDir)}`);
  return bundleDir;
}

async function probeJson(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs || 2000) });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}: ${text.slice(0, 240)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return JSON: ${text.slice(0, 240)}`);
  }
}

async function waitForEndpoint(url, validate, timeoutMs, assertStillValid = () => {}) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    assertStillValid();

    try {
      const json = await probeJson(url);
      validate(json);
      return json;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }

  assertStillValid();
  throw new Error(`Timed out waiting for ${url}${lastError ? `\nLast error: ${lastError.message}` : ''}`);
}

function assertNoStartupFailureOutput(output) {
  const failureMarkers = [
    'Backend startup failed',
    'Failed to start Formic',
    'Server exited with code',
    'ModuleNotFoundError',
    'Traceback (most recent call last)'
  ];
  const marker = failureMarkers.find((candidate) => output.includes(candidate));

  if (!marker) {
    return;
  }

  throw new Error(`Electron reported a startup failure during smoke (${marker}).`);
}

function localElectronBinary() {
  if (process.platform === 'darwin') {
    return path.join(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  }

  const binary = process.platform === 'win32' ? 'electron.cmd' : 'electron';
  return path.join(repoRoot, 'node_modules', '.bin', binary);
}

function electronBuilderBinary() {
  const binary = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder';
  return path.join(repoRoot, 'node_modules', '.bin', binary);
}

async function findDirectoriesBySuffix(root, suffix, maxDepth = 4) {
  const matches = [];

  async function visit(current, depth) {
    if (depth > maxDepth || !(await pathExists(current))) {
      return;
    }

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.name.endsWith(suffix)) {
        matches.push(fullPath);
        continue;
      }

      await visit(fullPath, depth + 1);
    }
  }

  await visit(root, 0);
  return matches;
}

async function findPackagedApp(packageDir) {
  if (process.platform !== 'darwin') {
    throw new Error('The packaged resources rehearsal currently expects a macOS .app directory.');
  }

  const apps = await findDirectoriesBySuffix(packageDir, '.app');
  if (apps.length !== 1) {
    throw new Error(`Expected exactly one packaged .app under ${displayPath(packageDir)}, found ${apps.length}.`);
  }

  const appDir = apps[0];
  const macOsDir = path.join(appDir, 'Contents', 'MacOS');
  const executables = (await readdir(macOsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(macOsDir, entry.name));

  if (executables.length === 0) {
    throw new Error(`No packaged app executable found under ${macOsDir}.`);
  }

  return {
    appDir,
    executable: executables[0],
    resourcesDir: path.join(appDir, 'Contents', 'Resources'),
    serverDir: path.join(appDir, 'Contents', 'Resources', 'formic-server')
  };
}

async function packageResourcesApp(options) {
  const bundleDir = await buildBundle(options);
  await run('npm', ['run', 'build', '--workspace', '@formic/desktop']);

  const packageDir = path.resolve(options.packageDir);
  await rm(packageDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });

  await run(electronBuilderBinary(), ['--config', 'electron-builder.desktop.cjs', '--dir'], {
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      FORMIC_ELECTRON_BUILDER_OUTPUT_DIR: packageDir,
      FORMIC_ELECTRON_BUILDER_SERVER_DIR: bundleDir
    }
  });

  const packagedApp = await findPackagedApp(packageDir);
  await validateBundle(packagedApp.serverDir);
  console.log(`[formic-rehearsal] Packaged app ready: ${displayPath(packagedApp.appDir)}`);
  console.log(`[formic-rehearsal] Packaged resources server: ${displayPath(packagedApp.serverDir)}`);
  return packagedApp;
}

async function stopProcessGroup(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill('SIGTERM');

  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
}

function assertPackagedResourceLaunchOutput(output, packagedApp) {
  assertNoStartupFailureOutput(output);

  if (!output.includes('bundled venv')) {
    throw new Error('Electron did not report the packaged bundled venv launch plan.');
  }

  if (!output.includes(packagedApp.serverDir)) {
    throw new Error(`Electron did not report the packaged resources server path: ${packagedApp.serverDir}`);
  }
}

async function ensurePortAvailable(port) {
  try {
    await probeJson(`http://127.0.0.1:${port}/health`, { timeoutMs: 500 });
  } catch {
    return;
  }

  throw new Error(`Port ${port} already has a healthy Formic backend. Choose another port with --port.`);
}

async function smokePackagedResources(options) {
  const packagedApp = await packageResourcesApp(options);
  await ensurePortAvailable(options.port);

  const serverUrl = `http://127.0.0.1:${options.port}`;
  const customRuntimeRoot = Boolean(process.env.FORMIC_REHEARSAL_RUNTIME_DIR);
  const runtimeRoot = customRuntimeRoot
    ? path.resolve(repoRoot, process.env.FORMIC_REHEARSAL_RUNTIME_DIR)
    : path.join(defaultRuntimeDir, `resources-smoke-${options.port}`);
  const runtimeDataDir = path.join(runtimeRoot, 'data');
  const runtimeStaticDir = path.join(runtimeRoot, 'backend-static');

  if (!customRuntimeRoot) {
    await rm(runtimeRoot, { recursive: true, force: true });
  }

  await mkdir(runtimeDataDir, { recursive: true });
  await mkdir(runtimeStaticDir, { recursive: true });

  const env = {
    ...process.env,
    FORMIC_SERVER_MODE: 'spawn',
    FORMIC_SERVER_PORT: String(options.port),
    FORMIC_SERVER_URL: serverUrl,
    FORMIC_RENDERER_URL: 'about:blank',
    FORMIC_SERVER_READY_TIMEOUT_MS: String(options.timeoutMs),
    FORMIC_LAZY_EMBEDDINGS: 'true',
    DATA_DIR: runtimeDataDir,
    STATIC_DIR: runtimeStaticDir
  };
  delete env.FORMIC_SERVER_BUNDLE_DIR;
  delete env.FORMIC_PYTHON;

  const electron = spawn(packagedApp.executable, [], {
    cwd: path.dirname(packagedApp.executable),
    detached: process.platform !== 'win32',
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  const capture = (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(text);
  };
  electron.stdout.on('data', capture);
  electron.stderr.on('data', capture);

  try {
    await waitForEndpoint(`${serverUrl}/health`, (json) => {
      if (json.status !== true) {
        throw new Error('/health status was not true');
      }
    }, options.timeoutMs, () => assertNoStartupFailureOutput(output));

    await waitForEndpoint(`${serverUrl}/ready`, (json) => {
      if (json.status !== true) {
        throw new Error('/ready status was not true');
      }
    }, options.timeoutMs, () => assertNoStartupFailureOutput(output));

    const version = await waitForEndpoint(`${serverUrl}/api/version`, (json) => {
      if (!json.version) {
        throw new Error('/api/version did not include a version');
      }
    }, options.timeoutMs, () => assertNoStartupFailureOutput(output));

    assertPackagedResourceLaunchOutput(output, packagedApp);

    console.log(
      `[formic-rehearsal] Packaged resources smoke passed: /health, /ready, /api/version=${version.version}`
    );
  } finally {
    await stopProcessGroup(electron);
  }
}

async function smokeBundle(options) {
  const bundleDir = await buildBundle(options);
  await run('npm', ['run', 'build', '--workspace', '@formic/desktop']);
  await ensurePortAvailable(options.port);

  const serverUrl = `http://127.0.0.1:${options.port}`;
  const customRuntimeRoot = Boolean(process.env.FORMIC_REHEARSAL_RUNTIME_DIR);
  const runtimeRoot = customRuntimeRoot
    ? path.resolve(repoRoot, process.env.FORMIC_REHEARSAL_RUNTIME_DIR)
    : path.join(defaultRuntimeDir, `smoke-${options.port}`);
  const runtimeDataDir = path.join(runtimeRoot, 'data');
  const runtimeStaticDir = path.join(runtimeRoot, 'backend-static');

  if (!customRuntimeRoot) {
    await rm(runtimeRoot, { recursive: true, force: true });
  }

  await mkdir(runtimeDataDir, { recursive: true });
  await mkdir(runtimeStaticDir, { recursive: true });

  const electron = spawn(localElectronBinary(), ['.'], {
    cwd: path.join(repoRoot, 'apps', 'desktop'),
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      FORMIC_SERVER_BUNDLE_DIR: bundleDir,
      FORMIC_SERVER_MODE: 'spawn',
      FORMIC_SERVER_PORT: String(options.port),
      FORMIC_SERVER_URL: serverUrl,
      FORMIC_RENDERER_URL: 'about:blank',
      FORMIC_SERVER_READY_TIMEOUT_MS: String(options.timeoutMs),
      FORMIC_LAZY_EMBEDDINGS: 'true',
      DATA_DIR: runtimeDataDir,
      STATIC_DIR: runtimeStaticDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  const capture = (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(text);
  };
  electron.stdout.on('data', capture);
  electron.stderr.on('data', capture);

  try {
    await waitForEndpoint(`${serverUrl}/health`, (json) => {
      if (json.status !== true) {
        throw new Error('/health status was not true');
      }
    }, options.timeoutMs, () => assertNoStartupFailureOutput(output));

    assertNoStartupFailureOutput(output);

    await waitForEndpoint(`${serverUrl}/ready`, (json) => {
      if (json.status !== true) {
        throw new Error('/ready status was not true');
      }
    }, options.timeoutMs, () => assertNoStartupFailureOutput(output));

    assertNoStartupFailureOutput(output);

    const version = await waitForEndpoint(`${serverUrl}/api/version`, (json) => {
      if (!json.version) {
        throw new Error('/api/version did not include a version');
      }
    }, options.timeoutMs, () => assertNoStartupFailureOutput(output));

    assertNoStartupFailureOutput(output);

    if (!output.includes('FORMIC_SERVER_BUNDLE_DIR venv')) {
      throw new Error('Electron did not report the FORMIC_SERVER_BUNDLE_DIR venv launch plan.');
    }

    console.log(`[formic-rehearsal] Smoke passed: /health, /ready, /api/version=${version.version}`);
  } finally {
    await stopProcessGroup(electron);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === 'print-path') {
    console.log(path.resolve(options.bundleDir));
    return;
  }

  if (options.command === 'build') {
    await buildBundle(options);
    return;
  }

  if (options.command === 'resources-package') {
    await packageResourcesApp(options);
    return;
  }

  if (options.command === 'resources-smoke') {
    await smokePackagedResources(options);
    return;
  }

  await smokeBundle(options);
  process.exit(0);
}

main().catch((error) => {
  console.error(`[formic-rehearsal] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
