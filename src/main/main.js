const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, session, desktopCapturer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const store = require('./store');
const hotkeys = require('./hotkeys');
const tts = require('./tts');
const cable = require('./cable');

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
    ...store.SOUND_DEFAULTS,
    id: crypto.randomUUID(),
    name: name ?? path.basename(filePath, path.extname(filePath)),
    path: filePath,
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

// Campos do editor que o renderer pode alterar, com o saneamento de cada um.
const SOUND_FIELDS = {
  name: (v) => String(v).slice(0, 120),
  volume: (v) => Math.max(0, Math.min(2, Number(v) || 0)),
  trimStart: (v) => Math.max(0, Number(v) || 0),
  trimEnd: (v) => Math.max(0, Number(v) || 0),
  fadeIn: (v) => Math.max(0, Math.min(30, Number(v) || 0)),
  fadeOut: (v) => Math.max(0, Math.min(30, Number(v) || 0)),
  normalize: (v) => Boolean(v),
  category: (v) => String(v).slice(0, 60),
};

ipcMain.handle('sounds:update', (_e, { id, patch }) => {
  const sound = store.get().sounds.find((s) => s.id === id);
  if (sound) {
    for (const [key, raw] of Object.entries(patch ?? {})) {
      if (key in SOUND_FIELDS) sound[key] = SOUND_FIELDS[key](raw);
    }
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

// Estatistica de reproducao, como a coluna "Reproduzir contagem" do Soundpad.
ipcMain.handle('sounds:played', (_e, { id, duration }) => {
  const sound = store.get().sounds.find((s) => s.id === id);
  if (!sound) return null;
  sound.playCount = (sound.playCount ?? 0) + 1;
  if (duration && !sound.duration) sound.duration = duration;
  store.save();
  return { playCount: sound.playCount, duration: sound.duration };
});

ipcMain.handle('sounds:setDuration', (_e, { id, duration }) => {
  const sound = store.get().sounds.find((s) => s.id === id);
  if (sound && duration && !sound.duration) {
    sound.duration = duration;
    store.save();
  }
  return null;
});

ipcMain.handle('stats:reset', () => {
  for (const sound of store.get().sounds) sound.playCount = 0;
  store.save();
  return store.get();
});

// "Encontrar registros inoperantes": a biblioteca guarda caminhos, entao um
// arquivo movido ou apagado vira uma entrada morta.
ipcMain.handle('sounds:findDead', () => {
  const dead = store.get().sounds
    .filter((s) => !fs.existsSync(s.path))
    .map((s) => s.id);
  return dead;
});

ipcMain.handle('sounds:removeMany', (_e, ids) => {
  const set = new Set(ids ?? []);
  const state = store.get();
  state.sounds = state.sounds.filter((s) => !set.has(s.id));
  state.pages = state.pages.map((page) => page.map((slot) => (set.has(slot) ? null : slot)));
  store.save();
  return store.get();
});

ipcMain.handle('sounds:shuffle', () => {
  const list = store.get().sounds;
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  store.save();
  return store.get();
});

ipcMain.handle('categories:set', (_e, list) => {
  const state = store.get();
  state.categories = [...new Set((list ?? []).map((c) => String(c).slice(0, 60)).filter(Boolean))];
  store.save();
  return store.get();
});

// Auto-keys: preenche os slots vazios, pagina por pagina, com os sons que
// ainda nao estao em lugar nenhum. E o equivalente ao auto-keys do Soundpad.
ipcMain.handle('pages:autoAssign', () => {
  const state = store.get();
  const used = new Set(state.pages.flat().filter(Boolean));
  const queue = state.sounds
    .filter((s) => !used.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  let placed = 0;
  for (const page of state.pages) {
    for (let slot = 0; slot < page.length; slot += 1) {
      if (page[slot] || !queue.length) continue;
      page[slot] = queue.shift().id;
      placed += 1;
    }
  }
  store.save();
  return { placed, remaining: queue.length, state: store.get() };
});

ipcMain.handle('pages:clearPage', (_e, page) => {
  const state = store.get();
  if (state.pages[page]) {
    state.pages[page] = state.pages[page].map(() => null);
    store.save();
  }
  return store.get();
});

ipcMain.handle('tts:voices', () => tts.listVoices());

ipcMain.handle('tts:speak', async (_e, options) => {
  const wav = await tts.speak(options);
  return { path: wav };
});

// Guarda a fala na biblioteca, batizada com o inicio do proprio texto.
ipcMain.handle('tts:save', async (_e, options) => {
  const wav = await tts.speak(options);
  const result = addPaths([wav]);
  const created = store.get().sounds.find((s) => s.path === wav);
  if (created) {
    created.name = String(options.text ?? '').trim().slice(0, 40) || 'fala';
    created.category = 'Fala';
    store.save();
  }
  return { ...result, state: store.get() };
});

// O renderer nao consegue ler file:// com fetch (o Chromium recusa o esquema,
// independente de CSP), entao os bytes para decodificar vem por aqui.
ipcMain.handle('file:read', async (_e, filePath) => {
  const buffer = await fs.promises.readFile(filePath);
  // Devolve o ArrayBuffer exato, sem o resto do pool do Buffer do Node.
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
});

// So abrimos links https que nos mesmos indicamos; nada vindo da lista.
const ALLOWED_LINKS = new Set([
  'https://vb-audio.com/Cable/',
  'https://vb-audio.com/Services/licensing.htm',
]);

ipcMain.handle('cable:install', async () => {
  await cable.install();
  return { ok: true };
});

ipcMain.handle('app:openExternal', (_e, url) => {
  if (ALLOWED_LINKS.has(url)) shell.openExternal(url);
});

ipcMain.handle('app:openDataFolder', () => shell.openPath(app.getPath('userData')));
ipcMain.handle('app:hotkeyList', () => hotkeys.list());
