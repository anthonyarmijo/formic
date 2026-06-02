import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('formicDesktop', {
  getServerStatus: () => ipcRenderer.invoke('formic:server-status'),
  selectProjectDirectory: () => ipcRenderer.invoke('formic:select-project-directory')
});
