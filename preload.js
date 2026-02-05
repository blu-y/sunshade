const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sunshadeAPI', {
  googleAuthStatus: () => ipcRenderer.invoke('auth:google:status'),
  googleLogin: () => ipcRenderer.invoke('auth:google:login'),
  googleAccessToken: () => ipcRenderer.invoke('auth:google:token'),
  openaiAuthStatus: () => ipcRenderer.invoke('auth:openai:status'),
  openaiLogin: () => ipcRenderer.invoke('auth:openai:login'),
  openaiAccessToken: () => ipcRenderer.invoke('auth:openai:token'),
  openaiLogout: () => ipcRenderer.invoke('auth:openai:logout')
});
