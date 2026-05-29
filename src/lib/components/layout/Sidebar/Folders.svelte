<script lang="ts">
	import { createEventDispatcher, getContext, onMount } from 'svelte';
	const dispatch = createEventDispatcher();
	const i18n: any = getContext('i18n');

	import RecursiveFolder from './RecursiveFolder.svelte';
	import { chatId, selectedFolder } from '$lib/stores';

	export let folderRegistry: Record<string, any> = {};

	export let folders: Record<string, any> = {};
	export let shiftKey = false;
	export let activeWorkspace = 'all';

	export let onDelete = (folderId: string) => {};

	const WORKSPACE_STORAGE_KEY = 'formic.activeWorkspace';

	let groupFilter = 'all';
	let searchValue = '';
	let sortBy = 'alpha';
	let folderList: string[] = [];
	let visibleFolders: Record<string, any> = {};
	let workspaceOptions: string[] = [];

	onMount(() => {
		const storedWorkspace = localStorage.getItem(WORKSPACE_STORAGE_KEY);
		if (storedWorkspace) {
			activeWorkspace = storedWorkspace;
		}
	});

	$: if (typeof localStorage !== 'undefined') {
		localStorage.setItem(WORKSPACE_STORAGE_KEY, activeWorkspace);
	}

	$: workspaceOptions = [
		'all',
		...Array.from(
			new Set(
				[
					'personal',
					activeWorkspace !== 'all' ? activeWorkspace : null,
					...Object.values(folders)
						.map((folder: any) => folder?.data?.workspace)
						.filter((workspace) => typeof workspace === 'string' && workspace.trim())
				]
					.filter(Boolean)
					.map((workspace: string) => workspace.trim())
			)
		).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
	];

	const sortFolderIds = (ids: string[], folderMap: Record<string, any>) => {
		return [...ids].sort((a, b) => {
			if (sortBy === 'recent') {
				return (folderMap[b]?.updated_at ?? 0) - (folderMap[a]?.updated_at ?? 0);
			}

			if (sortBy === 'type') {
				const typeCompare = (folderMap[a]?.data?.group_type ?? 'topic').localeCompare(
					folderMap[b]?.data?.group_type ?? 'topic',
					undefined,
					{ sensitivity: 'base' }
				);
				if (typeCompare !== 0) {
					return typeCompare;
				}
			}

			return (folderMap[a]?.name ?? '').localeCompare(folderMap[b]?.name ?? '', undefined, {
				numeric: true,
				sensitivity: 'base'
			});
		});
	};

	const folderMatchesFilters = (folder: any) => {
		const data = folder?.data ?? {};
		const query = searchValue.trim().toLowerCase();

		if (activeWorkspace !== 'all' && data.workspace !== activeWorkspace) {
			return false;
		}

		if (groupFilter === 'project' && data.group_type !== 'project') {
			return false;
		}
		if (groupFilter === 'topic' && data.group_type !== 'topic') {
			return false;
		}
		if (groupFilter === 'terminal' && !data.project_path) {
			return false;
		}

		if (query) {
			const searchable = [folder?.name, ...(Array.isArray(data.tags) ? data.tags : [])]
				.filter(Boolean)
				.join(' ')
				.toLowerCase();
			if (!searchable.includes(query)) {
				return false;
			}
		}

		return true;
	};

	$: {
		const visibleIds = new Set();

		for (const [folderId, folder] of Object.entries(folders)) {
			if (folderMatchesFilters(folder)) {
				let currentId: string | null = folderId;
				while (currentId && folders[currentId]) {
					visibleIds.add(currentId);
					currentId = folders[currentId].parent_id;
				}
			}
		}

		visibleFolders = Object.fromEntries(
			Object.entries(folders)
				.filter(([folderId]) => visibleIds.has(folderId))
				.map(([folderId, folder]: any) => [
					folderId,
					{
						...folder,
						childrenIds: sortFolderIds(
							(folder.childrenIds ?? []).filter((childId: string) => visibleIds.has(childId)),
							folders
						)
					}
				])
		);

		folderList = sortFolderIds(
			Object.keys(visibleFolders).filter((key) => visibleFolders[key].parent_id === null),
			visibleFolders
		);
	}

	const onItemMove = (e: any) => {
		if (e.originFolderId) {
			folderRegistry[e.originFolderId]?.setFolderItems();
		}
	};

	const loadFolderItems = () => {
		for (const folderId of Object.keys(visibleFolders)) {
			folderRegistry[folderId]?.setFolderItems();
		}
	};

	$: if (folders || ($selectedFolder && $chatId)) {
		loadFolderItems();
	}
</script>

<div class="px-2 pb-1 space-y-2">
	<div class="flex gap-1">
		<select
			class="min-w-0 flex-1 rounded-lg border border-gray-100 dark:border-gray-800 bg-transparent px-2 py-1 text-xs outline-hidden"
			bind:value={activeWorkspace}
			aria-label="Workspace"
		>
			{#each workspaceOptions as workspace}
				<option value={workspace}>
					{workspace === 'all' ? $i18n.t('All Workspaces') : workspace}
				</option>
			{/each}
		</select>

		<select
			class="rounded-lg border border-gray-100 dark:border-gray-800 bg-transparent px-2 py-1 text-xs outline-hidden"
			bind:value={sortBy}
			aria-label="Sort groups"
		>
			<option value="alpha">{$i18n.t('A-Z')}</option>
			<option value="recent">{$i18n.t('Recent')}</option>
			<option value="type">{$i18n.t('Type')}</option>
		</select>
	</div>

	<input
		class="w-full rounded-lg border border-gray-100 dark:border-gray-800 bg-transparent px-2 py-1 text-xs outline-hidden placeholder:text-gray-400"
		bind:value={searchValue}
		placeholder={$i18n.t('Search groups and tags')}
		aria-label="Search groups and tags"
	/>

	<div class="flex flex-wrap gap-1">
		{#each [
			['all', 'All'],
			['project', 'Projects'],
			['topic', 'Topics'],
			['terminal', 'Has Terminal']
		] as filter}
			<button
				type="button"
				class="rounded-full px-2 py-0.5 text-[11px] transition {groupFilter === filter[0]
					? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
					: 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-850 dark:text-gray-300 dark:hover:bg-gray-800'}"
				on:click={() => {
					groupFilter = filter[0];
				}}
			>
				{$i18n.t(filter[1])}
			</button>
		{/each}
	</div>
</div>

{#if folderList.length === 0}
	<div class="px-4 py-2 text-xs text-gray-500">{$i18n.t('No groups found')}</div>
{:else}
	{#each folderList as folderId (folderId)}
		<RecursiveFolder
			className=""
			bind:folderRegistry
			folders={visibleFolders}
			{folderId}
			{shiftKey}
			{onDelete}
			{onItemMove}
			on:import={(e) => {
				dispatch('import', e.detail);
			}}
			on:update={(e) => {
				dispatch('update', e.detail);
			}}
			on:change={(e) => {
				dispatch('change', e.detail);
			}}
		/>
	{/each}
{/if}
