import { app, BrowserWindow, dialog, ipcMain, safeStorage, type OpenDialogOptions } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ServerMode = 'auto' | 'spawn' | 'external';
type ActiveServerMode = 'auto' | 'spawn' | 'existing' | 'spawned' | 'external';
type ServerStatus = 'checking' | 'starting' | 'healthy' | 'ready' | 'failed';
type TerminalMode = 'auto' | 'disabled' | 'external';
type TerminalStatus = 'disabled' | 'checking' | 'starting' | 'ready' | 'failed';
type RendererStatus =
	| 'waiting'
	| 'checking'
	| 'ready'
	| 'loading'
	| 'loaded'
	| 'skipped'
	| 'failed';

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

type TerminalLaunchPlan = {
	command: string;
	args: string[];
	cwd: string;
	url: string;
	source: string;
	error?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const packagedServerRoot = path.join(process.resourcesPath, 'formic-server');
const shouldUseBundledServerRoot =
	Boolean(process.env.FORMIC_SERVER_BUNDLE_DIR) ||
	(app.isPackaged && existsSync(packagedServerRoot));
const serverRoot =
	process.env.FORMIC_SERVER_BUNDLE_DIR ??
	(shouldUseBundledServerRoot ? packagedServerRoot : repoRoot);

const serverPort = Number(process.env.FORMIC_SERVER_PORT ?? '8080');
const serverUrl = process.env.FORMIC_SERVER_URL ?? `http://127.0.0.1:${serverPort}`;
const rendererUrl =
	process.env.FORMIC_RENDERER_URL ?? (app.isPackaged ? serverUrl : 'http://127.0.0.1:5173');
const healthUrl = new URL('/health', serverUrl).toString();
const readinessUrl = new URL('/ready', serverUrl).toString();
const serverReadyTimeoutMs = parseTimeout(process.env.FORMIC_SERVER_READY_TIMEOUT_MS, 120000);
const rendererReadyTimeoutMs = parseTimeout(process.env.FORMIC_RENDERER_READY_TIMEOUT_MS, 120000);
const terminalReadyTimeoutMs = parseTimeout(process.env.FORMIC_TERMINAL_READY_TIMEOUT_MS, 60000);
const serverLogLineLimit = parseTimeout(process.env.FORMIC_SERVER_LOG_LINES, 24);
const terminalLogLineLimit = parseTimeout(process.env.FORMIC_TERMINAL_LOG_LINES, 24);
const configuredServerMode = parseServerMode(process.env.FORMIC_SERVER_MODE);
const configuredTerminalMode = parseTerminalMode(process.env.FORMIC_TERMINAL_MODE);
const desktopSessionTokenFileName = 'desktop-session-token.json';
const desktopTerminalKeyFileName = 'desktop-terminal-key.json';
const localTerminalId = 'formic-local-terminal';
const localTerminalName = 'Formic Local Terminal';
const terminalPort = Number(process.env.FORMIC_TERMINAL_PORT ?? '18082');
const terminalUrl =
	process.env.FORMIC_TERMINAL_URL ?? `http://127.0.0.1:${terminalPort}`;
const terminalConfigUrl = new URL('/api/config', terminalUrl).toString();

let serverProcess: ChildProcessWithoutNullStreams | null = null;
let terminalProcess: ChildProcessWithoutNullStreams | null = null;
let serverStatus: ServerStatus = 'checking';
let terminalStatus: TerminalStatus =
	configuredTerminalMode === 'disabled' ? 'disabled' : 'checking';
let rendererStatus: RendererStatus = 'waiting';
let activeServerMode: ActiveServerMode = configuredServerMode;
let lastServerError: string | null = null;
let lastServerProbe: string | null = null;
let lastTerminalError: string | null = null;
let lastTerminalProbe: string | null = null;
let lastTerminalRegistration: string | null = null;
let lastRendererError: string | null = null;
let lastRendererProbe: string | null = null;
let activeServerLaunchPlan: ServerLaunchPlan | null = null;
let activeTerminalLaunchPlan: TerminalLaunchPlan | null = null;
const recentServerOutput: string[] = [];
const recentTerminalOutput: string[] = [];
let isQuitting = false;

function parseServerMode(mode: string | undefined): ServerMode {
	if (mode === 'spawn' || mode === 'external') {
		return mode;
	}

	return app.isPackaged ? 'auto' : 'spawn';
}

function parseTerminalMode(mode: string | undefined): TerminalMode {
	if (mode === 'disabled' || mode === 'external') {
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

function desktopSessionTokenPath(): string {
	return path.join(desktopUserDataDir(), desktopSessionTokenFileName);
}

function desktopTerminalKeyPath(): string {
	return path.join(desktopUserDataDir(), desktopTerminalKeyFileName);
}

function getDesktopSessionToken(): string | null {
	const tokenPath = desktopSessionTokenPath();
	if (!existsSync(tokenPath)) {
		return null;
	}

	try {
		const payload = JSON.parse(readFileSync(tokenPath, 'utf8')) as {
			encoding?: string;
			value?: string;
		};

		if (!payload.value) {
			return null;
		}

		if (payload.encoding === 'safeStorage') {
			if (!safeStorage.isEncryptionAvailable()) {
				console.warn(
					'[formic-desktop] Stored session token is encrypted, but safeStorage is unavailable.'
				);
				return null;
			}

			return safeStorage.decryptString(Buffer.from(payload.value, 'base64'));
		}

		if (payload.encoding === 'plain') {
			return payload.value;
		}
	} catch (error) {
		console.warn(
			`[formic-desktop] Could not read stored desktop session token: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
	}

	return null;
}

function getDesktopTerminalKey(): string {
	if (process.env.FORMIC_TERMINAL_KEY?.trim()) {
		return process.env.FORMIC_TERMINAL_KEY.trim();
	}

	const tokenPath = desktopTerminalKeyPath();
	if (existsSync(tokenPath)) {
		try {
			const payload = JSON.parse(readFileSync(tokenPath, 'utf8')) as {
				encoding?: string;
				value?: string;
			};

			if (payload.value) {
				if (payload.encoding === 'safeStorage') {
					if (safeStorage.isEncryptionAvailable()) {
						return safeStorage.decryptString(Buffer.from(payload.value, 'base64'));
					}

					console.warn(
						'[formic-desktop] Stored terminal key is encrypted, but safeStorage is unavailable.'
					);
				} else if (payload.encoding === 'plain') {
					return payload.value;
				}
			}
		} catch (error) {
			console.warn(
				`[formic-desktop] Could not read stored desktop terminal key: ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}

	const key = randomBytes(32).toString('hex');
	mkdirSync(path.dirname(tokenPath), { recursive: true });
	const payload = safeStorage.isEncryptionAvailable()
		? {
				encoding: 'safeStorage',
				value: safeStorage.encryptString(key).toString('base64')
			}
		: {
				encoding: 'plain',
				value: key
			};
	writeFileSync(tokenPath, JSON.stringify(payload), { mode: 0o600 });
	return key;
}

function setDesktopSessionToken(token: unknown): boolean {
	if (typeof token !== 'string' || !token.trim()) {
		clearDesktopSessionToken();
		return false;
	}

	const tokenPath = desktopSessionTokenPath();
	mkdirSync(path.dirname(tokenPath), { recursive: true });

	const payload = safeStorage.isEncryptionAvailable()
		? {
				encoding: 'safeStorage',
				value: safeStorage.encryptString(token).toString('base64')
			}
		: {
				encoding: 'plain',
				value: token
			};

	writeFileSync(tokenPath, JSON.stringify(payload), { mode: 0o600 });
	return true;
}

function clearDesktopSessionToken(): boolean {
	try {
		rmSync(desktopSessionTokenPath(), { force: true });
		return true;
	} catch (error) {
		console.warn(
			`[formic-desktop] Could not clear desktop session token: ${
				error instanceof Error ? error.message : String(error)
			}`
		);
		return false;
	}
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

function bundledOpenTerminalCandidates(root: string): string[] {
	return process.platform === 'win32'
		? [
				path.join(root, '.venv', 'Scripts', 'open-terminal.exe'),
				path.join(root, 'venv', 'Scripts', 'open-terminal.exe'),
				path.join(root, 'python-runtime', 'Scripts', 'open-terminal.exe')
			]
		: [
				path.join(root, '.venv', 'bin', 'open-terminal'),
				path.join(root, 'venv', 'bin', 'open-terminal'),
				path.join(root, 'python-runtime', 'bin', 'open-terminal')
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

function buildTerminalLaunchPlan(): TerminalLaunchPlan {
	if (configuredTerminalMode === 'disabled') {
		return {
			command: '',
			args: [],
			cwd: serverRoot,
			url: terminalUrl,
			source: 'FORMIC_TERMINAL_MODE=disabled',
			error: 'Terminal sidecar is disabled.'
		};
	}

	if (configuredTerminalMode === 'external') {
		return {
			command: '',
			args: [],
			cwd: serverRoot,
			url: terminalUrl,
			source: 'FORMIC_TERMINAL_MODE=external'
		};
	}

	const key = getDesktopTerminalKey();
	const launchArgs = ['run', '--host', '127.0.0.1', '--port', String(terminalPort), '--api-key', key];
	const bundledPython = shouldUseBundledServerRoot ? findBundledPython(serverRoot) : null;

	if (bundledPython) {
		const openTerminalScript = bundledOpenTerminalCandidates(serverRoot).find((candidate) =>
			existsSync(candidate)
		);

		if (!openTerminalScript) {
			return {
				command: '',
				args: [],
				cwd: serverRoot,
				url: terminalUrl,
				source: 'missing bundled OpenTerminal',
				error: [
					`Bundled server root was selected at ${serverRoot}, but no OpenTerminal console script was found.`,
					`Expected one of:\n${bundledOpenTerminalCandidates(serverRoot)
						.map((candidate) => `- ${candidate}`)
						.join('\n')}`
				].join('\n')
			};
		}

		return {
			command: bundledPython,
			args: [openTerminalScript, ...launchArgs],
			cwd: serverRoot,
			url: terminalUrl,
			source: 'bundled managed OpenTerminal sidecar'
		};
	}

	return {
		command: 'uv',
		args: ['run', '--frozen', '--project', serverRoot, 'open-terminal', ...launchArgs],
		cwd: serverRoot,
		url: terminalUrl,
		source: 'uv lockfile OpenTerminal sidecar'
	};
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
				`Expected one of:\n${bundledPythonCandidates(serverRoot)
					.map((candidate) => `- ${candidate}`)
					.join('\n')}`,
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

function formatTerminalLaunchPlan(plan: TerminalLaunchPlan | null): string {
	if (!plan) {
		return 'not selected';
	}

	if (!plan.command) {
		return [`source=${plan.source}`, `url=${plan.url}`].join('\n');
	}

	return [
		`${plan.command} ${plan.args.join(' ')}`,
		`source=${plan.source}`,
		`cwd=${plan.cwd}`,
		`url=${plan.url}`
	].join('\n');
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

function recordTerminalOutput(stream: 'stdout' | 'stderr', chunk: Buffer): void {
	const lines = chunk
		.toString()
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter(Boolean);

	for (const line of lines) {
		recentTerminalOutput.push(`[${stream}] ${line.slice(0, 1000)}`);
	}

	while (recentTerminalOutput.length > terminalLogLineLimit) {
		recentTerminalOutput.shift();
	}
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

		if (
			options.requiredText?.length &&
			!options.requiredText.some((marker) => body.includes(marker))
		) {
			return {
				ok: false,
				statusCode: response.status,
				detail: `${options.label} responded ${response.status}, but did not look like the Formic renderer`
			};
		}

		return {
			ok: true,
			statusCode: response.status,
			detail: `${options.label} responded ${response.status}`
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, detail: `${options.label} probe failed: ${message}` };
	}
}

async function probeTerminalConfig(timeoutMs = 1200): Promise<ProbeResult> {
	if (configuredTerminalMode === 'disabled') {
		return { ok: false, detail: 'Terminal sidecar is disabled.' };
	}

	try {
		const response = await fetch(terminalConfigUrl, {
			headers: {
				Authorization: `Bearer ${getDesktopTerminalKey()}`
			},
			signal: AbortSignal.timeout(timeoutMs)
		});
		const body = await response.text();
		const bodyPreview = body.trim().slice(0, 240);

		if (!response.ok) {
			return {
				ok: false,
				statusCode: response.status,
				detail: `Terminal config responded ${response.status}${bodyPreview ? `: ${bodyPreview}` : ''}`
			};
		}

		return {
			ok: true,
			statusCode: response.status,
			detail: `Terminal config responded ${response.status}`
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, detail: `Terminal config probe failed: ${message}` };
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

async function waitForTerminal(timeoutMs = terminalReadyTimeoutMs): Promise<void> {
	if (configuredTerminalMode === 'disabled') {
		terminalStatus = 'disabled';
		return;
	}

	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		if (lastTerminalError && !terminalProcess && configuredTerminalMode === 'auto') {
			terminalStatus = 'failed';
			throw new Error(lastTerminalError);
		}

		const probe = await probeTerminalConfig();
		lastTerminalProbe = probe.detail;

		if (probe.ok) {
			terminalStatus = 'ready';
			console.log(`[formic-desktop] Terminal sidecar ready at ${terminalUrl}`);
			return;
		}

		await sleep(500);
	}

	terminalStatus = 'failed';
	throw new Error(
		[
			`Timed out waiting for Formic terminal sidecar at ${terminalUrl}`,
			lastTerminalProbe ? `Last probe: ${lastTerminalProbe}` : null,
			lastTerminalError ? `Last terminal error: ${lastTerminalError}` : null
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

	serverProcess = spawn(
		launchPlan.command,
		[
			...launchPlan.args,
			'open_webui.main:app',
			'--host',
			'127.0.0.1',
			'--port',
			String(serverPort),
			'--forwarded-allow-ips',
			'*'
		],
		{
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
		}
	);

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

function spawnTerminal(): void {
	if (configuredTerminalMode === 'disabled' || configuredTerminalMode === 'external') {
		return;
	}

	if (terminalProcess) {
		return;
	}

	const launchPlan = buildTerminalLaunchPlan();
	activeTerminalLaunchPlan = launchPlan;
	recentTerminalOutput.length = 0;

	if (launchPlan.error) {
		terminalStatus = 'failed';
		lastTerminalError = launchPlan.error;
		return;
	}

	console.log(
		`[formic-desktop] Terminal launch plan: ${launchPlan.command} ${launchPlan.args.join(' ')} (${launchPlan.source})`
	);

	terminalProcess = spawn(launchPlan.command, launchPlan.args, {
		cwd: launchPlan.cwd,
		env: {
			...process.env,
			FORMIC_DESKTOP: 'true',
			PYTHONDONTWRITEBYTECODE: process.env.PYTHONDONTWRITEBYTECODE ?? '1'
		}
	});

	terminalProcess.stdout.on('data', (chunk) => {
		recordTerminalOutput('stdout', chunk);
		console.log(`[formic-terminal] ${chunk.toString().trimEnd()}`);
	});

	terminalProcess.stderr.on('data', (chunk) => {
		recordTerminalOutput('stderr', chunk);
		console.error(`[formic-terminal] ${chunk.toString().trimEnd()}`);
	});

	terminalProcess.once('error', (error) => {
		terminalStatus = 'failed';
		lastTerminalError = `Failed to start terminal process: ${error.message}`;
		terminalProcess = null;
	});

	terminalProcess.once('exit', (code, signal) => {
		if (!isQuitting) {
			terminalStatus = 'failed';
			lastTerminalError = `Terminal exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`;
		}

		terminalProcess = null;
	});
}

async function ensureServer(): Promise<void> {
	serverStatus = 'checking';
	lastServerError = null;
	lastServerProbe = null;

	if (configuredServerMode === 'spawn') {
		activeServerMode = 'spawned';
		serverStatus = 'starting';
		console.log(`[formic-desktop] Starting owned FastAPI backend at ${serverUrl}`);
		spawnServer();
		await waitForServer();
		return;
	}

	const healthProbe = await probeUrl(healthUrl, {
		label: 'Backend health',
		requireJsonStatus: true
	});
	lastServerProbe = healthProbe.detail;

	if (healthProbe.ok) {
		if (
			!app.isPackaged &&
			configuredServerMode === 'auto' &&
			process.env.FORMIC_ALLOW_DEV_EXISTING_BACKEND !== '1'
		) {
			serverStatus = 'failed';
			lastServerError = [
				`A backend is already healthy at ${serverUrl}, but dev desktop will not attach to an arbitrary existing backend.`,
				'Quit any mounted/stapled Formic DMG app that still owns this port, choose another FORMIC_SERVER_PORT,',
				'or set FORMIC_SERVER_MODE=external if you intentionally want to use that backend.',
				'Set FORMIC_ALLOW_DEV_EXISTING_BACKEND=1 only for temporary debugging.'
			].join('\n');
			throw new Error(lastServerError);
		}

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

async function ensureTerminal(): Promise<void> {
	lastTerminalError = null;
	lastTerminalProbe = null;
	lastTerminalRegistration = null;

	if (configuredTerminalMode === 'disabled') {
		terminalStatus = 'disabled';
		activeTerminalLaunchPlan = buildTerminalLaunchPlan();
		return;
	}

	terminalStatus = 'checking';
	activeTerminalLaunchPlan = buildTerminalLaunchPlan();

	const probe = await probeTerminalConfig();
	lastTerminalProbe = probe.detail;
	if (probe.ok) {
		terminalStatus = 'ready';
		return;
	}

	if (configuredTerminalMode === 'external') {
		terminalStatus = 'failed';
		lastTerminalError = probe.detail;
		return;
	}

	terminalStatus = 'starting';
	spawnTerminal();
	await waitForTerminal();
}

async function fetchDesktopJson(url: string, token: string, init: RequestInit = {}): Promise<unknown> {
	const response = await fetch(url, {
		...init,
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${token}`,
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			...(init.headers ?? {})
		}
	});
	const text = await response.text();

	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}${text ? `: ${text.slice(0, 240)}` : ''}`);
	}

	return text ? JSON.parse(text) : null;
}

async function registerManagedTerminal(token: string | null): Promise<void> {
	if (!token || configuredTerminalMode === 'disabled') {
		return;
	}

	if (terminalStatus !== 'ready') {
		lastTerminalRegistration = `skipped: terminal sidecar is ${terminalStatus}`;
		return;
	}

	const authUrl = new URL('/api/v1/auths/', serverUrl).toString();
	const configUrl = new URL('/api/v1/configs/terminal_servers', serverUrl).toString();

	try {
		const user = (await fetchDesktopJson(authUrl, token)) as {
			id?: string;
			role?: string;
		};

		if (!user?.id || user.role !== 'admin') {
			lastTerminalRegistration = 'skipped: signed-in user is not an admin';
			return;
		}

		const existingConfig = (await fetchDesktopJson(configUrl, token)) as {
			TERMINAL_SERVER_CONNECTIONS?: Array<Record<string, unknown>>;
		};
		const connections = existingConfig.TERMINAL_SERVER_CONNECTIONS ?? [];
		const localConnection = {
			id: localTerminalId,
			name: localTerminalName,
			url: terminalUrl,
			path: '/openapi.json',
			auth_type: 'bearer',
			key: getDesktopTerminalKey(),
			enabled: true,
			config: {
				access_grants: [
					{
						permission: 'read',
						principal_type: 'user',
						principal_id: user.id
					}
				]
			}
		};
		const mergedConnections = [
			...connections.filter((connection) => connection.id !== localTerminalId),
			localConnection
		];

		await fetchDesktopJson(configUrl, token, {
			method: 'POST',
			body: JSON.stringify({ TERMINAL_SERVER_CONNECTIONS: mergedConnections })
		});

		lastTerminalRegistration = `registered ${localTerminalName} for ${user.id}`;
		console.log(`[formic-desktop] ${lastTerminalRegistration}`);
	} catch (error) {
		lastTerminalRegistration = `failed: ${error instanceof Error ? error.message : String(error)}`;
		console.warn(`[formic-desktop] Terminal registration ${lastTerminalRegistration}`);
	}
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
		'<dt>Terminal</dt><dd id="terminal">checking</dd>',
		'<dt>Renderer</dt><dd id="renderer">waiting</dd>',
		'<dt>Mode</dt><dd id="mode">auto</dd>',
		'<dt>Backend URL</dt><dd id="server"></dd>',
		'<dt>Terminal URL</dt><dd id="terminal-url"></dd>',
		'<dt>Renderer URL</dt><dd id="renderer-url"></dd>',
		'<dt>Last probe</dt><dd id="probe"></dd>',
		'</dl>',
		'</main>',
		'<script>',
		'function messageFor(state) {',
		'  if (state.serverStatus === "starting") return "Starting the bundled FastAPI sidecar...";',
		'  if (state.serverStatus === "healthy") return "Backend is healthy; waiting for readiness...";',
		'  if (state.terminalStatus === "starting") return "Starting the local terminal sidecar...";',
		'  if (state.rendererStatus === "skipped") return "API-only smoke is running without loading a renderer.";',
		'  if (state.serverStatus === "ready" && state.rendererStatus !== "ready") return "Backend is ready; waiting for the Svelte renderer...";',
		'  if (state.rendererStatus === "loading") return "Loading the Formic app...";',
		'  return "Checking the local Formic backend...";',
		'}',
		'async function refresh() {',
		'  if (!window.formicDesktop) return;',
		'  const state = await window.formicDesktop.getServerStatus();',
		'  document.getElementById("backend").textContent = state.serverStatus;',
		'  document.getElementById("terminal").textContent = state.terminalStatus;',
		'  document.getElementById("renderer").textContent = state.rendererStatus;',
		'  document.getElementById("mode").textContent = state.mode + " / " + state.terminalMode;',
		'  document.getElementById("server").textContent = state.serverUrl;',
		'  document.getElementById("terminal-url").textContent = state.terminalUrl;',
		'  document.getElementById("renderer-url").textContent = state.rendererUrl;',
		'  document.getElementById("probe").textContent = state.lastServerProbe || state.lastTerminalProbe || state.lastRendererProbe || "";',
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
	return failureHtml(
		'Formic Backend Failed',
		'Electron opened, but the FastAPI backend did not become ready.',
		[
			message,
			`Mode: ${activeServerMode}`,
			`Launch plan:\n${formatServerLaunchPlan(activeServerLaunchPlan)}`,
			`Health URL: ${healthUrl}`,
			`Readiness URL: ${readinessUrl}`,
			lastServerProbe ? `Last probe: ${lastServerProbe}` : '',
			lastServerError ? `Last process error: ${lastServerError}` : '',
			recentServerOutput.length ? `Recent server output:\n${recentServerOutput.join('\n')}` : ''
		]
	);
}

function rendererFailureHtml(message: string): string {
	return failureHtml(
		'Formic Renderer Failed',
		'The FastAPI backend is ready, but the Svelte renderer did not become available.',
		[
			message,
			`Renderer URL: ${rendererUrl}`,
			lastRendererProbe ? `Last probe: ${lastRendererProbe}` : ''
		]
	);
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
		await ensureTerminal();
		await registerManagedTerminal(getDesktopSessionToken());
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		lastTerminalError = message;
		terminalStatus = 'failed';
		console.warn(`[formic-desktop] Terminal sidecar startup failed: ${message}`);
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
	terminalStatus,
	rendererStatus,
	mode: activeServerMode,
	configuredMode: configuredServerMode,
	terminalMode: configuredTerminalMode,
	serverUrl,
	terminalUrl,
	healthUrl,
	readinessUrl,
	rendererUrl,
	lastServerError,
	lastServerProbe,
	lastTerminalError,
	lastTerminalProbe,
	lastTerminalRegistration,
	lastRendererError,
	lastRendererProbe,
	serverRoot,
	serverLaunchPlan: activeServerLaunchPlan,
	terminalLaunchPlan: activeTerminalLaunchPlan,
	recentServerOutput,
	recentTerminalOutput
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

ipcMain.handle('formic:get-session-token', () => getDesktopSessionToken());

ipcMain.handle('formic:set-session-token', async (_event, token: unknown) => {
	const saved = setDesktopSessionToken(token);
	if (saved && typeof token === 'string') {
		await registerManagedTerminal(token);
	}
	return saved;
});

ipcMain.handle('formic:clear-session-token', () => clearDesktopSessionToken());

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

	const children = [terminalProcess, serverProcess].filter(
		(child): child is ChildProcessWithoutNullStreams => Boolean(child)
	);

	for (const child of children) {
		child.kill('SIGTERM');
	}

	await Promise.race([Promise.all(children.map((child) => once(child, 'exit'))), sleep(3000)]);

	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGKILL');
		}
	}
});
