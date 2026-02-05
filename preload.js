const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sunshadeAPI', {
  openaiAuthStatus: () => ipcRenderer.invoke('auth:openai:status'),
  openaiLogin: () => ipcRenderer.invoke('auth:openai:login'),
  openaiAccessToken: () => ipcRenderer.invoke('auth:openai:token'),
  openaiLogout: () => ipcRenderer.invoke('auth:openai:logout'),
  openaiChatCompletion: (messages, instructions) =>
    ipcRenderer.invoke('chat:openai:completion', { messages, instructions }),
  loadPrompts: () => ipcRenderer.invoke('prompts:get')
});
