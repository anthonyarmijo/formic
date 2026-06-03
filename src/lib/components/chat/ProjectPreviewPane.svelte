<script lang="ts">
	import { createEventDispatcher, getContext, onDestroy, tick } from 'svelte';
	import { browser } from '$app/environment';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ArrowLeft from '$lib/components/icons/ArrowLeft.svelte';
	import ArrowRight from '$lib/components/icons/ArrowRight.svelte';
	import ArrowPath from '$lib/components/icons/ArrowPath.svelte';
	import Camera from '$lib/components/icons/Camera.svelte';
	import CodeBracket from '$lib/components/icons/CodeBracket.svelte';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import Link from '$lib/components/icons/Link.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');
	const dispatch = createEventDispatcher<{
		urlchange: { url: string };
		captured: { context: PreviewContext };
		error: { message: string };
		autoattachchange: { enabled: boolean };
	}>();

	type PreviewContext = {
		captured_at: string;
		url: string;
		title: string;
		screenshot: string | null;
		text: string;
		dom: string;
		viewport: { width: number; height: number; device_pixel_ratio: number };
		console: PreviewConsoleMessage[];
		network: PreviewNetworkEntry[];
	};

	type PreviewConsoleMessage = {
		level: string;
		message: string;
		source?: string;
		line?: number;
		timestamp: string;
	};

	type PreviewNetworkEntry = {
		name: string;
		initiator_type?: string;
		duration_ms?: number;
		transfer_size?: number;
	};

	export let folderId = '';
	export let initialUrl = '';
	export let autoAttach = false;

	let webviewEl: any;
	let address = initialUrl || '';
	let loadedUrl = '';
	let title = '';
	let loading = false;
	let canGoBack = false;
	let canGoForward = false;
	let captureStatus = '';
	let captureState: 'idle' | 'success' | 'error' = 'idle';
	let webviewReady = false;
	let attachedFolderId = '';
	let attachedWebview: any = null;
	let consoleMessages: PreviewConsoleMessage[] = [];

	$: if (folderId !== attachedFolderId) {
		attachedFolderId = folderId;
		address = initialUrl || '';
		loadedUrl = initialUrl || '';
		title = '';
		consoleMessages = [];
		captureStatus = '';
		captureState = 'idle';
		webviewReady = false;
	}

	$: if (initialUrl && !address && !loadedUrl) {
		address = initialUrl;
		loadedUrl = initialUrl;
	}

	$: submittedAddress = normalizePreviewUrl(address);
	$: hasPreviewUrl = Boolean(loadedUrl);
	$: isDesktopPreviewAvailable = browser && Boolean(window.formicDesktop);

	function normalizePreviewUrl(value: string): string {
		const trimmed = value.trim();
		if (!trimmed) return '';
		if (/^https?:\/\//i.test(trimmed)) return trimmed;
		if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(\/.*)?$/i.test(trimmed)) {
			return `http://${trimmed}`;
		}
		if (/^:\d+/.test(trimmed)) {
			return `http://127.0.0.1${trimmed}`;
		}
		return `http://${trimmed}`;
	}

	function updateNavState() {
		if (!webviewEl) return;

		try {
			canGoBack = Boolean(webviewEl.canGoBack?.());
			canGoForward = Boolean(webviewEl.canGoForward?.());
			loadedUrl = webviewEl.getURL?.() || loadedUrl;
			title = webviewEl.getTitle?.() || title;
			if (loadedUrl) {
				address = loadedUrl;
				dispatch('urlchange', { url: loadedUrl });
			}
		} catch (error) {
			console.warn('Unable to update preview navigation state:', error);
		}
	}

	function navigate() {
		const url = submittedAddress;
		if (!url) return;
		address = url;
		loadedUrl = url;
		dispatch('urlchange', { url });
		captureStatus = '';
		captureState = 'idle';
	}

	function goBack() {
		if (webviewEl?.canGoBack?.()) {
			webviewEl.goBack();
		}
	}

	function goForward() {
		if (webviewEl?.canGoForward?.()) {
			webviewEl.goForward();
		}
	}

	function reload() {
		if (webviewEl) {
			webviewEl.reload();
		} else {
			navigate();
		}
	}

	async function openExternal() {
		const url = loadedUrl || submittedAddress;
		if (!url) return;

		const opened = await window.formicDesktop?.openExternalUrl?.(url);
		if (!opened) {
			captureState = 'error';
			captureStatus = $i18n.t('Could not open URL');
		}
	}

	function toggleDevTools() {
		if (!webviewEl) return;

		try {
			if (webviewEl.isDevToolsOpened?.()) {
				webviewEl.closeDevTools();
			} else {
				webviewEl.openDevTools();
			}
		} catch (error) {
			captureState = 'error';
			captureStatus = $i18n.t('DevTools unavailable');
		}
	}

	function setAutoAttach(enabled: boolean) {
		autoAttach = enabled;
		dispatch('autoattachchange', { enabled });
	}

	function attachWebviewListeners(node: any) {
		if (!node || node === attachedWebview) return;
		attachedWebview = node;

		const onLoading = () => {
			loading = true;
			webviewReady = false;
		};
		const onLoaded = () => {
			loading = false;
			webviewReady = true;
			updateNavState();
		};
		const onNavigate = () => updateNavState();
		const onConsole = (event: any) => {
			const nextMessage = {
				level: String(event.level ?? 'info'),
				message: String(event.message ?? '').slice(0, 800),
				source: event.url ? String(event.url).slice(0, 300) : undefined,
				line: typeof event.line === 'number' ? event.line : undefined,
				timestamp: new Date().toISOString()
			};
			consoleMessages = [...consoleMessages.slice(-39), nextMessage];
		};
		const onFail = (event: any) => {
			loading = false;
			webviewReady = false;
			captureState = 'error';
			captureStatus = String(event.errorDescription || 'Preview failed to load');
			dispatch('error', { message: captureStatus });
		};

		node.addEventListener('did-start-loading', onLoading);
		node.addEventListener('did-stop-loading', onLoaded);
		node.addEventListener('did-finish-load', onLoaded);
		node.addEventListener('did-navigate', onNavigate);
		node.addEventListener('did-navigate-in-page', onNavigate);
		node.addEventListener('page-title-updated', onNavigate);
		node.addEventListener('console-message', onConsole);
		node.addEventListener('did-fail-load', onFail);

		node.__formicPreviewCleanup = () => {
			node.removeEventListener('did-start-loading', onLoading);
			node.removeEventListener('did-stop-loading', onLoaded);
			node.removeEventListener('did-finish-load', onLoaded);
			node.removeEventListener('did-navigate', onNavigate);
			node.removeEventListener('did-navigate-in-page', onNavigate);
			node.removeEventListener('page-title-updated', onNavigate);
			node.removeEventListener('console-message', onConsole);
			node.removeEventListener('did-fail-load', onFail);
		};
	}

	$: if (webviewEl) {
		attachWebviewListeners(webviewEl);
	}

	const captureScript = `
(() => {
	const MAX_TEXT = 12000;
	const MAX_DOM = 18000;
	const MAX_NODES = 160;
	const compact = (value, max = MAX_TEXT) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max);
	const isVisible = (el) => {
		const style = window.getComputedStyle(el);
		const rect = el.getBoundingClientRect();
		return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0;
	};
	let nodeCount = 0;
	const summarize = (el, depth = 0) => {
		if (!el || nodeCount >= MAX_NODES || depth > 4 || !isVisible(el)) return '';
		nodeCount += 1;
		const attrs = [];
		if (el.id) attrs.push('#' + el.id);
		if (el.classList?.length) attrs.push('.' + Array.from(el.classList).slice(0, 3).join('.'));
		for (const name of ['role', 'aria-label', 'name', 'type', 'href']) {
			const value = el.getAttribute?.(name);
			if (value) attrs.push(name + '=' + JSON.stringify(String(value).slice(0, 80)));
		}
		const ownText = compact(Array.from(el.childNodes || []).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(' '), 180);
		const line = '<' + el.tagName.toLowerCase() + (attrs.length ? ' ' + attrs.join(' ') : '') + '>' + (ownText ? ' ' + ownText : '');
		const children = Array.from(el.children || []).slice(0, 8).map((child) => summarize(child, depth + 1)).filter(Boolean);
		return [line, ...children].join('\\n').slice(0, MAX_DOM);
	};
	const resources = performance.getEntriesByType('resource').slice(-30).map((entry) => ({
		name: String(entry.name || '').slice(0, 300),
		initiator_type: entry.initiatorType || undefined,
		duration_ms: Math.round(entry.duration || 0),
		transfer_size: entry.transferSize || 0
	}));
	return {
		url: location.href,
		title: document.title || '',
		text: compact(document.body?.innerText || ''),
		dom: summarize(document.body || document.documentElement),
		viewport: {
			width: window.innerWidth,
			height: window.innerHeight,
			device_pixel_ratio: window.devicePixelRatio || 1
		},
		network: resources
	};
})()
	`;

	export async function captureContext({ silent = false } = {}): Promise<PreviewContext | null> {
		if (!webviewEl || !hasPreviewUrl) {
			captureState = 'error';
			captureStatus = $i18n.t('Load a preview URL first');
			return null;
		}

		captureState = 'idle';
		captureStatus = $i18n.t('Capturing...');

		try {
			await tick();
			const pageContext = await webviewEl.executeJavaScript(captureScript, true);
			const image = await webviewEl.capturePage();
			const screenshot =
				typeof image?.toDataURL === 'function' ? image.toDataURL() : null;
			const context: PreviewContext = {
				captured_at: new Date().toISOString(),
				url: String(pageContext?.url || webviewEl.getURL?.() || loadedUrl || ''),
				title: String(pageContext?.title || webviewEl.getTitle?.() || title || ''),
				screenshot,
				text: String(pageContext?.text || ''),
				dom: String(pageContext?.dom || ''),
				viewport: pageContext?.viewport ?? { width: 0, height: 0, device_pixel_ratio: 1 },
				console: consoleMessages.slice(-40),
				network: Array.isArray(pageContext?.network) ? pageContext.network : []
			};

			captureState = 'success';
			captureStatus = $i18n.t('Preview context attached');
			if (!silent) {
				dispatch('captured', { context });
			}
			return context;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			captureState = 'error';
			captureStatus = message;
			if (!silent) {
				dispatch('error', { message });
			}
			return null;
		}
	}

	onDestroy(() => {
		if (attachedWebview?.__formicPreviewCleanup) {
			attachedWebview.__formicPreviewCleanup();
		}
	});
</script>

<div class="h-full min-h-0 flex flex-col border-l border-gray-100 bg-white dark:border-gray-850 dark:bg-gray-950">
	<div class="shrink-0 border-b border-gray-100 px-2 py-2 dark:border-gray-850">
		<div class="flex items-center gap-1.5">
			<Tooltip content={$i18n.t('Back')} placement="bottom">
				<button
					type="button"
					class="preview-icon-button"
					disabled={!canGoBack}
					on:click={goBack}
				>
					<ArrowLeft className="size-4" strokeWidth="2" />
				</button>
			</Tooltip>

			<Tooltip content={$i18n.t('Forward')} placement="bottom">
				<button
					type="button"
					class="preview-icon-button"
					disabled={!canGoForward}
					on:click={goForward}
				>
					<ArrowRight className="size-4" strokeWidth="2" />
				</button>
			</Tooltip>

			<Tooltip content={$i18n.t('Reload')} placement="bottom">
				<button type="button" class="preview-icon-button" disabled={!hasPreviewUrl} on:click={reload}>
					<ArrowPath className="size-4 {loading ? 'animate-spin' : ''}" strokeWidth="2" />
				</button>
			</Tooltip>

			<form class="min-w-0 flex-1" on:submit|preventDefault={navigate}>
				<input
					class="h-8 w-full rounded-md border border-gray-200 bg-gray-50 px-2 text-xs outline-hidden placeholder:text-gray-400 focus:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-600 dark:focus:border-gray-700"
					type="text"
					bind:value={address}
					placeholder="127.0.0.1:3000"
					autocomplete="off"
					spellcheck="false"
				/>
			</form>

			<Tooltip content={$i18n.t('Open externally')} placement="bottom">
				<button
					type="button"
					class="preview-icon-button"
					disabled={!hasPreviewUrl || !isDesktopPreviewAvailable}
					on:click={openExternal}
				>
					<Link className="size-4" strokeWidth="2" />
				</button>
			</Tooltip>

			<Tooltip content={$i18n.t('DevTools')} placement="bottom">
				<button
					type="button"
					class="preview-icon-button"
					disabled={!hasPreviewUrl || !isDesktopPreviewAvailable}
					on:click={toggleDevTools}
				>
					<CodeBracket className="size-4" strokeWidth="2" />
				</button>
			</Tooltip>

			<Tooltip content={$i18n.t('Attach preview context')} placement="bottom">
				<button
					type="button"
					class="preview-icon-button"
					disabled={!hasPreviewUrl || !webviewReady}
					on:click={() => captureContext()}
				>
					<Camera className="size-4" strokeWidth="2" />
				</button>
			</Tooltip>

			<Tooltip content={$i18n.t('Attach preview context with each Project message')} placement="bottom">
				<label class="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-900">
					<input
						class="size-3.5 accent-gray-900 dark:accent-gray-100"
						type="checkbox"
						checked={autoAttach}
						on:change={(event) => setAutoAttach((event.currentTarget as HTMLInputElement).checked)}
					/>
					<span class="text-[11px] font-medium">{$i18n.t('Auto')}</span>
				</label>
			</Tooltip>
		</div>

		<div class="mt-1 flex min-h-4 items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
			<span class="min-w-0 truncate">{title || loadedUrl || $i18n.t('Project Preview')}</span>
			{#if captureStatus}
				<span
					class="ml-auto shrink-0 truncate {captureState === 'success'
						? 'text-emerald-600 dark:text-emerald-400'
						: captureState === 'error'
							? 'text-red-600 dark:text-red-400'
							: ''}"
					title={captureStatus}
				>
					{captureStatus}
				</span>
			{/if}
		</div>
	</div>

	<div class="relative min-h-0 flex-1 bg-white dark:bg-gray-950">
		{#if hasPreviewUrl && isDesktopPreviewAvailable}
			<webview
				bind:this={webviewEl}
				class="h-full w-full"
				src={loadedUrl}
			></webview>
		{:else}
			<div class="flex h-full items-center justify-center px-6 text-center text-sm text-gray-400 dark:text-gray-500">
				<div class="max-w-xs">
					<div class="mb-2 flex justify-center">
						<GlobeAlt className="size-6" strokeWidth="1.5" />
					</div>
					<div>{$i18n.t('Enter a localhost URL to load the Project preview.')}</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.preview-icon-button {
		display: inline-flex;
		height: 2rem;
		width: 2rem;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		border-radius: 0.375rem;
		color: rgb(107 114 128);
	}

	.preview-icon-button:hover:not(:disabled) {
		background: rgb(243 244 246);
		color: rgb(31 41 55);
	}

	.preview-icon-button:disabled {
		cursor: not-allowed;
		opacity: 0.35;
	}

	:global(.dark) .preview-icon-button {
		color: rgb(156 163 175);
	}

	:global(.dark) .preview-icon-button:hover:not(:disabled) {
		background: rgb(17 24 39);
		color: rgb(229 231 235);
	}
</style>
