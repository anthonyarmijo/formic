import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('formicDesktop', {
	getServerStatus: () => ipcRenderer.invoke('formic:server-status'),
	getSessionToken: () => ipcRenderer.invoke('formic:get-session-token'),
	setSessionToken: (token: string) => ipcRenderer.invoke('formic:set-session-token', token),
	clearSessionToken: () => ipcRenderer.invoke('formic:clear-session-token'),
	selectProjectDirectory: () => ipcRenderer.invoke('formic:select-project-directory'),
	openExternalUrl: (url: string) => ipcRenderer.invoke('formic:open-external-url', url)
});
