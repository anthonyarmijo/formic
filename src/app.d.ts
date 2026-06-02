// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	interface Window {
		formicDesktop?: {
			getServerStatus?: () => Promise<Record<string, unknown>>;
			selectProjectDirectory?: () => Promise<string | null>;
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
