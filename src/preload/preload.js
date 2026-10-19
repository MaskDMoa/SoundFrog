const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('node:url');

// Superficie minima exposta ao renderer. Nada de require/fs do lado da UI.
contextBridge.exposeInMainWorld('frog', {
  getState: () => ipcRenderer.invoke('state:get'),
  patchState: (partial) => ipcRenderer.invoke('state:patch', partial),

  addFiles: () => ipcRenderer.invoke('sounds:addFiles'),
  addFolder: () => ipcRenderer.invoke('sounds:addFolder'),
  removeSound: (id) => ipcRenderer.invoke('sounds:remove', id),
  renameSound: (id, name) => ipcRenderer.invoke('sounds:rename', { id, name }),
  setSoundVolume: (id, volume) => ipcRenderer.invoke('sounds:setVolume', { id, volume }),
  revealSound: (id) => ipcRenderer.invoke('sounds:reveal', id),

  assignSlot: (page, slot, soundId) => ipcRenderer.invoke('pages:assign', { page, slot, soundId }),

  saveRecording: (buffer, suggestedName) =>
    ipcRenderer.invoke('recording:save', { buffer, suggestedName }),

  // Caminho do Windows -> URL que o <audio> aceita (acentos, espacos, '#').
  toFileUrl: (filePath) => pathToFileURL(filePath).href,

  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  hotkeyList: () => ipcRenderer.invoke('app:hotkeyList'),

  onHotkey: (handler) => {
    ipcRenderer.on('hotkey', (_event, payload) => handler(payload));
  },
});
