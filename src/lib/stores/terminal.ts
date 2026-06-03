import { writable } from 'svelte/store';

export const terminalOpen = writable(false);
export const terminalProjectPath = writable('');
export const terminalCollapsed = writable(false);
export const terminalHeight = writable(280);
