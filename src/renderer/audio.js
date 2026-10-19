// Motor de audio: toca o mesmo som em dois dispositivos de saida ao mesmo tempo.
//
// Esse e o truque que substitui a injecao de DLL que o Soundpad faz. Em vez de
// entrar no processo do Discord, a gente toca o som em DOIS lugares:
//   1. o cabo virtual (CABLE Input)  -> o Discord ouve isso como microfone
//   2. o seu fone                    -> voce tambem ouve o que disparou
// Cada saida e um <audio> proprio com setSinkId apontando pro device escolhido.

const active = new Set();
const listeners = new Set();

function notify() {
  for (const fn of listeners) fn(active.size);
}

function makeOutput(url, deviceId, volume) {
  const el = new Audio(url);
  el.volume = Math.max(0, Math.min(1, volume));
  el.preload = 'auto';
  if (deviceId && typeof el.setSinkId === 'function') {
    // setSinkId e assincrono: resolvemos antes do play pra nao escapar som
    // pelo dispositivo padrao no primeiro disparo.
    return el.setSinkId(deviceId).then(() => el).catch((err) => {
      console.warn('[soundFrog] setSinkId falhou, usando saida padrao:', err.message);
      return el;
    });
  }
  return Promise.resolve(el);
}

function track(el) {
  active.add(el);
  const done = () => {
    active.delete(el);
    el.removeEventListener('ended', done);
    el.removeEventListener('error', done);
    notify();
  };
  el.addEventListener('ended', done);
  el.addEventListener('error', done);
  notify();
}

export const engine = {
  onActiveChange(fn) {
    listeners.add(fn);
  },

  get activeCount() {
    return active.size;
  },

  /**
   * @param {{path: string, volume: number}} sound
   * @param {{micDeviceId: string, monitorDeviceId: string, masterVolume: number, monitorVolume: number}} settings
   * @param {{toMic?: boolean, toMonitor?: boolean}} targets
   */
  async play(sound, settings, targets = {}) {
    const { toMic = true, toMonitor = true } = targets;
    const url = window.frog.toFileUrl(sound.path);
    const gain = (sound.volume ?? 1) * settings.masterVolume;

    const wanted = [];
    if (toMic) wanted.push(makeOutput(url, settings.micDeviceId, gain));
    if (toMonitor) {
      wanted.push(makeOutput(url, settings.monitorDeviceId, gain * settings.monitorVolume));
    }

    const elements = await Promise.all(wanted);
    // Dispara os dois no mesmo tick pra que fone e microfone fiquem em fase.
    await Promise.all(elements.map((el) => {
      track(el);
      return el.play().catch((err) => {
        console.warn('[soundFrog] nao deu pra tocar:', err.message);
        active.delete(el);
        notify();
      });
    }));
  },

  stopAll() {
    for (const el of active) {
      el.pause();
      el.currentTime = 0;
      el.src = '';
    }
    active.clear();
    notify();
  },
};
