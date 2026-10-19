const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, session, desktopCapturer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const store = require('./store');
const hotkeys = require('./hotkeys');

const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.aac', '.flac', '.opus', '.webm']);
const RECORDINGS_DIR = path.join(app.getPath('userData'), 'recordings');

let win = null;
let tray = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#11150f',
    title: 'soundFrog',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    // Barra de titulo propria: so os botoes de janela ficam nativos, pintados
    // na cor do tema. O resto da faixa e nossa, com a logo.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#121a0f',
      symbolColor: '#8d9c7c',
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });

  // Fecha para a tray em vez de encerrar: soundboard serve pra ficar em segundo plano.
  win.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    win.hide();
  });

  // Links externos abrem no navegador, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  if (!fs.existsSync(iconPath)) return;
  tray = new Tray(iconPath);
  tray.setToolTip('soundFrog');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir soundFrog', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => { win.show(); win.focus(); });
}

function grantMediaPermissions() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture');
  });

  // Sem isso o enumerateDevices nao devolve os ids reais dos dispositivos de
  // saida, e o setSinkId (o coracao da saida dupla) nao tem pra onde apontar.
  ses.setDevicePermissionHandler(() => true);

  // Captura do audio do sistema (o "gravar alto-falantes" do Soundpad).
  // 'loopback' entrega o mix do Windows sem precisar de cabo virtual.
  //
  // Entregamos tambem uma fonte de video: o Chromium costuma recusar um
  // getDisplayMedia sem video, e o renderer tem um fallback que pede
  // {audio, video} e descarta a trilha de video em seguida. Sem uma fonte
  // aqui, esse fallback morreria.
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      callback({ video: sources[0], audio: 'loopback' });
    } catch {
      callback({ audio: 'loopback' });
    }
  }, { useSystemPicker: false });
}

function makeSound(filePath, name) {
  return {
    id: crypto.randomUUID(),
    name: name ?? path.basename(filePath, path.extname(filePath)),
    path: filePath,
    volume: 1,
    addedAt: Date.now(),
  };
}

function collectAudioFiles(dir, depth = 0) {
  if (depth > 4) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectAudioFiles(full, depth + 1));
    else if (AUDIO_EXT.has(path.extname(entry.name).toLowerCase())) found.push(full);
  }
  return found;
}

function addPaths(paths) {
  const state = store.get();
  const known = new Set(state.sounds.map((s) => s.path.toLowerCase()));
  const fresh = paths
    .filter((p) => !known.has(p.toLowerCase()))
    .map((p) => makeSound(p));
  if (fresh.length) {
    state.sounds.push(...fresh);
    store.save();
  }
  return { added: fresh.length, skipped: paths.length - fresh.length, state: store.get() };
}

app.whenReady().then(() => {
  store.load();
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  grantMediaPermissions();
  createWindow();
  createTray();

  hotkeys.init((payload) => win?.webContents.send('hotkey', payload));
  hotkeys.apply(store.get().settings);
});

app.on('will-quit', () => hotkeys.unregisterAll());
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* ---------------------------------------------------------------- IPC ---- */

ipcMain.handle('state:get', () => store.get());

ipcMain.handle('state:patch', (_e, partial) => {
  const next = store.patch(partial);
  if (partial.settings) hotkeys.apply(next.settings);
  return next;
});

ipcMain.handle('sounds:addFiles', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Adicionar sons',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: [...AUDIO_EXT].map((e) => e.slice(1)) }],
  });
  if (result.canceled) return { added: 0, skipped: 0, state: store.get() };
  return addPaths(result.filePaths);
});

ipcMain.handle('sounds:addFolder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Importar pasta de sons',
    properties: ['openDirectory'],
  });
  if (result.canceled) return { added: 0, skipped: 0, state: store.get() };
  return addPaths(collectAudioFiles(result.filePaths[0]));
});

ipcMain.handle('sounds:remove', (_e, id) => {
  const state = store.get();
  state.sounds = state.sounds.filter((s) => s.id !== id);
  state.pages = state.pages.map((page) => page.map((slot) => (slot === id ? null : slot)));
  store.save();
  return store.get();
});

ipcMain.handle('sounds:rename', (_e, { id, name }) => {
  const sound = store.get().sounds.find((s) => s.id === id);
  if (sound) {
    sound.name = name;
    store.save();
  }
  return store.get();
});

ipcMain.handle('sounds:setVolume', (_e, { id, volume }) => {
  const sound = store.get().sounds.find((s) => s.id === id);
  if (sound) {
    sound.volume = Math.max(0, Math.min(2, volume));
    store.save();
  }
  return store.get();
});

ipcMain.handle('sounds:reveal', (_e, id) => {
  const sound = store.get().sounds.find((s) => s.id === id);
  if (sound) shell.showItemInFolder(sound.path);
});

ipcMain.handle('pages:assign', (_e, { page, slot, soundId }) => {
  const state = store.get();
  if (state.pages[page]) {
    state.pages[page][slot] = soundId;
    store.save();
  }
  return store.get();
});

ipcMain.handle('recording:save', (_e, { buffer, suggestedName }) => {
  const safe = (suggestedName || 'gravacao').replace(/[\/:*?"<>|]/g, '_');
  const file = path.join(RECORDINGS_DIR, `${safe}-${Date.now()}.webm`);
  fs.writeFileSync(file, Buffer.from(buffer));
  return addPaths([file]);
});

ipcMain.handle('app:openDataFolder', () => shell.openPath(app.getPath('userData')));
ipcMain.handle('app:hotkeyList', () => hotkeys.list());
