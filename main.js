const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

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
    const p = path.join(__dirname, 'src', 'llm', 'custom_prompts.json');
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load custom_prompts.json', err);
    return {};
  }
});

// Save custom prompts
ipcMain.handle('prompts:save', (_event, data) => {
  try {
    const p = path.join(__dirname, 'src', 'llm', 'custom_prompts.json');
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
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
    const customP = path.join(__dirname, 'src', 'llm', 'custom_prompts.json');
    
    const base = JSON.parse(fs.readFileSync(baseP, 'utf-8'));
    let custom = {};
    if (fs.existsSync(customP)) {
      custom = JSON.parse(fs.readFileSync(customP, 'utf-8'));
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
