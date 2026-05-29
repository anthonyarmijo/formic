import { writable } from 'svelte/store';

export const terminalOpen = writable(false);
export const terminalProjectPath = writable('');
