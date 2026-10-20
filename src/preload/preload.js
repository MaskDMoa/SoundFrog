const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('node:url');

// Superficie minima exposta ao renderer. Nada de require/fs do lado da UI.
contextBridge.exposeInMainWorld('frog', {
  getState: () => ipcRenderer.invoke('state:get'),
  patchState: (partial) => ipcRenderer.invoke('state:patch', partial),

  addFiles: () => ipcRenderer.invoke('sounds:addFiles'),
  addFolder: () => ipcRenderer.invoke('sounds:addFolder'),
  removeSound: (id) => ipcRenderer.invoke('sounds:remove', id),
  updateSound: (id, patch) => ipcRenderer.invoke('sounds:update', { id, patch }),
  revealSound: (id) => ipcRenderer.invoke('sounds:reveal', id),

  setCategories: (list) => ipcRenderer.invoke('categories:set', list),

  played: (id, duration) => ipcRenderer.invoke('sounds:played', { id, duration }),
  setDuration: (id, duration) => ipcRenderer.invoke('sounds:setDuration', { id, duration }),
  resetStats: () => ipcRenderer.invoke('stats:reset'),
  findDead: () => ipcRenderer.invoke('sounds:findDead'),
  removeMany: (ids) => ipcRenderer.invoke('sounds:removeMany', ids),
  shuffle: () => ipcRenderer.invoke('sounds:shuffle'),

  assignSlot: (page, slot, soundId) => ipcRenderer.invoke('pages:assign', { page, slot, soundId }),
  autoAssign: () => ipcRenderer.invoke('pages:autoAssign'),
  clearPage: (page) => ipcRenderer.invoke('pages:clearPage', page),

  ttsVoices: () => ipcRenderer.invoke('tts:voices'),
  ttsSpeak: (options) => ipcRenderer.invoke('tts:speak', options),
  ttsSave: (options) => ipcRenderer.invoke('tts:save', options),

  saveRecording: (buffer, suggestedName) =>
    ipcRenderer.invoke('recording:save', { buffer, suggestedName }),

  // Caminho do Windows -> URL que o <audio> aceita (acentos, espacos, '#').
  toFileUrl: (filePath) => pathToFileURL(filePath).href,

  // Bytes crus de um arquivo local, para o Web Audio decodificar.
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),

  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  hotkeyList: () => ipcRenderer.invoke('app:hotkeyList'),

  onHotkey: (handler) => {
    ipcRenderer.on('hotkey', (_event, payload) => handler(payload));
  },
});
