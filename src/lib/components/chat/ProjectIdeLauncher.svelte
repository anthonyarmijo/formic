<script lang="ts">
	import { getContext, onMount } from 'svelte';

	import Dropdown from '$lib/components/common/Dropdown.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';

	const i18n = getContext('i18n');

	const STORAGE_KEY = 'formic.defaultProjectIde';
	const ideOptions = [
		{ id: 'vscode', label: 'VS Code', hrefPrefix: 'vscode://file/' },
		{ id: 'cursor', label: 'Cursor', hrefPrefix: 'cursor://file/' }
	] as const;

	type IdeId = (typeof ideOptions)[number]['id'];

	export let projectPath = '';

	let showDropdown = false;
	let defaultIde: IdeId = 'vscode';

	onMount(() => {
		const storedIde = localStorage.getItem(STORAGE_KEY);
		if (storedIde === 'vscode' || storedIde === 'cursor') {
			defaultIde = storedIde;
		}
	});

	$: selectedIde = ideOptions.find((option) => option.id === defaultIde) ?? ideOptions[0];
	$: openHref = `${selectedIde.hrefPrefix}${projectPath}`;

	const selectIde = (ide: IdeId) => {
		defaultIde = ide;
		localStorage.setItem(STORAGE_KEY, ide);
		showDropdown = false;
	};
</script>

{#if projectPath}
	<div id="project-ide-launcher" class="flex items-center">
		<Tooltip content={$i18n.t('Open project in {{IDE}}', { IDE: selectedIde.label })}>
			<a
				href={openHref}
				class="flex cursor-pointer items-center gap-1 rounded-l-xl px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-850 transition"
				aria-label={$i18n.t('Open project in {{IDE}}', { IDE: selectedIde.label })}
				on:click={(e) => e.stopPropagation()}
			>
				{#if selectedIde.id === 'vscode'}
					<svg class="size-4.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352z" />
					</svg>
				{:else}
					<svg class="size-4.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
						<rect x="2" y="2" width="20" height="20" rx="3" />
						<path d="M7 7h4l2 5-2 5H7l2-5-2-5z" fill="white" />
						<path d="M13 7h4v10h-4z" fill="white" />
					</svg>
				{/if}
			</a>
		</Tooltip>

		<Dropdown bind:show={showDropdown} side="bottom" align="end">
			<Tooltip content={$i18n.t('Choose default IDE')}>
				<button
					type="button"
					class="flex cursor-pointer rounded-r-xl px-1.5 py-2 hover:bg-gray-50 dark:hover:bg-gray-850 transition"
					aria-label={$i18n.t('Choose default IDE')}
				>
					<ChevronDown className="m-auto size-3" strokeWidth="2" />
				</button>
			</Tooltip>

			<div
				slot="content"
				class="rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 flex flex-col bg-white dark:bg-gray-850 w-40 p-1"
			>
				<div class="px-2 py-1 text-xs text-gray-500">{$i18n.t('Default IDE')}</div>
				{#each ideOptions as option (option.id)}
					<button
						type="button"
						class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-left transition hover:bg-gray-50 dark:hover:bg-gray-800 {defaultIde ===
						option.id
							? 'text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-800'
							: 'text-gray-700 dark:text-gray-300'}"
						on:click={() => selectIde(option.id)}
					>
						<span class="size-1.5 rounded-full {defaultIde === option.id ? 'bg-sky-500' : 'bg-transparent'}"></span>
						<span>{option.label}</span>
					</button>
				{/each}
			</div>
		</Dropdown>
	</div>
{/if}
