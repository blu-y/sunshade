const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const {
  signInWithOpenAI,
  ensureOpenAIConfig,
  getValidOpenAIToken,
  logoutOpenAI
} = require('./src/auth/openai');

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
