<script lang="ts">
	import { onDestroy, getContext } from 'svelte';
	import { fly } from 'svelte/transition';
	import { terminalServers, settings, selectedFolder, user } from '$lib/stores';
	import { setCwd } from '$lib/apis/terminal';
	import { WEBUI_API_BASE_URL } from '$lib/constants';
	import XTerminal from './XTerminal.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	const i18n = getContext('i18n');

	export let open = false;
	export let projectPath = '';
	export let folderId = '';

	let height = 280;
	let resizing = false;
	let startY = 0;
	let startHeight = 0;
	let drawerEl: HTMLDivElement;

	// Track whether XTerminal should be mounted
	let terminalMounted = false;
	let cwdSetting = false;
	let cwdError: string | null = null;

	// When open becomes true, set CWD then mount terminal
	$: if (open && projectPath && !terminalMounted) {
		setupCwdAndMount();
	}

	// When drawer closes, unmount terminal
	$: if (!open && terminalMounted) {
		terminalMounted = false;
		cwdError = null;
	}

	async function setupCwdAndMount() {
		terminalMounted = true;
		cwdSetting = true;
		cwdError = null;

		try {
			const token = localStorage.getItem('token') ?? '';

			// Determine the terminal server to use
			const systemTerminals = ($terminalServers ?? []).filter((t: any) => t.id);
			const directTerminals = ($settings?.terminalServers ?? []).filter((s: any) => s.url);

			if (systemTerminals.length > 0) {
				const serverId = systemTerminals[0].id;
				// Use proxy through Open WebUI backend
				await setCwd(
					`${WEBUI_API_BASE_URL}/terminals/${serverId}`,
					token,
					projectPath,
					folderId
				);
			} else if (directTerminals.length > 0) {
				const directServer = directTerminals[0];
				const apiKey = directServer.key ?? '';
				await setCwd(
					directServer.url,
					apiKey,
					projectPath,
					folderId
				);
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
		resizing = true;
		startY = e.clientY;
		startHeight = height;

		const onMouseMove = (e: MouseEvent) => {
			if (!resizing) return;
			const delta = startY - e.clientY;
			const newHeight = Math.max(120, Math.min(500, startHeight + delta));
			height = newHeight;
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
		style="height: {height}px; min-height: 120px;"
		transition:fly={{ y: 20, duration: 200 }}
	>
		<!-- Resize Handle -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div
			class="flex-shrink-0 h-1.5 cursor-ns-resize hover:bg-gray-600 transition-colors group relative"
			on:mousedown={onResizeStart}
			role="separator"
			aria-orientation="horizontal"
			aria-label="Resize terminal"
			tabindex="0"
		>
			<div class="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center">
				<div class="w-8 h-0.5 rounded-full bg-gray-600 group-hover:bg-gray-400 transition-colors" />
			</div>
		</div>

		<!-- Header Bar -->
		<div class="flex-shrink-0 flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800">
			<div class="flex items-center gap-2 text-xs text-gray-400">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="1.5"
					stroke="currentColor"
					class="size-3.5"
				>
					<path d="M13 16H18" stroke-linecap="round" stroke-linejoin="round" />
					<path d="M6 8L10 12L6 16" stroke-linecap="round" stroke-linejoin="round" />
					<path d="M2 18V6C2 4.89543 2.89543 4 4 4H20C21.1046 4 22 4.89543 22 6V18C22 19.1046 21.1046 20 20 20H4C2.89543 20 2 19.1046 2 18Z" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				<span class="truncate max-w-[200px]">{projectPath.split('/').pop() || 'Terminal'}</span>
				<span class="text-gray-600">{projectPath}</span>
			</div>

			<button
				class="p-0.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
				title="Close Terminal"
				on:click={close}
			>
				<XMark className="size-4" strokeWidth="2" />
			</button>
		</div>

		<!-- Terminal Body -->
		<div class="flex-1 min-h-0 overflow-hidden">
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
				<XTerminal overlay={false} chatId={null} />
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
