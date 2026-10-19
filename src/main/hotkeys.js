const { globalShortcut } = require('electron');

// Mantem o registro das hotkeys globais e avisa o renderer quando uma dispara.
// Os slots sao posicionais (F1 toca o slot 1 da pagina ativa), igual ao hotbar
// do Soundpad -- a hotkey nao pertence ao som, pertence ao slot.
let send = () => {};
let registered = [];

function unregisterAll() {
  for (const accel of registered) globalShortcut.unregister(accel);
  registered = [];
}

function bind(accel, payload) {
  if (!accel) return;
  if (registered.includes(accel)) return;
  try {
    const ok = globalShortcut.register(accel, () => send(payload));
    if (ok) registered.push(accel);
    else console.warn(`[soundFrog] hotkey recusada pelo sistema: ${accel}`);
  } catch (err) {
    console.warn(`[soundFrog] hotkey invalida: ${accel} (${err.message})`);
  }
}

function apply(settings) {
  unregisterAll();
  if (!settings.hotkeysEnabled) return registered.slice();

  settings.slotHotkeys.forEach((accel, index) => {
    bind(accel, { type: 'slot', slot: index });
  });

  if (settings.pageHotkeyPrefix) {
    for (let page = 0; page < 9; page += 1) {
      bind(`${settings.pageHotkeyPrefix}+${page + 1}`, { type: 'page', page });
    }
  }

  bind(settings.stopAllHotkey, { type: 'stopAll' });
  return registered.slice();
}

module.exports = {
  init(sender) {
    send = sender;
  },
  apply,
  unregisterAll,
  list: () => registered.slice(),
};
