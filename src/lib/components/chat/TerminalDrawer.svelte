<script lang="ts">
	import { onDestroy, getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { fly } from 'svelte/transition';
	import { terminalServers, settings, selectedTerminalId } from '$lib/stores';
	import { setCwd } from '$lib/apis/terminal';
	import { WEBUI_API_BASE_URL } from '$lib/constants';
	import { terminalCollapsed, terminalHeight } from '$lib/stores/terminal';
	import XTerminal from './XTerminal.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import Terminal from '$lib/components/icons/Terminal.svelte';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
	import type { i18n as i18nType } from 'i18next';

	const i18n: Writable<i18nType> = getContext('i18n');
	const FORMIC_LOCAL_TERMINAL_ID = 'formic-local-terminal';

	export let open = false;
	export let projectPath = '';
	export let folderId = '';

	let resizing = false;
	let startY = 0;
	let startHeight = 0;
	let drawerEl: HTMLDivElement;

	// Track whether XTerminal should be mounted
	let terminalMounted = false;
	let cwdSetting = false;
	let cwdError: string | null = null;
	let connected = false;
	let connecting = false;
	let setupKey = '';

	$: systemTerminals = (($terminalServers ?? []) as any[]).filter((t: any) => t.id);
	$: directTerminals = ((($settings as any)?.terminalServers ?? []) as any[]).filter(
		(s: any) => s.url
	);
	$: localProjectTerminal = systemTerminals.find((t: any) => t.id === FORMIC_LOCAL_TERMINAL_ID);
	$: activeTerminalId =
		$selectedTerminalId ??
		(localProjectTerminal && projectPath ? FORMIC_LOCAL_TERMINAL_ID : null);
	$: activeSystemTerminal = systemTerminals.find((t: any) => t.id === activeTerminalId);
	$: activeDirectTerminal = directTerminals.find((t: any) => t.url === activeTerminalId);
	$: activeTerminalName =
		activeSystemTerminal?.name ||
		activeSystemTerminal?.id ||
		activeDirectTerminal?.name ||
		activeDirectTerminal?.url?.replace(/^https?:\/\//, '') ||
		$i18n.t('No terminal');
	$: activeTerminalProvider = activeSystemTerminal
		? 'system'
		: activeDirectTerminal
			? 'direct'
			: activeTerminalId
				? 'missing'
				: 'none';
	$: sessionKey = folderId ? `formic-group:${folderId}` : '';

	$: {
		const nextSetupKey = `${open}:${projectPath}:${sessionKey}:${activeTerminalId ?? ''}`;
		if (open && projectPath && activeTerminalId && nextSetupKey !== setupKey) {
			setupKey = nextSetupKey;
			setupCwdAndMount();
		}
	}

	// When drawer closes, unmount terminal
	$: if (!open && terminalMounted) {
		terminalMounted = false;
		cwdError = null;
		setupKey = '';
	}

	async function setupCwdAndMount() {
		terminalMounted = true;
		cwdSetting = true;
		cwdError = null;

		try {
			const token = localStorage.getItem('token') ?? '';

			if (activeSystemTerminal) {
				await setCwd(`${WEBUI_API_BASE_URL}/terminals/${activeSystemTerminal.id}`, token, projectPath, sessionKey);
			} else if (activeDirectTerminal) {
				await setCwd(activeDirectTerminal.url, activeDirectTerminal.key ?? '', projectPath, sessionKey);
			} else {
				throw new Error('No active terminal is available for this Project');
			}
		} catch (err) {
			console.error('Failed to set terminal CWD:', err);
			cwdError = String(err);
		} finally {
			cwdSetting = false;
		}
	}

	function close() {
		open = false;
	}

	function onResizeStart(e: MouseEvent) {
		if ($terminalCollapsed) return;

		resizing = true;
		startY = e.clientY;
		startHeight = $terminalHeight;

		const onMouseMove = (e: MouseEvent) => {
			if (!resizing) return;
			const delta = startY - e.clientY;
			const newHeight = Math.max(120, Math.min(500, startHeight + delta));
			terminalHeight.set(newHeight);
		};

		const onMouseUp = () => {
			resizing = false;
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
		};

		document.body.style.cursor = 'ns-resize';
		document.body.style.userSelect = 'none';
		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
	}

	export function toggle() {
		open = !open;
	}

	function toggleCollapsed() {
		terminalCollapsed.set(!$terminalCollapsed);
	}

	onDestroy(() => {
		// Cleanup: if resizing was in progress
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	});
</script>

{#if open}
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		bind:this={drawerEl}
		class="terminal-drawer flex flex-col border-t border-gray-700 bg-black"
		style="height: {$terminalCollapsed ? 38 : $terminalHeight}px; min-height: {$terminalCollapsed ? 38 : 120}px;"
		transition:fly={{ y: 20, duration: 200 }}
	>
		<!-- Resize Handle -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="flex-shrink-0 h-1.5 cursor-ns-resize hover:bg-gray-600 transition-colors group relative"
			on:mousedown={onResizeStart}
			role="separator"
			aria-orientation="horizontal"
			aria-label="Resize terminal"
		>
			<div class="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center">
				<div class="w-8 h-0.5 rounded-full bg-gray-600 group-hover:bg-gray-400 transition-colors"></div>
			</div>
		</div>

		<!-- Header Bar -->
		<div class="flex-shrink-0 flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800">
			<div class="flex items-center gap-2 text-xs text-gray-400 min-w-0">
					<span
						class="size-2 rounded-full {connected
							? 'bg-emerald-500'
							: connecting || cwdSetting
								? 'bg-yellow-400'
								: 'bg-gray-600'}"
					></span>
					<Terminal className="size-3.5" strokeWidth="1.5" />
					<span class="truncate max-w-[200px]">{projectPath.split('/').pop() || 'Terminal'}</span>
					<span class="text-gray-600 truncate">{projectPath}</span>
					<span class="hidden md:inline text-gray-700">/</span>
					<span class="hidden md:inline truncate max-w-[180px]">{activeTerminalName}</span>
					<span class="hidden lg:inline rounded bg-gray-800 px-1.5 py-0.5 text-[10px] uppercase text-gray-500">
						{activeTerminalProvider}
					</span>
					{#if sessionKey}
						<span class="hidden xl:inline text-gray-600 truncate max-w-[220px]">{sessionKey}</span>
					{/if}
			</div>

			<div class="flex items-center gap-1">
				<button
					class="p-0.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
					title={$terminalCollapsed ? $i18n.t('Expand Terminal') : $i18n.t('Collapse Terminal')}
					on:click={toggleCollapsed}
				>
					<ChevronDown
						className="size-4 transition-transform {$terminalCollapsed ? 'rotate-180' : ''}"
						strokeWidth="2"
					/>
				</button>
				<button
					class="p-0.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
					title={$i18n.t('Close Terminal')}
					on:click={close}
				>
					<XMark className="size-4" strokeWidth="2" />
				</button>
			</div>
		</div>

		<!-- Terminal Body -->
		<div class="flex-1 min-h-0 overflow-hidden {$terminalCollapsed ? 'h-0 flex-none' : ''}">
			{#if cwdSetting}
				<div class="flex items-center justify-center h-full text-gray-500 text-sm">
					Setting working directory...
				</div>
			{:else if cwdError}
				<div class="flex items-center justify-center h-full text-gray-500 text-sm px-4">
					<div class="text-center">
						<div class="text-red-400 mb-1">Failed to set directory</div>
						<div class="text-xs text-gray-600 truncate max-w-[300px]">{cwdError}</div>
					</div>
				</div>
			{:else if terminalMounted}
				<XTerminal
					overlay={false}
					chatId={sessionKey || null}
					bind:connected
					bind:connecting
				/>
			{/if}
		</div>
	</div>
{/if}

<style>
	.terminal-drawer :global(.xterm) {
		height: 100%;
		padding: 4px 8px;
	}
	.terminal-drawer :global(.xterm-viewport) {
		scrollbar-width: thin;
		scrollbar-color: #555 #000;
	}
</style>
