// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	interface Window {
		formicDesktop?: {
			getServerStatus?: () => Promise<Record<string, unknown>>;
			getSessionToken?: () => Promise<string | null>;
			setSessionToken?: (token: string) => Promise<boolean>;
			clearSessionToken?: () => Promise<boolean>;
			selectProjectDirectory?: () => Promise<string | null>;
			openExternalUrl?: (url: string) => Promise<boolean>;
		};
	}

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}
}

export {};
