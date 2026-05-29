<script lang="ts">
	import { getContext, onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	import { getInboxChats } from '$lib/apis/chats';
	import ChatCheck from '$lib/components/icons/ChatCheck.svelte';

	const i18n: any = getContext('i18n');

	export let onOpen = () => {};

	let unreadCount = 0;
	let interval: ReturnType<typeof setInterval> | null = null;

	const refreshInbox = async () => {
		if (typeof localStorage === 'undefined' || !localStorage.token) {
			return;
		}

		const items = await getInboxChats(localStorage.token).catch(() => []);
		unreadCount = items.length;
	};

	onMount(() => {
		refreshInbox();
		interval = setInterval(refreshInbox, 30000);
	});

	onDestroy(() => {
		if (interval) {
			clearInterval(interval);
		}
	});

	$: selected = $page.url.pathname === '/inbox';
</script>

<div class="px-2 mt-0.5">
	<button
		type="button"
		class="w-full flex items-center justify-between rounded-xl px-2 py-1.5 text-sm transition {selected
			? 'bg-gray-100 text-gray-900 dark:bg-gray-850 dark:text-gray-100'
			: 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-850'}"
		on:click={() => {
			onOpen();
			goto('/inbox');
		}}
		aria-label={$i18n.t('Inbox')}
	>
		<span class="flex min-w-0 items-center gap-2">
			<ChatCheck className="size-4" strokeWidth="1.75" />
			<span class="truncate">{$i18n.t('Inbox')}</span>
		</span>

		{#if unreadCount > 0}
			<span
				class="ml-2 min-w-5 rounded-full bg-gray-900 px-1.5 py-0.5 text-center text-[11px] leading-none text-white dark:bg-gray-100 dark:text-gray-900"
			>
				{unreadCount}
			</span>
		{/if}
	</button>
</div>
