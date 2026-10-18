import { app, BrowserWindow, ipcMain, systemPreferences } from 'electron';
import { execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseSayVoices } from '../src/app/sayVoices';

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const smokeTest = process.argv.includes('--smoke-test');

// ---------- Native speech (macOS `say`) ----------
// Web Speech API inside Electron is unreliable (utterances hang silently),
// so speech goes through the native synthesizer instead.

let sayProcess: ChildProcess | null = null;

function killSay(): void {
  if (sayProcess) {
    try {
      sayProcess.kill();
    } catch {
      // already gone
    }
    sayProcess = null;
  }
}

function registerSpeechHandlers(): void {
  ipcMain.handle('speech:speak', (_event, opts: { text?: unknown; voice?: unknown; rate?: unknown }) => {
    if (process.platform !== 'darwin') return Promise.resolve();
    const text = typeof opts?.text === 'string' ? opts.text.slice(0, 2000) : '';
    if (!text) return Promise.resolve();
    const args: string[] = [];
    if (typeof opts.voice === 'string' && opts.voice && /^[\w .()'’-]+$/.test(opts.voice)) {
      args.push('-v', opts.voice);
    }
    const rate = Number(opts.rate);
    if (Number.isFinite(rate) && rate >= 80 && rate <= 400) {
      args.push('-r', String(Math.round(rate)));
    }
    args.push(text);
    killSay();
    return new Promise<void>((resolve) => {
      const child = execFile('/usr/bin/say', args, () => {
        if (sayProcess === child) sayProcess = null;
        resolve();
      });
      child.on('error', () => resolve());
      sayProcess = child;
    });
  });

  ipcMain.handle('speech:cancel', () => {
    killSay();
  });

  ipcMain.handle('speech:voices', () => {
    if (process.platform !== 'darwin') return Promise.resolve([]);
    return new Promise((resolve) => {
      execFile('/usr/bin/say', ['-v', '?'], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) {
          resolve([]);
          return;
        }
        resolve(parseSayVoices(String(stdout)));
      });
    });
  });
}

// ---------- Assets & camera (for the hand-tracking feature) ----------

function registerBridgeHandlers(): void {
  // Read a bundled asset from dist/ — pages loaded via file:// cannot fetch()
  // local files, so the renderer requests wasm/model bytes through IPC.
  ipcMain.handle('assets:read', async (_event, relPath: unknown) => {
    if (typeof relPath !== 'string' || relPath.length > 300) return null;
    const base = path.resolve(__dirname, '../dist');
    const target = path.resolve(base, relPath);
    if (!target.startsWith(base + path.sep)) return null; // path traversal guard
    try {
      return await fs.promises.readFile(target);
    } catch (err) {
      console.error('assets:read failed', relPath, err);
      return null;
    }
  });

  ipcMain.handle('camera:request', async () => {
    if (process.platform !== 'darwin') return true;
    try {
      return await systemPreferences.askForMediaAccess('camera');
    } catch {
      return false;
    }
  });
}

// ---------- Window ----------

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 660,
    title: 'Geometry Sound Lab',
    backgroundColor: '#fff7ee',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.webContents.on('did-finish-load', () => {
    if (smokeTest) {
      console.log('SMOKE_TEST_OK');
      setTimeout(() => app.quit(), 400);
    }
  });
}

app.whenReady().then(() => {
  registerSpeechHandlers();
  registerBridgeHandlers();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  killSay();
});
