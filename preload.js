const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sunshadeAPI', {
  openaiAuthStatus: () => ipcRenderer.invoke('auth:openai:status'),
  openaiLogin: () => ipcRenderer.invoke('auth:openai:login'),
  openaiAccessToken: () => ipcRenderer.invoke('auth:openai:token'),
  openaiLogout: () => ipcRenderer.invoke('auth:openai:logout'),
  
  // Legacy non-streaming
  openaiChatCompletion: (messages, instructions, model) =>
    ipcRenderer.invoke('chat:openai:completion', { messages, instructions, model }),
    
  // Streaming support
  openaiStream: (messages, instructions, callbacks, model) => {
    const streamId = Math.random().toString(36).slice(2);
    
    const chunkHandler = (_event, data) => {
      if (data.streamId === streamId && callbacks.onChunk) {
        callbacks.onChunk(data.chunk);
      }
    };
    
    const doneHandler = (_event, data) => {
      if (data.streamId === streamId) {
        cleanup();
        if (callbacks.onDone) callbacks.onDone();
      }
    };
    
    const errorHandler = (_event, data) => {
      if (data.streamId === streamId) {
        cleanup();
        if (callbacks.onError) callbacks.onError(new Error(data.error));
      }
    };
    
    const cleanup = () => {
      ipcRenderer.removeListener('chat:openai:stream:chunk', chunkHandler);
      ipcRenderer.removeListener('chat:openai:stream:done', doneHandler);
      ipcRenderer.removeListener('chat:openai:stream:error', errorHandler);
    };

    ipcRenderer.on('chat:openai:stream:chunk', chunkHandler);
    ipcRenderer.on('chat:openai:stream:done', doneHandler);
    ipcRenderer.on('chat:openai:stream:error', errorHandler);

    ipcRenderer.send('chat:openai:stream:start', { messages, instructions, streamId, model });
    
    // Return unsubscribe function
    return cleanup;
  },

  loadPrompts: () => ipcRenderer.invoke('prompts:getCombined'),
  loadCustomPrompts: () => ipcRenderer.invoke('prompts:get'),
  savePrompts: (data) => ipcRenderer.invoke('prompts:save', data),
  openSettings: () => ipcRenderer.send('window:settings:open')
});
