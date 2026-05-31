#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { chmod, copyFile, cp, lstat, mkdir, readdir, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultRehearsalRoot = path.join(repoRoot, 'build', 'desktop-rehearsal');
const defaultBundleDir = path.join(defaultRehearsalRoot, 'formic-server');
const defaultPackageDir = path.join(defaultRehearsalRoot, 'packaged-app');
const defaultRelocationDir = path.join(defaultRehearsalRoot, 'relocation path with spaces');
const defaultRuntimeDir = path.join(defaultRehearsalRoot, 'runtime-data');
const defaultNotarizationDir = path.join(defaultRehearsalRoot, 'notarization');
const defaultDmgDir = path.join(defaultRehearsalRoot, 'dmg');
const defaultPort = 18080;
const defaultTimeoutMs = 180000;
const managedPythonRequest = '3.11';
const mainEntitlementsPath = path.join(repoRoot, 'apps', 'desktop', 'signing', 'entitlements.mac.plist');
const inheritedEntitlementsPath = path.join(repoRoot, 'apps', 'desktop', 'signing', 'entitlements.mac.inherit.plist');

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
    relocationDir: process.env.FORMIC_REHEARSAL_RELOCATION_DIR || defaultRelocationDir,
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
    } else if (arg === '--relocation-dir') {
      const value = args.shift();
      if (!value) {
        throw new Error('--relocation-dir requires a path');
      }
      options.relocationDir = path.resolve(repoRoot, value);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (
    ![
      'build',
      'smoke',
      'resources-package',
      'resources-smoke',
      'resources-managed-package',
      'resources-managed-smoke',
      'resources-managed-adhoc-sign-check',
      'resources-managed-signing-preflight',
      'resources-managed-developer-id-sign-check',
      'resources-managed-notarization-check',
      'resources-managed-dmg-check',
      'audit',
      'relocation-smoke',
      'managed-build',
      'managed-smoke',
      'print-path'
    ].includes(options.command)
  ) {
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

function managedPythonPathForBundle(bundleDir) {
  return process.platform === 'win32'
    ? path.join(bundleDir, 'python-runtime', 'python.exe')
    : path.join(bundleDir, 'python-runtime', 'bin', `python${managedPythonRequest}`);
}

async function selectedPythonPathForBundle(bundleDir) {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(bundleDir, '.venv', 'Scripts', 'python.exe'),
          path.join(bundleDir, 'venv', 'Scripts', 'python.exe'),
          managedPythonPathForBundle(bundleDir)
        ]
      : [
          path.join(bundleDir, '.venv', 'bin', 'python'),
          path.join(bundleDir, 'venv', 'bin', 'python'),
          managedPythonPathForBundle(bundleDir)
        ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

async function pathExists(value) {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}

async function withRehearsalLock(command, callback) {
  const lockDir = path.join(defaultRehearsalRoot, '.command-lock');
  await mkdir(defaultRehearsalRoot, { recursive: true });

  try {
    await mkdir(lockDir);
    await writeFile(path.join(lockDir, 'pid'), `${process.pid}\n${command}\n`);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new Error(
        `Another desktop rehearsal command is already running. Remove ${displayPath(lockDir)} only if that process is gone.`
      );
    }

    throw error;
  }

  try {
    return await callback();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function realPath(value) {
  return import('node:fs/promises').then(({ realpath }) => realpath(value));
}

async function walkFiles(root, visitor) {
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    const entryStat = await lstat(fullPath);
    await visitor(fullPath, entryStat);

    if (entryStat.isDirectory() && !entryStat.isSymbolicLink()) {
      await walkFiles(fullPath, visitor);
    }
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

function runResult(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolve({
        code,
        signal,
        stdout,
        stderr,
        output: `${stdout}${stderr}`
      });
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
  await chmod(destination, sourceStat.mode);
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

  const pythonPath = await selectedPythonPathForBundle(bundleDir);
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
  const pythonPath = await selectedPythonPathForBundle(bundleDir);
  const hasManagedRuntime = await pathExists(managedPythonPathForBundle(bundleDir));
  const manifest = {
    name: 'formic-server',
    rehearsal: true,
    createdAt: new Date().toISOString(),
    sourceRepo: repoRoot,
    sourceCommit: commit,
    version: packageData.version,
    backendFileCount,
    python: path.relative(bundleDir, pythonPath),
    pythonStrategy: hasManagedRuntime ? 'managed-runtime' : 'uv-venv',
    contains: hasManagedRuntime
      ? ['backend/', 'pyproject.toml', 'uv.lock', 'python-runtime/']
      : ['backend/', 'pyproject.toml', 'uv.lock', '.venv/']
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
  await rm(path.join(bundleDir, 'venv'), { recursive: true, force: true });
  await rm(path.join(bundleDir, 'python-runtime'), { recursive: true, force: true });
  await rm(path.join(bundleDir, 'requirements.lock.txt'), { force: true });

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

async function uvManagedPythonRoot() {
  const output = await run('uv', ['python', 'find', managedPythonRequest, '--managed-python', '--no-project', '--resolve-links'], {
    stdio: 'pipe'
  });
  const interpreterPath = output.trim();

  if (!interpreterPath) {
    throw new Error(`uv did not return a managed Python ${managedPythonRequest} interpreter path.`);
  }

  return path.resolve(interpreterPath, '..', '..');
}

async function buildManagedRuntimeBundle(options) {
  const bundleDir = path.resolve(options.bundleDir);
  const runtimeDir = path.join(bundleDir, 'python-runtime');
  const requirementsPath = path.join(bundleDir, 'requirements.lock.txt');

  if (options.clean) {
    await rm(bundleDir, { recursive: true, force: true });
  }

  await mkdir(bundleDir, { recursive: true });
  const backendFileCount = await copyTrackedBackend(bundleDir);
  await copyRootContext(bundleDir);
  await rm(path.join(bundleDir, '.venv'), { recursive: true, force: true });
  await rm(path.join(bundleDir, 'venv'), { recursive: true, force: true });
  await rm(runtimeDir, { recursive: true, force: true });

  const sourceRuntimeDir = await uvManagedPythonRoot();
  await cp(sourceRuntimeDir, runtimeDir, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true
  });

  await run(
    'uv',
    [
      'export',
      '--frozen',
      '--project',
      bundleDir,
      '--format',
      'requirements.txt',
      '--no-dev',
      '--no-emit-project',
      '--output-file',
      requirementsPath
    ],
    { cwd: bundleDir, stdio: 'pipe' }
  );

  await run('uv', [
    'pip',
    'install',
    '--system',
    '--break-system-packages',
    '--python',
    managedPythonPathForBundle(bundleDir),
    '--requirements',
    requirementsPath,
    '--link-mode',
    'copy'
  ]);

  await validateBundle(bundleDir);

  const importCheckDataDir = path.join(defaultRuntimeDir, 'managed-import-check-data');
  const importCheckStaticDir = path.join(defaultRuntimeDir, 'managed-import-check-static');
  await mkdir(importCheckDataDir, { recursive: true });
  await mkdir(importCheckStaticDir, { recursive: true });

  await run(
    managedPythonPathForBundle(bundleDir),
    [
      '-c',
      [
        'import fastapi, pydantic, sqlalchemy, starsessions, uvicorn',
        'print("managed runtime dependency imports ok")'
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
  console.log(`[formic-rehearsal] Managed runtime copied from: ${sourceRuntimeDir}`);
  console.log(`[formic-rehearsal] Managed runtime bundle ready: ${displayPath(bundleDir)}`);
  return bundleDir;
}

function isInsidePath(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isLikelyNativeFile(filePath) {
  return ['.so', '.dylib', '.pyd', '.dll'].some((suffix) => filePath.endsWith(suffix));
}

function isLikelyTextFile(filePath) {
  const basename = path.basename(filePath);
  const extension = path.extname(filePath);

  return (
    basename === 'pyvenv.cfg' ||
    basename === 'RECORD' ||
    basename === 'entry_points.txt' ||
    basename === 'direct_url.json' ||
    extension === '.pth' ||
    extension === '.cfg' ||
    extension === '.txt' ||
    extension === '.json' ||
    extension === '.toml' ||
    filePath.includes(`${path.sep}.venv${path.sep}bin${path.sep}`) ||
    filePath.includes(`${path.sep}python-runtime${path.sep}bin${path.sep}`)
  );
}

function pushSample(list, value, limit = 12) {
  if (list.length < limit) {
    list.push(value);
  }
}

async function auditBundle(options) {
  const bundleDir = path.resolve(options.bundleDir);
  await validateBundle(bundleDir);

  const pythonPath = await selectedPythonPathForBundle(bundleDir);
  const managedRuntimeDir = path.join(bundleDir, 'python-runtime');
  const venvDir = path.join(bundleDir, '.venv');
  const artifactDir = (await pathExists(managedRuntimeDir)) ? managedRuntimeDir : venvDir;
  const artifactStat = await stat(artifactDir);
  const artifactLabel = path.relative(bundleDir, artifactDir);
  const audit = {
    bundleDir,
    artifactDir,
    artifactLabel,
    python: pythonPath,
    pythonRealPath: null,
    fileCount: 0,
    directoryCount: 1,
    symlinkCount: 0,
    brokenSymlinkCount: 0,
    absoluteSymlinkCount: 0,
    externalSymlinkCount: 0,
    executableFileCount: 0,
    nativeFileCount: 0,
    totalBytes: artifactStat.size,
    absoluteReferenceCount: 0,
    absoluteShebangCount: 0,
    bundlePathReferenceCount: 0,
    repoPathReferenceCount: 0,
    samples: {
      externalSymlinks: [],
      absoluteShebangs: [],
      absoluteReferences: [],
      nativeFiles: []
    }
  };

  try {
    audit.pythonRealPath = await realPath(audit.python);
  } catch {
    audit.pythonRealPath = null;
  }

  await walkFiles(artifactDir, async (filePath, entryStat) => {
    const relative = path.relative(bundleDir, filePath);
    audit.totalBytes += entryStat.size;

    if (entryStat.isDirectory()) {
      audit.directoryCount += 1;
      return;
    }

    if (entryStat.isSymbolicLink()) {
      audit.symlinkCount += 1;
      const target = await readlink(filePath);
      const resolvedTarget = path.isAbsolute(target) ? target : path.resolve(path.dirname(filePath), target);
      const isExternal = !isInsidePath(resolvedTarget, bundleDir);

      if (path.isAbsolute(target)) {
        audit.absoluteSymlinkCount += 1;
      }

      if (isExternal) {
        audit.externalSymlinkCount += 1;
        pushSample(audit.samples.externalSymlinks, `${relative} -> ${target}`);
      }

      if (!(await pathExists(resolvedTarget))) {
        audit.brokenSymlinkCount += 1;
      }

      return;
    }

    audit.fileCount += 1;

    if ((entryStat.mode & 0o111) !== 0) {
      audit.executableFileCount += 1;
    }

    if (isLikelyNativeFile(filePath)) {
      audit.nativeFileCount += 1;
      pushSample(audit.samples.nativeFiles, relative);
    }

    if (!isLikelyTextFile(filePath) || entryStat.size > 1024 * 1024) {
      return;
    }

    let text = '';
    try {
      text = await readFile(filePath, 'utf8');
    } catch {
      return;
    }

    const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
    if (firstLine.startsWith('#!/')) {
      const shebangTarget = firstLine.slice(2).split(/\s+/, 1)[0];
      if (path.isAbsolute(shebangTarget)) {
        audit.absoluteShebangCount += 1;
        pushSample(audit.samples.absoluteShebangs, `${relative}: ${firstLine}`);
      }
    }

    const absoluteMatches = [...text.matchAll(/(?:\/Users|\/private|\/opt|\/usr\/local|\/var\/folders)\/[^\s"')\]}]+/g)];

    if (absoluteMatches.length > 0) {
      audit.absoluteReferenceCount += absoluteMatches.length;
      pushSample(audit.samples.absoluteReferences, `${relative}: ${absoluteMatches[0][0]}`);
    }

    if (text.includes(bundleDir)) {
      audit.bundlePathReferenceCount += 1;
    }

    if (text.includes(repoRoot)) {
      audit.repoPathReferenceCount += 1;
    }
  });

  const risks = [];
  if (audit.pythonRealPath && !isInsidePath(audit.pythonRealPath, bundleDir)) {
    risks.push(`Python executable resolves outside the bundle: ${audit.pythonRealPath}`);
  }
  if (audit.externalSymlinkCount > 0) {
    risks.push(`${audit.externalSymlinkCount} symlink(s) resolve outside the bundle.`);
  }
  if (audit.absoluteShebangCount > 0) {
    risks.push(`${audit.absoluteShebangCount} console script shebang(s) contain absolute paths.`);
  }
  if (audit.nativeFileCount > 0 && process.platform === 'darwin') {
    risks.push(`${audit.nativeFileCount} native library file(s) will need recursive Developer ID signing.`);
  }
  if (audit.totalBytes > 1024 * 1024 * 1024) {
    risks.push(`The Python artifact is large (${formatBytes(audit.totalBytes)}), before installer compression or pruning.`);
  }

  console.log(`[formic-rehearsal] Bundle audit: ${displayPath(bundleDir)}`);
  console.log(`[formic-rehearsal] Python artifact: ${artifactLabel}`);
  console.log(`[formic-rehearsal] Python: ${path.relative(bundleDir, audit.python)}`);
  console.log(`[formic-rehearsal] Python real path: ${audit.pythonRealPath ?? 'unresolved'}`);
  console.log(
    `[formic-rehearsal] ${artifactLabel}: ${formatBytes(audit.totalBytes)}, ${audit.fileCount} files, ${audit.directoryCount} directories`
  );
  console.log(`[formic-rehearsal] Symlinks: ${audit.symlinkCount} total, ${audit.absoluteSymlinkCount} absolute, ${audit.externalSymlinkCount} external, ${audit.brokenSymlinkCount} broken`);
  console.log(`[formic-rehearsal] Executables/native: ${audit.executableFileCount} executable files, ${audit.nativeFileCount} native library files`);
  console.log(
    `[formic-rehearsal] Absolute text refs: ${audit.absoluteReferenceCount} matches, ${audit.absoluteShebangCount} shebangs, ${audit.bundlePathReferenceCount} files mention this bundle path`
  );

  for (const [label, values] of Object.entries(audit.samples)) {
    if (values.length === 0) {
      continue;
    }

    console.log(`[formic-rehearsal] Sample ${label}:`);
    for (const value of values) {
      console.log(`  - ${value}`);
    }
  }

  if (risks.length > 0) {
    console.log('[formic-rehearsal] Signing/distribution risks found:');
    for (const risk of risks) {
      console.log(`  - ${risk}`);
    }
  } else {
    console.log('[formic-rehearsal] No obvious relocation/signing risks found in the copied .venv.');
  }

  return audit;
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
    'Renderer startup failed',
    'Failed to start Formic',
    'Server exited with code',
    'ModuleNotFoundError',
    'Traceback (most recent call last)',
    'UnhandledPromiseRejectionWarning'
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

async function packageResourcesApp(options, { managed = false, signingMode = 'unsigned', identity = '' } = {}) {
  const bundleDir = managed ? await buildManagedRuntimeBundle(options) : await buildBundle(options);
  await run('npm', ['run', 'build', '--workspace', '@formic/desktop']);

  const packageDir = path.resolve(options.packageDir);
  await rm(packageDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });

  await run(electronBuilderBinary(), ['--config', 'electron-builder.desktop.cjs', '--dir'], {
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: signingMode === 'developer-id' ? 'true' : 'false',
      CSC_NAME: identity || process.env.CSC_NAME || '',
      FORMIC_DEVELOPER_IDENTITY: identity || process.env.FORMIC_DEVELOPER_IDENTITY || '',
      FORMIC_ELECTRON_BUILDER_SIGNING_MODE: signingMode,
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

function assertPackagedResourceLaunchOutput(output, packagedApp, expectedLaunchMarker = 'bundled venv') {
  assertNoStartupFailureOutput(output);

  if (!output.includes(expectedLaunchMarker)) {
    throw new Error(`Electron did not report the packaged launch plan: ${expectedLaunchMarker}`);
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

async function smokePackagedApp(
  packagedApp,
  options,
  { managed = false, runtimeName = null, useDefaultDesktopBackendDirs = false } = {}
) {
  await ensurePortAvailable(options.port);

  const serverUrl = `http://127.0.0.1:${options.port}`;
  const customRuntimeRoot = Boolean(process.env.FORMIC_REHEARSAL_RUNTIME_DIR);
  const runtimeRoot = customRuntimeRoot
    ? path.resolve(repoRoot, process.env.FORMIC_REHEARSAL_RUNTIME_DIR)
    : path.join(defaultRuntimeDir, `${runtimeName ?? (managed ? 'resources-managed-smoke' : 'resources-smoke')}-${options.port}`);
  const runtimeDataDir = path.join(runtimeRoot, 'data');
  const runtimeStaticDir = path.join(runtimeRoot, 'backend-static');
  const runtimeUserDataDir = path.join(runtimeRoot, 'electron-user-data');

  if (!customRuntimeRoot) {
    await rm(runtimeRoot, { recursive: true, force: true });
  }

  if (useDefaultDesktopBackendDirs) {
    await mkdir(runtimeUserDataDir, { recursive: true });
  } else {
    await mkdir(runtimeDataDir, { recursive: true });
    await mkdir(runtimeStaticDir, { recursive: true });
  }

  const env = {
    ...process.env,
    FORMIC_DESKTOP_USER_DATA_DIR: runtimeUserDataDir,
    FORMIC_SERVER_MODE: 'spawn',
    FORMIC_SERVER_PORT: String(options.port),
    FORMIC_SERVER_URL: serverUrl,
    FORMIC_RENDERER_URL: 'about:blank',
    FORMIC_SERVER_READY_TIMEOUT_MS: String(options.timeoutMs),
    FORMIC_LAZY_EMBEDDINGS: 'true'
  };
  if (useDefaultDesktopBackendDirs) {
    delete env.DATA_DIR;
    delete env.STATIC_DIR;
  } else {
    env.DATA_DIR = runtimeDataDir;
    env.STATIC_DIR = runtimeStaticDir;
  }
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

  let smokeError = null;

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

    assertPackagedResourceLaunchOutput(output, packagedApp, managed ? 'bundled managed Python runtime' : 'bundled venv');

    console.log(
      `[formic-rehearsal] Packaged resources ${managed ? 'managed ' : ''}smoke passed: /health, /ready, /api/version=${version.version}`
    );
  } catch (error) {
    smokeError = error;
  } finally {
    await stopProcessGroup(electron);
  }

  assertNoStartupFailureOutput(output);
  if (smokeError) {
    throw smokeError;
  }
}

async function smokePackagedResources(options, { managed = false } = {}) {
  const packagedApp = await packageResourcesApp(options, { managed });
  if (managed) {
    await auditBundle({ ...options, bundleDir: packagedApp.serverDir });
  }

  await smokePackagedApp(packagedApp, options, { managed });
}

async function localOnlyAdHocSignCheck(options) {
  if (process.platform !== 'darwin') {
    throw new Error('The local-only ad-hoc signing check currently expects macOS codesign.');
  }

  const packagedApp = await packageResourcesApp(options, { managed: true });
  await auditBundle({ ...options, bundleDir: packagedApp.serverDir });

  console.log('[formic-rehearsal] Local-only ad-hoc signing check: codesign --sign - is not Developer ID signing or notarization.');
  await run('codesign', ['--force', '--deep', '--sign', '-', packagedApp.appDir]);
  await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', packagedApp.appDir]);
  console.log(`[formic-rehearsal] Local-only ad-hoc signing check passed: ${displayPath(packagedApp.appDir)}`);
}

function developerIdIdentityFromEnv() {
  return process.env.FORMIC_DEVELOPER_IDENTITY || process.env.CSC_NAME || '';
}

function developerIdIdentitiesFromSecurityOutput(output) {
  return output
    .split('\n')
    .map((line) => line.match(/"([^"]+)"/)?.[1] || '')
    .filter((identity) => identity.startsWith('Developer ID Application:'));
}

async function findDeveloperIdIdentities() {
  const identities = await runResult('security', ['find-identity', '-v', '-p', 'codesigning']);
  return {
    code: identities.code,
    output: identities.output,
    identities: identities.code === 0 ? developerIdIdentitiesFromSecurityOutput(identities.output) : []
  };
}

async function resolveDeveloperIdIdentity() {
  const identity = developerIdIdentityFromEnv();
  if (identity) {
    return identity;
  }

  const discovered = await findDeveloperIdIdentities();
  if (discovered.identities.length === 1) {
    const [discoveredIdentity] = discovered.identities;
    console.log(`[formic-rehearsal] Developer ID signing identity auto-detected: ${discoveredIdentity}`);
    return discoveredIdentity;
  }

  if (discovered.identities.length > 1) {
    throw new Error(
      [
        'Developer ID signing found multiple Developer ID Application identities.',
        'Set FORMIC_DEVELOPER_IDENTITY or CSC_NAME to choose one explicitly.',
        'Available Developer ID Application identities:',
        ...discovered.identities.map((discoveredIdentity) => `  - ${discoveredIdentity}`)
      ].join('\n')
    );
  }

  throw new Error(
    [
      'Developer ID signing requires FORMIC_DEVELOPER_IDENTITY or CSC_NAME when no single Developer ID Application identity can be auto-detected.',
      'Example:',
      '  FORMIC_DEVELOPER_IDENTITY="Developer ID Application: Example, Inc. (TEAMID1234)" npm run desktop:resources:managed-developer-id-sign-check',
      'This command does not read notarization credentials and does not fall back to ad-hoc signing.',
      'Available signing identities reported by security:',
      discovered.output.trim() || '(none)'
    ].join('\n')
  );
}

async function assertDeveloperIdIdentity(identity) {
  if (!identity) {
    throw new Error(
      [
        'Developer ID signing requires FORMIC_DEVELOPER_IDENTITY or CSC_NAME.',
        'Example:',
        '  FORMIC_DEVELOPER_IDENTITY="Developer ID Application: Example, Inc. (TEAMID1234)" npm run desktop:resources:managed-developer-id-sign-check',
        'This command does not read notarization credentials and does not fall back to ad-hoc signing.'
      ].join('\n')
    );
  }

  if (!identity.startsWith('Developer ID Application:')) {
    throw new Error(`Expected a Developer ID Application identity, received: ${identity}`);
  }

  const identities = await findDeveloperIdIdentities();
  if (identities.code !== 0 || !identities.identities.includes(identity)) {
    throw new Error(
      [
        `Developer ID identity was not found in the local keychain: ${identity}`,
        'Install the Developer ID Application certificate and private key, then retry with:',
        '  FORMIC_DEVELOPER_IDENTITY="Developer ID Application: Example, Inc. (TEAMID1234)" npm run desktop:resources:managed-developer-id-sign-check',
        'Available signing identities reported by security:',
        identities.output.trim() || '(none)'
      ].join('\n')
    );
  }
}

function isMachODescription(description) {
  return description.startsWith('Mach-O') || description.startsWith('universal binary');
}

function signingDepth(filePath, root) {
  return path.relative(root, filePath).split(path.sep).length;
}

async function inspectMachOFile(filePath) {
  const fileResult = await runResult('file', ['-b', filePath]);
  if (fileResult.code !== 0 || !isMachODescription(fileResult.stdout.trim())) {
    return null;
  }

  const signature = await runResult('codesign', ['--verify', '--verbose=1', filePath]);
  return {
    path: filePath,
    description: fileResult.stdout.trim(),
    signed: signature.code === 0,
    signatureOutput: signature.output.trim()
  };
}

async function collectMachOSigningInventory(root) {
  const files = [];

  await walkFiles(root, async (filePath, entryStat) => {
    if (entryStat.isDirectory() || entryStat.isSymbolicLink()) {
      return;
    }

    const shouldInspect = isLikelyNativeFile(filePath) || (entryStat.mode & 0o111) !== 0;
    if (!shouldInspect) {
      return;
    }

    const inspected = await inspectMachOFile(filePath);
    if (inspected) {
      files.push(inspected);
    }
  });

  files.sort((left, right) => {
    const depth = signingDepth(right.path, root) - signingDepth(left.path, root);
    return depth || path.relative(root, left.path).localeCompare(path.relative(root, right.path));
  });

  return files;
}

function logMachOSigningInventory(root, files) {
  const unsigned = files.filter((file) => !file.signed);
  console.log(`[formic-rehearsal] Mach-O signing inventory root: ${displayPath(root)}`);
  console.log(`[formic-rehearsal] Mach-O/signable files: ${files.length} total, ${unsigned.length} currently unsigned`);
  console.log('[formic-rehearsal] Intended signing order: electron-builder signs Electron-managed app files while ignoring formic-server, then python-runtime Mach-O files are signed deepest-first, then the outer .app is re-signed and verified.');

  const sampleFiles = files.slice(0, 12);
  if (sampleFiles.length > 0) {
    console.log('[formic-rehearsal] Sample signing order:');
    for (const file of sampleFiles) {
      console.log(`  - ${path.relative(root, file.path)}${file.signed ? ' (already signed)' : ' (unsigned)'}`);
    }
  }

  const sampleUnsigned = unsigned.slice(0, 12);
  if (sampleUnsigned.length > 0) {
    console.log('[formic-rehearsal] Sample unsigned Mach-O files:');
    for (const file of sampleUnsigned) {
      console.log(`  - ${path.relative(root, file.path)}`);
    }
  }
}

async function managedSigningPreflight(options) {
  if (process.platform !== 'darwin') {
    throw new Error('The managed signing preflight currently expects macOS codesign/file tooling.');
  }

  const packagedApp = await packageResourcesApp(options, { managed: true });
  const audit = await auditBundle({ ...options, bundleDir: packagedApp.serverDir });
  const runtimeDir = path.join(packagedApp.serverDir, 'python-runtime');
  const machOFiles = await collectMachOSigningInventory(runtimeDir);
  logMachOSigningInventory(runtimeDir, machOFiles);

  const identity = developerIdIdentityFromEnv();
  console.log(`[formic-rehearsal] Developer ID identity: ${identity || '(not configured)'}`);
  console.log('[formic-rehearsal] Notarization credentials are intentionally not read by this checkpoint.');

  return { packagedApp, audit, machOFiles };
}

async function signPathWithDeveloperId(filePath, identity, entitlementsPath) {
  const args = ['--force', '--timestamp', '--options', 'runtime', '--sign', identity];
  if (entitlementsPath) {
    args.push('--entitlements', entitlementsPath);
  }
  args.push(filePath);
  await run('codesign', args);
}

async function verifyCodesignedApp(appDir) {
  await run('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appDir]);
}

async function runSpctlDiagnostic(appDir) {
  const result = await runResult('spctl', ['--assess', '--type', 'execute', '--verbose=4', appDir]);
  const output = result.output.trim();
  console.log(`[formic-rehearsal] spctl diagnostic exit code: ${result.code ?? 'null'}`);
  if (output) {
    console.log(output);
  }
  console.log('[formic-rehearsal] spctl is diagnostic only before notarization; this checkpoint does not require Gatekeeper acceptance.');
}

async function signManagedDeveloperIdApp(options, { runPreflight = true } = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('The Developer ID signing check currently expects macOS codesign.');
  }

  const preflight = runPreflight ? await managedSigningPreflight(options) : null;
  const identity = await resolveDeveloperIdIdentity();
  await assertDeveloperIdIdentity(identity);

  console.log(`[formic-rehearsal] Developer ID signing identity: ${identity}`);
  console.log('[formic-rehearsal] Packaging with hardened runtime enabled through electron-builder.');
  console.log('[formic-rehearsal] electron-builder is configured to ignore Contents/Resources/formic-server; the rehearsal signs only discovered Python Mach-O files.');
  const packagedApp = await packageResourcesApp(options, {
    managed: true,
    signingMode: 'developer-id',
    identity
  });
  await auditBundle({ ...options, bundleDir: packagedApp.serverDir });

  const runtimeDir = path.join(packagedApp.serverDir, 'python-runtime');
  const machOFiles = await collectMachOSigningInventory(runtimeDir);
  logMachOSigningInventory(runtimeDir, machOFiles);

  for (const file of machOFiles) {
    await signPathWithDeveloperId(file.path, identity, inheritedEntitlementsPath);
  }

  await signPathWithDeveloperId(packagedApp.appDir, identity, mainEntitlementsPath);
  await verifyCodesignedApp(packagedApp.appDir);

  return { packagedApp, preflight, machOFiles };
}

async function developerIdSignCheck(options) {
  const { packagedApp, preflight } = await signManagedDeveloperIdApp(options);
  await runSpctlDiagnostic(packagedApp.appDir);

  await smokePackagedApp(packagedApp, options, {
    managed: true,
    runtimeName: 'resources-managed-developer-id-sign-smoke'
  });
  await verifyCodesignedApp(packagedApp.appDir);
  console.log('[formic-rehearsal] Developer ID signing check passed; notarization was not attempted.');

  return preflight;
}

function notarizationCredentialArgsFromEnv() {
  const keychainProfile =
    process.env.APPLE_NOTARY_KEYCHAIN_PROFILE ||
    process.env.NOTARYTOOL_KEYCHAIN_PROFILE ||
    process.env.APPLE_NOTARY_PROFILE ||
    '';

  if (keychainProfile) {
    return {
      mode: 'notarytool keychain profile',
      profileName: keychainProfile,
      args: ['--keychain-profile', keychainProfile]
    };
  }

  const appleId = process.env.APPLE_ID || '';
  const appSpecificPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || '';
  const appleTeamId = process.env.APPLE_TEAM_ID || '';
  const appleIdValues = [
    ['APPLE_ID', appleId],
    ['APPLE_APP_SPECIFIC_PASSWORD', appSpecificPassword],
    ['APPLE_TEAM_ID', appleTeamId]
  ];
  const appleIdPresent = appleIdValues.filter(([, value]) => Boolean(value));

  if (appleIdPresent.length === appleIdValues.length) {
    return {
      mode: 'Apple ID + app-specific password',
      args: ['--apple-id', appleId, '--password', appSpecificPassword, '--team-id', appleTeamId]
    };
  }

  const apiKey = process.env.APPLE_API_KEY || process.env.APP_STORE_CONNECT_API_KEY || process.env.ASC_API_KEY || '';
  const apiKeyId =
    process.env.APPLE_API_KEY_ID || process.env.APP_STORE_CONNECT_API_KEY_ID || process.env.ASC_KEY_ID || '';
  const apiIssuer =
    process.env.APPLE_API_ISSUER ||
    process.env.APP_STORE_CONNECT_API_ISSUER ||
    process.env.APP_STORE_CONNECT_ISSUER_ID ||
    process.env.ASC_ISSUER_ID ||
    '';
  const apiValues = [
    ['APPLE_API_KEY', apiKey],
    ['APPLE_API_KEY_ID', apiKeyId],
    ['APPLE_API_ISSUER', apiIssuer]
  ];
  const apiPresent = apiValues.filter(([, value]) => Boolean(value));

  if (apiPresent.length === apiValues.length) {
    return {
      mode: 'App Store Connect API key',
      args: ['--key', apiKey, '--key-id', apiKeyId, '--issuer', apiIssuer]
    };
  }

  if (appleIdPresent.length > 0 || apiPresent.length > 0) {
    const missingAppleId = appleIdValues.filter(([, value]) => !value).map(([name]) => name);
    const missingApi = apiValues.filter(([, value]) => !value).map(([name]) => name);
    throw new Error(
      [
        'Notarization credentials are incomplete.',
        appleIdPresent.length > 0 ? `Missing Apple ID variable(s): ${missingAppleId.join(', ')}` : null,
        apiPresent.length > 0 ? `Missing App Store Connect API key variable(s): ${missingApi.join(', ')}` : null,
        'Provide either the complete Apple ID set or the complete App Store Connect API key set.'
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  return null;
}

function assertNotarizationCredentials() {
  const credentials = notarizationCredentialArgsFromEnv();
  if (credentials) {
    return credentials;
  }

  throw new Error(
    [
      'Notarization requires Apple notary credentials; none were found.',
      'FORMIC_DEVELOPER_IDENTITY may be omitted when exactly one Developer ID Application identity is available locally.',
      'Use Apple ID credentials:',
      '  FORMIC_DEVELOPER_IDENTITY="Developer ID Application: Example, Inc. (TEAMID1234)" \\',
      '  APPLE_ID="developer@example.com" \\',
      '  APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx" \\',
      '  APPLE_TEAM_ID="TEAMID1234" \\',
      '  npm run desktop:resources:managed-notarization-check',
      'Or use an App Store Connect API key file:',
      '  FORMIC_DEVELOPER_IDENTITY="Developer ID Application: Example, Inc. (TEAMID1234)" \\',
      '  APPLE_API_KEY="/path/to/AuthKey_ABC123DEFG.p8" \\',
      '  APPLE_API_KEY_ID="ABC123DEFG" \\',
      '  APPLE_API_ISSUER="00000000-0000-0000-0000-000000000000" \\',
      '  npm run desktop:resources:managed-notarization-check',
      'Or use a notarytool keychain profile created with xcrun notarytool store-credentials:',
      '  FORMIC_DEVELOPER_IDENTITY="Developer ID Application: Example, Inc. (TEAMID1234)" \\',
      '  APPLE_NOTARY_KEYCHAIN_PROFILE="formic-notary" \\',
      '  npm run desktop:resources:managed-notarization-check',
      'The signing preflight and Developer ID signing-only commands do not require these notarization variables.'
    ].join('\n')
  );
}

async function assertXcrunTool(toolName) {
  const result = await runResult('xcrun', ['--find', toolName]);
  if (result.code !== 0) {
    throw new Error(
      [
        `xcrun could not find ${toolName}.`,
        'Install Xcode command line tools or select a full Xcode with:',
        '  sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer',
        result.output.trim()
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
}

async function assertCommandAvailable(command, setupMessage) {
  let result;
  try {
    result = await runResult(command, ['help']);
  } catch (error) {
    throw new Error(
      [`Could not run ${command}.`, setupMessage, error instanceof Error ? error.message : String(error)]
        .filter(Boolean)
        .join('\n')
    );
  }

  if (result.code !== 0) {
    throw new Error(
      [`Could not run ${command}.`, setupMessage, result.output.trim()]
        .filter(Boolean)
        .join('\n')
    );
  }
}

async function assertNotarizationCredentialsUsable(credentials) {
  console.log(`[formic-rehearsal] Validating notarization credentials with ${credentials.mode}.`);
  const result = await runResult('xcrun', [
    'notarytool',
    'history',
    ...credentials.args,
    '--output-format',
    'json'
  ]);

  if (result.code !== 0) {
    throw new Error(
      [
        'Notarization credentials were not accepted by notarytool before packaging.',
        result.output.trim() || '(no output)',
        credentials.mode === 'notarytool keychain profile'
          ? `Recreate the profile with: xcrun notarytool store-credentials ${credentials.profileName}`
          : null
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  console.log('[formic-rehearsal] Notarization credentials accepted by notarytool.');
}

async function prepareNotarizationZip(appDir) {
  const zipPath = path.join(defaultNotarizationDir, `${path.basename(appDir, '.app')}-notarization.zip`);
  await rm(defaultNotarizationDir, { recursive: true, force: true });
  await mkdir(defaultNotarizationDir, { recursive: true });
  await run('ditto', ['-c', '-k', '--keepParent', path.basename(appDir), zipPath], {
    cwd: path.dirname(appDir)
  });
  const zipStat = await stat(zipPath);
  console.log(`[formic-rehearsal] Notarization artifact ready: ${displayPath(zipPath)} (${formatBytes(zipStat.size)})`);
  return zipPath;
}

async function submitForNotarization(zipPath, credentials) {
  console.log(`[formic-rehearsal] Submitting notarization artifact with ${credentials.mode}.`);
  const result = await runResult('xcrun', [
    'notarytool',
    'submit',
    zipPath,
    ...credentials.args,
    '--wait',
    '--output-format',
    'json'
  ]);

  const output = result.output.trim();
  let parsed = null;
  if (output) {
    try {
      parsed = JSON.parse(output);
    } catch {
      // Keep the raw output below when notarytool does not return JSON.
    }
  }

  if (result.code !== 0) {
    throw new Error(`notarytool submit failed.\n${output || '(no output)'}`);
  }

  if (!parsed) {
    throw new Error(`notarytool submit did not return JSON output.\n${output || '(no output)'}`);
  }

  console.log(`[formic-rehearsal] Notarization id: ${parsed.id ?? '(unknown)'}`);
  console.log(`[formic-rehearsal] Notarization status: ${parsed.status ?? '(unknown)'}`);

  if (parsed.status !== 'Accepted') {
    throw new Error(
      [
        `Notarization was not accepted: ${parsed.status ?? '(unknown status)'}.`,
        parsed.id ? `Inspect the log with: xcrun notarytool log ${parsed.id} <credentials>` : null,
        output
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  return parsed;
}

async function stapleAndValidate(appDir) {
  await run('xcrun', ['stapler', 'staple', '-v', appDir]);
  await run('xcrun', ['stapler', 'validate', '-v', appDir]);
  console.log(`[formic-rehearsal] Stapling validation passed: ${displayPath(appDir)}`);
}

async function assertSpctlAccepted(appDir) {
  const result = await runResult('spctl', ['--assess', '--type', 'execute', '--verbose=4', appDir]);
  const output = result.output.trim();
  console.log(`[formic-rehearsal] spctl stapled-app exit code: ${result.code ?? 'null'}`);
  if (output) {
    console.log(output);
  }

  if (result.code !== 0) {
    throw new Error('spctl did not accept the stapled app.');
  }
}

async function packagedAppFromAppDir(appDir) {
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

async function createDmgFromStapledApp(appDir) {
  if (process.platform !== 'darwin') {
    throw new Error('The DMG check currently expects macOS hdiutil tooling.');
  }

  const mountPoint = path.join(defaultDmgDir, 'mount');
  if (await pathExists(mountPoint)) {
    await runResult('hdiutil', ['detach', mountPoint, '-force']);
  }

  await rm(defaultDmgDir, { recursive: true, force: true });
  const stagingDir = path.join(defaultDmgDir, 'staging');
  const stagedAppDir = path.join(stagingDir, path.basename(appDir));
  const dmgPath = path.join(defaultDmgDir, `${path.basename(appDir, '.app')}-managed-notarized.dmg`);

  await mkdir(stagingDir, { recursive: true });
  await run('ditto', [appDir, stagedAppDir]);
  await run('hdiutil', [
    'create',
    '-volname',
    path.basename(appDir, '.app'),
    '-srcfolder',
    stagingDir,
    '-ov',
    '-format',
    'UDZO',
    dmgPath
  ]);

  const dmgStat = await stat(dmgPath);
  console.log(
    `[formic-rehearsal] DMG artifact ready: ${displayPath(dmgPath)} (${formatBytes(dmgStat.size)}, ${dmgStat.size} bytes)`
  );
  return { dmgPath, size: dmgStat.size, sizeLabel: formatBytes(dmgStat.size) };
}

async function mountDmg(dmgPath) {
  const mountPoint = path.join(defaultDmgDir, 'mount');
  await rm(mountPoint, { recursive: true, force: true });
  await mkdir(mountPoint, { recursive: true });

  const result = await runResult('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly', '-mountpoint', mountPoint]);
  if (result.code !== 0) {
    throw new Error(`hdiutil attach failed.\n${result.output.trim() || '(no output)'}`);
  }

  console.log(`[formic-rehearsal] DMG mounted: ${displayPath(mountPoint)}`);
  return mountPoint;
}

async function unmountDmg(mountPoint) {
  if (!(await pathExists(mountPoint))) {
    return;
  }

  const result = await runResult('hdiutil', ['detach', mountPoint]);
  if (result.code === 0) {
    console.log(`[formic-rehearsal] DMG unmounted: ${displayPath(mountPoint)}`);
    return;
  }

  const forced = await runResult('hdiutil', ['detach', mountPoint, '-force']);
  if (forced.code !== 0) {
    console.log(
      `[formic-rehearsal] DMG unmount failed: ${forced.output.trim() || result.output.trim() || '(no output)'}`
    );
  } else {
    console.log(`[formic-rehearsal] DMG unmounted with force: ${displayPath(mountPoint)}`);
  }
}

async function copyAppFromMountedDmg(mountedAppDir) {
  const extractedDir = path.join(defaultDmgDir, 'extracted');
  const copiedAppDir = path.join(extractedDir, path.basename(mountedAppDir));

  await rm(extractedDir, { recursive: true, force: true });
  await mkdir(extractedDir, { recursive: true });
  await run('ditto', [mountedAppDir, copiedAppDir]);

  console.log(`[formic-rehearsal] DMG app copied for launch smoke: ${displayPath(copiedAppDir)}`);
  return packagedAppFromAppDir(copiedAppDir);
}

async function verifyPostDmgApp(appDir, label) {
  await verifyCodesignedApp(appDir);
  console.log(`[formic-rehearsal] Post-DMG codesign verification passed (${label}): ${displayPath(appDir)}`);
  await assertSpctlAccepted(appDir);
  console.log(`[formic-rehearsal] Post-DMG spctl assessment passed (${label}): ${displayPath(appDir)}`);
}

async function prepareStapledNotarizedManagedApp(options) {
  if (process.platform !== 'darwin') {
    throw new Error('The notarization check currently expects macOS notarytool/stapler/spctl tooling.');
  }

  const credentials = assertNotarizationCredentials();
  await assertXcrunTool('notarytool');
  await assertXcrunTool('stapler');
  await assertNotarizationCredentialsUsable(credentials);

  const { packagedApp } = await signManagedDeveloperIdApp(options);
  const zipPath = await prepareNotarizationZip(packagedApp.appDir);
  const notarization = await submitForNotarization(zipPath, credentials);
  await stapleAndValidate(packagedApp.appDir);
  await assertSpctlAccepted(packagedApp.appDir);

  return { packagedApp, zipPath, notarization };
}

async function notarizationCheck(options) {
  const { packagedApp } = await prepareStapledNotarizedManagedApp(options);
  await smokePackagedApp(packagedApp, options, {
    managed: true,
    runtimeName: 'resources-managed-notarization-smoke'
  });
  await verifyCodesignedApp(packagedApp.appDir);
  console.log('[formic-rehearsal] Notarization/stapling check passed.');
}

async function dmgCheck(options) {
  if (process.platform !== 'darwin') {
    throw new Error('The DMG check currently expects macOS codesign/notarytool/stapler/spctl/hdiutil tooling.');
  }

  await assertCommandAvailable('hdiutil', 'Install or restore the macOS disk image utility before running the DMG rehearsal.');

  const { packagedApp } = await prepareStapledNotarizedManagedApp(options);
  await smokePackagedApp(packagedApp, options, {
    managed: true,
    runtimeName: 'resources-managed-dmg-source-smoke'
  });
  await verifyCodesignedApp(packagedApp.appDir);

  const dmg = await createDmgFromStapledApp(packagedApp.appDir);
  const mountPoint = await mountDmg(dmg.dmgPath);
  const mountedAppDir = path.join(mountPoint, path.basename(packagedApp.appDir));
  let copiedApp = null;

  try {
    if (!(await pathExists(mountedAppDir))) {
      throw new Error(`Mounted DMG did not contain ${path.basename(packagedApp.appDir)} at ${mountedAppDir}.`);
    }

    await verifyPostDmgApp(mountedAppDir, 'mounted app');
    await smokePackagedApp(
      {
        ...packagedApp,
        appDir: mountedAppDir,
        executable: path.join(mountedAppDir, 'Contents', 'MacOS', path.basename(packagedApp.executable)),
        serverDir: path.join(mountedAppDir, 'Contents', 'Resources', 'formic-server')
      },
      options,
      {
        managed: true,
        runtimeName: 'resources-managed-dmg-mounted-smoke',
        useDefaultDesktopBackendDirs: true
      }
    );
    copiedApp = await copyAppFromMountedDmg(mountedAppDir);
  } finally {
    await unmountDmg(mountPoint);
  }

  await validateBundle(copiedApp.serverDir);
  await verifyPostDmgApp(copiedApp.appDir, 'copied app');
  await smokePackagedApp(copiedApp, options, {
    managed: true,
    runtimeName: 'resources-managed-dmg-smoke'
  });
  await verifyCodesignedApp(copiedApp.appDir);

  console.log(
    `[formic-rehearsal] DMG distribution check passed: ${displayPath(dmg.dmgPath)} (${dmg.sizeLabel}, ${dmg.size} bytes)`
  );
}

async function smokeBundle(
  options,
  bundleOverride = null,
  runtimeName = `smoke-${options.port}`,
  expectedLaunchMarker = 'FORMIC_SERVER_BUNDLE_DIR venv'
) {
  const bundleDir = bundleOverride ?? (await buildBundle(options));
  await run('npm', ['run', 'build', '--workspace', '@formic/desktop']);
  await ensurePortAvailable(options.port);

  const serverUrl = `http://127.0.0.1:${options.port}`;
  const customRuntimeRoot = Boolean(process.env.FORMIC_REHEARSAL_RUNTIME_DIR);
  const runtimeRoot = customRuntimeRoot
    ? path.resolve(repoRoot, process.env.FORMIC_REHEARSAL_RUNTIME_DIR)
    : path.join(defaultRuntimeDir, runtimeName);
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

  let smokeError = null;

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

    if (!output.includes(expectedLaunchMarker)) {
      throw new Error(`Electron did not report the expected launch plan: ${expectedLaunchMarker}`);
    }

    console.log(`[formic-rehearsal] Smoke passed: /health, /ready, /api/version=${version.version}`);
  } catch (error) {
    smokeError = error;
  } finally {
    await stopProcessGroup(electron);
  }

  assertNoStartupFailureOutput(output);
  if (smokeError) {
    throw smokeError;
  }
}

async function smokeManagedRuntimeBundle(options) {
  const bundleDir = await buildManagedRuntimeBundle(options);
  await auditBundle({ ...options, bundleDir });
  await smokeBundle(
    { ...options, bundleDir, clean: false, skipSync: true },
    bundleDir,
    `managed-smoke-${options.port}`,
    'FORMIC_SERVER_BUNDLE_DIR managed Python runtime'
  );
  console.log('[formic-rehearsal] Managed runtime smoke passed with in-bundle Python.');
}

async function smokeRelocatedBundle(options) {
  const sourceBundleDir = await buildBundle(options);
  const relocationRoot = path.resolve(options.relocationDir);
  const relocatedBundleDir = path.join(relocationRoot, 'formic-server');

  await rm(relocationRoot, { recursive: true, force: true });
  await mkdir(relocationRoot, { recursive: true });
  await cp(sourceBundleDir, relocatedBundleDir, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true
  });

  await validateBundle(relocatedBundleDir);
  console.log(`[formic-rehearsal] Relocated bundle copy: ${displayPath(relocatedBundleDir)}`);
  await auditBundle({ ...options, bundleDir: relocatedBundleDir });
  await smokeBundle({ ...options, bundleDir: relocatedBundleDir, clean: false, skipSync: true }, relocatedBundleDir, `relocation-smoke-${options.port}`);
  console.log('[formic-rehearsal] Relocation smoke passed from a path containing spaces.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === 'print-path') {
    console.log(path.resolve(options.bundleDir));
    return;
  }

  await withRehearsalLock(options.command, () => runCommand(options));
}

async function runCommand(options) {
  if (options.command === 'build') {
    await buildBundle(options);
    return;
  }

  if (options.command === 'managed-build') {
    await buildManagedRuntimeBundle(options);
    return;
  }

  if (options.command === 'audit') {
    await auditBundle(options);
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

  if (options.command === 'resources-managed-package') {
    await packageResourcesApp(options, { managed: true });
    return;
  }

  if (options.command === 'resources-managed-smoke') {
    await smokePackagedResources(options, { managed: true });
    return;
  }

  if (options.command === 'resources-managed-adhoc-sign-check') {
    await localOnlyAdHocSignCheck(options);
    return;
  }

  if (options.command === 'resources-managed-signing-preflight') {
    await managedSigningPreflight(options);
    return;
  }

  if (options.command === 'resources-managed-developer-id-sign-check') {
    await developerIdSignCheck(options);
    return;
  }

  if (options.command === 'resources-managed-notarization-check') {
    await notarizationCheck(options);
    return;
  }

  if (options.command === 'resources-managed-dmg-check') {
    await dmgCheck(options);
    return;
  }

  if (options.command === 'relocation-smoke') {
    await smokeRelocatedBundle(options);
    return;
  }

  if (options.command === 'managed-smoke') {
    await smokeManagedRuntimeBundle(options);
    return;
  }

  await smokeBundle(options);
}

main().catch((error) => {
  console.error(`[formic-rehearsal] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
