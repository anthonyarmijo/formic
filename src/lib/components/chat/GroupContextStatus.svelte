<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { browser } from '$app/environment';

	import {
		getWorkspaceContext,
		type FormicWorkspaceContext
	} from '$lib/apis/workspaces';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import InfoCircle from '$lib/components/icons/InfoCircle.svelte';
	import Refresh from '$lib/components/icons/Refresh.svelte';
	import Terminal from '$lib/components/icons/Terminal.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');

	export let folder: any = null;
	export let chatId: string | null = null;
	export let activeTerminalId: string | null = null;
	export let activeTerminalName = '';
	export let activeTerminalProvider = '';
	export let terminalToolsAvailable = false;

	let context: FormicWorkspaceContext | null = null;
	let loading = false;
	let error = false;
	let loadKey = '';
	let requestId = 0;

	$: groupContext = context?.formic_group_context ?? null;
	$: memoryContext = context?.formic_memory_context ?? null;
	$: hermesContext = context?.formic_hermes ?? null;
	$: hindsightBankId = memoryContext?.providers?.hindsight?.bank_id ?? null;
	$: statusItems = [
		{
			label: $i18n.t('Group'),
			value: `${displayValue(groupContext?.group_name)} · ${displayValue(groupContext?.group_type)}`
		},
		{ label: $i18n.t('ID'), value: displayValue(groupContext?.group_id) },
		{
			label: $i18n.t('Path'),
			value: displayValue(groupContext?.project_path ?? folder?.data?.project_path)
		},
		{ label: $i18n.t('Hermes'), value: displayValue(hermesContext?.conversation) },
		{ label: $i18n.t('Hindsight'), value: displayValue(hindsightBankId) },
		{
			label: $i18n.t('Terminal'),
			value: activeTerminalId
				? `${activeTerminalName || activeTerminalId} · ${activeTerminalProvider || 'unknown'}`
				: $i18n.t('Not selected'),
			icon: 'terminal'
		},
		{
			label: $i18n.t('Tools'),
			value: terminalToolsAvailable ? $i18n.t('Available') : $i18n.t('Unavailable')
		}
	];

	const displayValue = (value: string | null | undefined) => value?.trim() || 'Not set';

	const refresh = async () => {
		if (!browser || !folder?.id) {
			context = null;
			error = false;
			return;
		}

		const currentRequest = ++requestId;
		loading = true;
		error = false;

		const nextContext = await getWorkspaceContext(localStorage.token, folder.id, chatId);
		if (currentRequest !== requestId) {
			return;
		}

		context = nextContext;
		error = !nextContext;
		loading = false;
	};

	$: {
		const nextLoadKey = `${folder?.id ?? ''}:${chatId ?? ''}`;
		if (nextLoadKey !== loadKey) {
			loadKey = nextLoadKey;
			refresh();
		}
	}
</script>

{#if folder?.data?.group_type === 'project'}
	<div
		class="z-10 border-y border-gray-100 dark:border-gray-850 bg-white/85 dark:bg-gray-950/70 backdrop-blur px-3 py-2"
	>
		<div class="flex items-center gap-2 text-xs min-w-0">
			<div class="flex items-center gap-1.5 shrink-0 text-gray-500 dark:text-gray-400">
				<InfoCircle className="size-3.5" strokeWidth="2" />
				<span class="font-medium">{$i18n.t('Group Context')}</span>
			</div>

			{#if loading}
				<span class="text-gray-400 dark:text-gray-500">{$i18n.t('Loading...')}</span>
			{:else if error}
				<span class="text-red-600 dark:text-red-400">{$i18n.t('Context unavailable')}</span>
				<button
					type="button"
					class="rounded-md px-1.5 py-0.5 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-850"
					on:click={refresh}
				>
					{$i18n.t('Retry')}
				</button>
			{:else}
				<div class="flex items-center gap-1.5 overflow-x-auto scrollbar-none min-w-0">
					{#each statusItems as item}
						<div
							class="inline-flex max-w-[18rem] shrink-0 items-center gap-1 rounded-md border border-gray-100 bg-gray-50 px-2 py-0.5 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
							title={`${item.label}: ${item.value}`}
						>
							{#if item.icon === 'terminal'}
								<Terminal className="size-3" strokeWidth="2" />
							{/if}
							<span class="font-medium text-gray-400 dark:text-gray-500">{item.label}</span>
							<span class="truncate">{item.value}</span>
						</div>
					{/each}
				</div>

				<Tooltip content={$i18n.t('Refresh context')} placement="bottom">
					<button
						type="button"
						class="ml-auto shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-850 dark:hover:text-gray-200"
						on:click={refresh}
					>
						<Refresh className="size-3.5" strokeWidth="2" />
					</button>
				</Tooltip>
			{/if}
		</div>
	</div>
{/if}
