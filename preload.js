const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  openSettings: () => ipcRenderer.send('window:settings:open'),
  readFile: (path) => ipcRenderer.invoke('file:read', path),
  readCachedPdf: (path) => ipcRenderer.invoke('pdf:cache:read', path),
  writeCachedPdf: (path, data) =>
    ipcRenderer.invoke('pdf:cache:write', { pdfPath: path, data }),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openFileDialog: () => ipcRenderer.invoke('dialog:open'),
  getUserDataPath: () => ipcRenderer.invoke('app:get-path'),
  loadIndex: () => ipcRenderer.invoke('data:read-index'),
  saveIndex: (content) => ipcRenderer.invoke('data:write-index', content),
  readContent: (hash) => ipcRenderer.invoke('data:read-content', hash),
  saveContent: (hash, content) => ipcRenderer.invoke('data:write-content', hash, content),
  deleteContent: (hash) => ipcRenderer.invoke('data:delete-content', hash)
});
