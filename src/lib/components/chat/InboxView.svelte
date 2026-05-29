<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import { goto } from '$app/navigation';

	import { getInboxChats, markChatReadById } from '$lib/apis/chats';
	import { selectedFolder } from '$lib/stores';
	import ChatCheck from '$lib/components/icons/ChatCheck.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	const i18n: any = getContext('i18n');

	type InboxItem = {
		id: string;
		title: string;
		updated_at: number;
		created_at: number;
		last_read_at?: number | null;
		folder_id?: string | null;
		folder_name?: string | null;
		preview?: string | null;
		time_range?: string;
	};

	let loading = true;
	let items: InboxItem[] = [];

	const loadInbox = async () => {
		loading = true;
		items = await getInboxChats(localStorage.token).catch(() => []);
		loading = false;
	};

	const markRead = async (id: string) => {
		await markChatReadById(localStorage.token, id).catch(() => null);
		items = items.filter((item) => item.id !== id);
	};

	const openChat = async (id: string) => {
		await markRead(id);
		goto(`/c/${id}`);
	};

	$: groupedItems = items.reduce<Record<string, InboxItem[]>>((groups, item) => {
		const groupName = item.folder_name || $i18n.t('Ungrouped');
		groups[groupName] = [...(groups[groupName] ?? []), item];
		return groups;
	}, {});

	onMount(() => {
		selectedFolder.set(null);
		loadInbox();
	});
</script>

<div class="flex h-full min-h-0 flex-col overflow-y-auto px-4 py-5 md:px-8">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2 text-lg font-medium text-gray-900 dark:text-gray-100">
				<ChatCheck className="size-5" strokeWidth="1.75" />
				<span>{$i18n.t('Inbox')}</span>
			</div>

			{#if items.length > 0}
				<button
					type="button"
					class="rounded-lg px-2 py-1 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-850 dark:hover:text-gray-200"
					on:click={async () => {
						await Promise.all(items.map((item) => markChatReadById(localStorage.token, item.id).catch(() => null)));
						items = [];
					}}
				>
					{$i18n.t('Mark all read')}
				</button>
			{/if}
		</div>

		{#if loading}
			<div class="py-10 text-center text-sm text-gray-500">{$i18n.t('Loading...')}</div>
		{:else if items.length === 0}
			<div class="py-10 text-center text-sm text-gray-500">{$i18n.t('All caught up')}</div>
		{:else}
			<div class="flex flex-col gap-5">
				{#each Object.entries(groupedItems) as [groupName, groupItems]}
					<section class="flex flex-col gap-1.5">
						<div class="px-1 text-xs font-medium uppercase text-gray-400">{groupName}</div>

						<div class="flex flex-col gap-1">
							{#each groupItems as item (item.id)}
								<div
									class="group flex items-center gap-2 rounded-lg border border-gray-100 px-2 py-2 transition hover:bg-gray-50 dark:border-gray-850 dark:hover:bg-gray-900"
								>
									<button
										type="button"
										class="min-w-0 flex-1 text-left"
										on:click={() => openChat(item.id)}
									>
										<div class="flex min-w-0 items-center gap-2">
											<span class="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
												{item.title}
											</span>
											<span class="shrink-0 text-xs text-gray-400">{item.time_range}</span>
										</div>
										{#if item.preview}
											<div class="mt-0.5 line-clamp-1 text-xs text-gray-500">{item.preview}</div>
										{/if}
									</button>

									<button
										type="button"
										class="rounded-md p-1 text-gray-400 opacity-0 transition hover:bg-gray-100 hover:text-gray-700 group-hover:opacity-100 dark:hover:bg-gray-850 dark:hover:text-gray-200"
										aria-label={$i18n.t('Mark read')}
										on:click={() => markRead(item.id)}
									>
										<XMark className="size-4" strokeWidth="2" />
									</button>
								</div>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{/if}
	</div>
</div>
