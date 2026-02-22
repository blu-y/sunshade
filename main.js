const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const {
  signInWithOpenAI,
  ensureOpenAIConfig,
  getValidOpenAIToken,
  logoutOpenAI
} = require('./src/auth/openai');
const { codexChatCompletion, codexChatCompletionStream } = require('./src/llm/codex-chat');

function loadWindowState() {
  try {
    const userData = app.getPath('userData');
    const statePath = path.join(userData, 'window-state.json');
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      width: parsed.width || 1600,
      height: parsed.height || 1000,
      x: parsed.x,
      y: parsed.y
    };
  } catch {
    return { width: 1600, height: 1000 };
  }
}

function saveWindowState(bounds) {
  try {
    const userData = app.getPath('userData');
    const statePath = path.join(userData, 'window-state.json');
    fs.writeFileSync(
      statePath,
      JSON.stringify(
        { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y },
        null,
        2
      )
    );
  } catch (err) {
    console.error('Failed to save window state', err);
  }
}

function getPdfCachePath(pdfPath) {
  const hash = crypto.createHash('sha256').update(pdfPath).digest('hex');
  const cacheDir = path.join(app.getPath('userData'), 'pdf-cache');
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  return path.join(cacheDir, `${hash}.pdf`);
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', () => saveWindowState(win.getBounds()));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('auth:openai:status', () => ensureOpenAIConfig());
ipcMain.handle('auth:openai:login', () => signInWithOpenAI());
ipcMain.handle('auth:openai:token', () => getValidOpenAIToken());
ipcMain.handle('auth:openai:logout', () => logoutOpenAI());
ipcMain.handle('chat:openai:completion', async (_event, { messages, instructions, model }) => {
  const { token, accountId } = await getValidOpenAIToken();
  const userMessage = Array.isArray(messages) ? messages.find((m) => m.role === 'user') : null;
  const question = userMessage?.content || messages?.[0]?.content || '';
  const result = await codexChatCompletion(token, accountId, question, instructions, model);
  return result;
});

ipcMain.on('chat:openai:stream:start', async (event, { messages, instructions, streamId, model }) => {
  try {
    const { token, accountId } = await getValidOpenAIToken();
    const userMessage = Array.isArray(messages) ? messages.find((m) => m.role === 'user') : null;
    const question = userMessage?.content || messages?.[0]?.content || '';

    for await (const chunk of codexChatCompletionStream(token, accountId, question, instructions, model)) {
      if (!event.sender.isDestroyed()) {
        event.sender.send('chat:openai:stream:chunk', { streamId, chunk });
      }
    }
    
    if (!event.sender.isDestroyed()) {
      event.sender.send('chat:openai:stream:done', { streamId });
    }
  } catch (err) {
    if (!event.sender.isDestroyed()) {
      event.sender.send('chat:openai:stream:error', { streamId, error: err.message });
    }
  }
});

// Load custom prompts for settings UI
ipcMain.handle('prompts:get', () => {
  try {
    const customP = path.join(app.getPath('userData'), 'custom_prompts.json');
    if (!fs.existsSync(customP)) {
        // Return default empty structure if file doesn't exist
        return { system: "", sections: { keywords: "", brief: "", summary: "" } };
    }
    const raw = fs.readFileSync(customP, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load custom_prompts.json', err);
    return {};
  }
});

// Save custom prompts
ipcMain.handle('prompts:save', (_event, data) => {
  try {
    const customP = path.join(app.getPath('userData'), 'custom_prompts.json');
    fs.writeFileSync(customP, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to save custom_prompts.json', err);
    throw err;
  }
});

// Load combined prompts for actual generation
ipcMain.handle('prompts:getCombined', () => {
  try {
    const baseP = path.join(__dirname, 'src', 'llm', 'prompts.json');
    const customP = path.join(app.getPath('userData'), 'custom_prompts.json');
    
    const base = JSON.parse(fs.readFileSync(baseP, 'utf-8'));
    let custom = {};
    
    if (fs.existsSync(customP)) {
      try {
        custom = JSON.parse(fs.readFileSync(customP, 'utf-8'));
      } catch (e) {
        console.warn('Failed to parse custom prompts', e);
      }
    }

    const combine = (b, c) => {
      if (!c) return b;
      return b + '\n\n' + c;
    };

    return {
      system: combine(base.system, custom.system),
      sections: {
        keywords: combine(base.sections?.keywords, custom.sections?.keywords),
        brief: combine(base.sections?.brief, custom.sections?.brief),
        summary: combine(base.sections?.summary, custom.sections?.summary)
      }
    };
  } catch (err) {
    console.error('Failed to load combined prompts', err);
    // Fallback to base or empty
    return {};
  }
});

ipcMain.handle('file:read', (_event, filePath) => {
  try {
    return fs.readFileSync(filePath);
  } catch (err) {
    console.error(`Failed to read file: ${filePath}`, err);
    throw err;
  }
});

ipcMain.handle('pdf:cache:read', (_event, pdfPath) => {
  if (!pdfPath) return null;
  try {
    const cachePath = getPdfCachePath(pdfPath);
    if (!fs.existsSync(cachePath)) return null;
    return fs.readFileSync(cachePath);
  } catch (err) {
    console.error(`Failed to read cached PDF: ${pdfPath}`, err);
    return null;
  }
});

ipcMain.handle('pdf:cache:write', (_event, { pdfPath, data }) => {
  if (!pdfPath || !data) return false;
  try {
    const cachePath = getPdfCachePath(pdfPath);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    fs.writeFileSync(cachePath, buffer);
    return true;
  } catch (err) {
    console.error(`Failed to write cached PDF: ${pdfPath}`, err);
    return false;
  }
});

ipcMain.handle('dialog:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  if (canceled) return null;
  return filePaths[0];
});

let settingsWin = null;
ipcMain.on('window:settings:open', () => {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 600,
    height: 800,
    title: 'Settings',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => {
    settingsWin = null;
  });
});

ipcMain.handle('app:get-path', () => app.getPath('userData'));

ipcMain.handle('data:read-index', () => {
  try {
    const userDataPath = app.getPath('userData');
    const indexPath = path.join(userDataPath, 'sunshade-index.json');
    const docsPath = path.join(userDataPath, 'sunshade-docs.json'); // Legacy file
    const contentDir = path.join(userDataPath, 'doc-contents');

    // 1. Migration block (Old single file -> Split structure)
    if (!fs.existsSync(indexPath) && fs.existsSync(docsPath)) {
      console.log('Starting migration from single docs.json to split index/content structure...');
      try {
        const oldData = JSON.parse(fs.readFileSync(docsPath, 'utf-8'));
        const newIndex = {};
        
        if (!fs.existsSync(contentDir)) {
          fs.mkdirSync(contentDir, { recursive: true });
        }

        for (const [key, doc] of Object.entries(oldData)) {
          // Extract heavy content
          const { extractedText, analysis, highlights, chatHistory, ...meta } = doc;
          
          // Generate a safe hash for filename
          const fileHash = crypto.createHash('sha256').update(key).digest('hex');
          const contentFilePath = path.join(contentDir, `${fileHash}.json`);
          
          // Save heavy content separately
          fs.writeFileSync(contentFilePath, JSON.stringify({ extractedText, analysis, highlights, chatHistory }, null, 2), 'utf-8');
          
          // Save lightweight meta to index
          newIndex[key] = { ...meta, contentHash: fileHash };
        }
        
        // Save the new index
        fs.writeFileSync(indexPath, JSON.stringify(newIndex, null, 2), 'utf-8');
        console.log('Migration complete. Renaming old sunshade-docs.json to .bak');
        fs.renameSync(docsPath, `${docsPath}.bak`); // Backup old file

        return JSON.stringify(newIndex);
      } catch (err) {
        console.error('Migration failed:', err);
      }
    }

    // 2. Normal read flow
    if (!fs.existsSync(indexPath)) return null;
    return fs.readFileSync(indexPath, 'utf-8');
  } catch (err) {
    console.error('Failed to read index file', err);
    return null;
  }
});

ipcMain.handle('data:write-index', (_event, content) => {
  try {
    const indexPath = path.join(app.getPath('userData'), 'sunshade-index.json');
    fs.writeFileSync(indexPath, content, 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to write index file', err);
    throw err;
  }
});

ipcMain.handle('data:read-content', (_event, hash) => {
  try {
    const contentPath = path.join(app.getPath('userData'), 'doc-contents', `${hash}.json`);
    if (!fs.existsSync(contentPath)) return null;
    return fs.readFileSync(contentPath, 'utf-8');
  } catch (err) {
    console.error(`Failed to read content file [${hash}]`, err);
    return null;
  }
});

ipcMain.handle('data:write-content', (_event, hash, content) => {
  try {
    const contentDir = path.join(app.getPath('userData'), 'doc-contents');
    if (!fs.existsSync(contentDir)) {
      fs.mkdirSync(contentDir, { recursive: true });
    }
    const contentPath = path.join(contentDir, `${hash}.json`);
    fs.writeFileSync(contentPath, content, 'utf-8');
    return true;
  } catch (err) {
    console.error(`Failed to write content file [${hash}]`, err);
    throw err;
  }
});

ipcMain.handle('data:delete-content', (_event, hash) => {
   try {
     const contentPath = path.join(app.getPath('userData'), 'doc-contents', `${hash}.json`);
     if (fs.existsSync(contentPath)) {
        fs.unlinkSync(contentPath);
     }
     return true;
   } catch (err) {
     console.error(`Failed to delete content file [${hash}]`, err);
     return false;
   }
});
