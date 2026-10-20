const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(app.getPath('userData'), 'soundfrog.json');

const DEFAULTS = {
  sounds: [],
  categories: [],
  pages: Array.from({ length: 9 }, () => Array(12).fill(null)),
  settings: {
    micDeviceId: '',
    monitorDeviceId: '',
    recordMicDeviceId: '',
    masterVolume: 0.8,
    monitorVolume: 0.8,
    replaySeconds: 30,
    slotHotkeys: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
    pageHotkeyPrefix: 'Control+Alt',
    stopAllHotkey: 'Control+Alt+Escape',
    hotkeysEnabled: true,

    // Para onde cada disparo vai: 'both' | 'mic' | 'monitor'.
    playTarget: 'both',

    // Passagem de voz: manda seu microfone real para o mesmo cabo virtual,
    // para o Discord ouvir voce E os sons. E o que o Soundpad resolve
    // injetando no processo do app de voz.
    passthrough: {
      enabled: false,
      deviceId: '',
      gain: 1,
      noiseSuppression: true,
    },

    tts: {
      voice: '',
      rate: 0,       // -10..10, escala do SAPI
      volume: 100,   // 0..100
    },
  },
};

// Campos que todo som carrega. Sons salvos antes destes existirem recebem os
// defaults ao carregar, entao a biblioteca antiga continua valendo.
const SOUND_DEFAULTS = {
  volume: 1,
  trimStart: 0,
  trimEnd: 0,      // 0 = ate o fim
  fadeIn: 0,
  fadeOut: 0,
  normalize: false,
  category: '',
};

function deepMerge(base, override) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const key of Object.keys(override ?? {})) {
    out[key] = deepMerge(base[key], override[key]);
  }
  return out;
}

let state = structuredClone(DEFAULTS);

function load() {
  let existed = true;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    state = deepMerge(structuredClone(DEFAULTS), JSON.parse(raw));
  } catch {
    // primeira execucao, ou arquivo corrompido: fica nos defaults
    state = structuredClone(DEFAULTS);
    existed = false;
  }
  // garante 9 paginas com o mesmo numero de slots dos hotkeys
  const slots = state.settings.slotHotkeys.length;
  state.pages = Array.from({ length: 9 }, (_, p) => {
    const page = state.pages[p] ?? [];
    return Array.from({ length: slots }, (_, s) => page[s] ?? null);
  });
  state.sounds = state.sounds.map((sound) => ({ ...SOUND_DEFAULTS, ...sound }));
  // Grava ja na primeira execucao: assim da pra abrir o JSON e editar os
  // atalhos sem precisar mexer em nada no app antes.
  if (!existed) save();
  return state;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2), 'utf8');
}

module.exports = {
  file: FILE,
  SOUND_DEFAULTS,
  get: () => state,
  load,
  save,
  patch(partial) {
    state = deepMerge(state, partial);
    save();
    return state;
  },
  replace(next) {
    state = next;
    save();
    return state;
  },
};
