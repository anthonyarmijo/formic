import { WEBUI_API_BASE_URL } from '$lib/constants';

export type FormicGroupContext = {
	group_id?: string | null;
	group_name?: string | null;
	group_type?: string | null;
	project_path?: string | null;
	chat_id?: string | null;
	user_id?: string | null;
};

export type FormicMemoryContext = {
	default_provider?: string | null;
	providers?: Record<string, { bank_id?: string | null } & Record<string, unknown>>;
};

export type FormicHermesContext = {
	conversation?: string | null;
	group_id?: string | null;
};

export type FormicWorkspaceContext = {
	formic_group_context?: FormicGroupContext | null;
	formic_memory_context?: FormicMemoryContext | null;
	formic_hermes?: FormicHermesContext | null;
};

export const getWorkspaceContext = async (
	token: string,
	id: string,
	chatId?: string | null
): Promise<FormicWorkspaceContext | null> => {
	const searchParams = new URLSearchParams();
	if (chatId) {
		searchParams.set('chat_id', chatId);
	}

	const query = searchParams.toString();
	const res = await fetch(`${WEBUI_API_BASE_URL}/workspaces/${id}/context${query ? `?${query}` : ''}`, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			authorization: `Bearer ${token}`
		}
	}).catch(() => null);

	if (!res || !res.ok) {
		return null;
	}

	return res.json().catch(() => null);
};
