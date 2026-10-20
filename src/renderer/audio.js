// Motor de audio: toca o mesmo som em dois dispositivos de saida ao mesmo tempo.
//
// Esse e o truque que substitui a injecao de DLL que o Soundpad faz. Em vez de
// entrar no processo do Discord, a gente toca o som em DOIS lugares:
//   1. o cabo virtual (CABLE Input)  -> o Discord ouve isso como microfone
//   2. o seu fone                    -> voce tambem ouve o que disparou
//
// Cada saida e um AudioContext proprio com seu sinkId. Web Audio (em vez de
// <audio>) porque trim, fade, pausa e seek precisam de controle de buffer:
// AudioBufferSourceNode.start(when, offset, duration) da o corte de graca, e
// um GainNode com rampa da o fade.

const contexts = { mic: null, monitor: null };
const buffers = new Map(); // path -> AudioBuffer (compartilhado entre contextos)
const peaks = new Map();   // path -> pico absoluto, para o normalizar
const voices = new Set();
const listeners = new Set();
const endListeners = new Set();

function notify() {
  for (const fn of listeners) fn(engine.playingCount, engine.current);
}

/** Um AudioContext por dispositivo de saida; recriado se o device mudar. */
async function contextFor(role, deviceId) {
  const existing = contexts[role];
  if (existing && existing.deviceId === deviceId && existing.ctx.state !== 'closed') {
    if (existing.ctx.state === 'suspended') await existing.ctx.resume();
    return existing.ctx;
  }
  if (existing) existing.ctx.close().catch(() => {});

  let ctx;
  try {
    ctx = deviceId ? new AudioContext({ sinkId: deviceId }) : new AudioContext();
  } catch {
    // sinkId no construtor e recente; se faltar, cai na saida padrao
    ctx = new AudioContext();
  }
  contexts[role] = { ctx, deviceId };
  return ctx;
}

async function bufferFor(path, ctx) {
  if (buffers.has(path)) return buffers.get(path);

  // Os bytes vem do processo principal: fetch() nao aceita file:// no Chromium.
  const bytes = await window.frog.readFile(path);
  const buffer = await ctx.decodeAudioData(bytes);
  buffers.set(path, buffer);

  // Pico absoluto para o "normalizar": medido uma vez, reaproveitado sempre.
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i += 1) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
  }
  peaks.set(path, peak || 1);
  return buffer;
}

/** Janela efetiva do som depois do trim, em segundos. */
function windowOf(sound, duration) {
  const start = Math.max(0, Math.min(sound.trimStart ?? 0, duration));
  const endRaw = sound.trimEnd ?? 0;
  const end = endRaw > 0 ? Math.min(endRaw, duration) : duration;
  return { start, length: Math.max(0.01, end - start) };
}

/**
 * Uma reproducao. Guarda um source por saida para que pausa, seek e stop
 * valham para as duas ao mesmo tempo.
 */
class Voice {
  constructor(sound, buffer) {
    this.sound = sound;
    this.buffer = buffer;
    this.parts = [];
    this.offset = 0;       // posicao dentro da janela, em segundos
    this.startedAt = 0;    // timestamp do contexto quando comecou
    this.paused = false;
    this.window = windowOf(sound, buffer.duration);
  }

  get duration() {
    return this.window.length;
  }

  get position() {
    if (this.paused || !this.parts.length) return this.offset;
    const ctx = this.parts[0].ctx;
    return Math.min(this.duration, this.offset + (ctx.currentTime - this.startedAt));
  }

  /** Monta source + gain em cada contexto e dispara os dois no mesmo instante. */
  async spawn(outputs) {
    this.parts = [];
    const sound = this.sound;
    const base = (sound.volume ?? 1)
      * (sound.normalize ? 1 / (peaks.get(sound.path) ?? 1) : 1);

    for (const { ctx, gain: outGain } of outputs) {
      const source = ctx.createBufferSource();
      source.buffer = this.buffer;

      const gainNode = ctx.createGain();
      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      const level = base * outGain;
      const when = ctx.currentTime + 0.02; // folga para os dois saírem juntos
      const remaining = this.duration - this.offset;

      // Fade in: so vale quando o som comeca do inicio da janela.
      const fadeIn = this.offset <= 0.001 ? Math.min(sound.fadeIn ?? 0, remaining) : 0;
      if (fadeIn > 0) {
        gainNode.gain.setValueAtTime(0.0001, when);
        gainNode.gain.exponentialRampToValueAtTime(Math.max(level, 0.0002), when + fadeIn);
      } else {
        gainNode.gain.setValueAtTime(level, when);
      }

      const fadeOut = Math.min(sound.fadeOut ?? 0, remaining - fadeIn);
      if (fadeOut > 0) {
        const fadeAt = when + remaining - fadeOut;
        gainNode.gain.setValueAtTime(Math.max(level, 0.0002), fadeAt);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, when + remaining);
      }

      source.start(when, this.window.start + this.offset, remaining);
      this.parts.push({ ctx, source, gainNode, level });
      this.startedAt = when;
    }

    // O fim de qualquer uma das saidas encerra a voz inteira. So o fim
    // natural avisa os ouvintes -- parar na mao nao encadeia o proximo.
    const [first] = this.parts;
    if (first) {
      first.source.onended = () => {
        if (this.paused) return;
        this.stop();
        for (const fn of endListeners) fn(this);
      };
    }
  }

  stopSources() {
    for (const part of this.parts) {
      part.source.onended = null;
      try { part.source.stop(); } catch { /* ja parou */ }
      part.source.disconnect();
      part.gainNode.disconnect();
    }
    this.parts = [];
  }

  pause() {
    if (this.paused || !this.parts.length) return;
    this.offset = this.position;
    this.paused = true;
    this.stopSources();
    notify();
  }

  async resume(outputs) {
    if (!this.paused) return;
    this.paused = false;
    await this.spawn(outputs);
    notify();
  }

  async seek(seconds, outputs) {
    this.offset = Math.max(0, Math.min(seconds, this.duration - 0.05));
    const wasPlaying = !this.paused;
    this.stopSources();
    if (wasPlaying) await this.spawn(outputs);
    notify();
  }

  stop() {
    this.stopSources();
    voices.delete(this);
    if (engine.current === this) engine.current = null;
    notify();
  }
}

export const engine = {
  current: null, // ultima voz disparada, a que a barra de reproducao controla

  onChange(fn) {
    listeners.add(fn);
  },

  /** Avisado quando um som termina sozinho (nao quando e parado). */
  onEnded(fn) {
    endListeners.add(fn);
  },

  get playingCount() {
    return voices.size;
  },

  /** Saidas ativas conforme o destino escolhido ('both' | 'mic' | 'monitor'). */
  async outputsFor(settings, override) {
    const target = override ?? settings.playTarget ?? 'both';
    const wanted = [];

    if (target !== 'monitor' && settings.micDeviceId) {
      wanted.push({
        ctx: await contextFor('mic', settings.micDeviceId),
        gain: settings.masterVolume,
      });
    }
    if (target !== 'mic') {
      wanted.push({
        ctx: await contextFor('monitor', settings.monitorDeviceId),
        gain: settings.masterVolume * settings.monitorVolume,
      });
    }
    return wanted;
  },

  async play(sound, settings, override) {
    const outputs = await this.outputsFor(settings, override);
    if (!outputs.length) return null;

    const buffer = await bufferFor(sound.path, outputs[0].ctx);
    const voice = new Voice(sound, buffer);
    voices.add(voice);
    this.current = voice;
    await voice.spawn(outputs);
    notify();
    return voice;
  },

  async togglePause(settings) {
    const voice = this.current;
    if (!voice) return;
    if (voice.paused) await voice.resume(await this.outputsFor(settings));
    else voice.pause();
  },

  async seek(seconds, settings) {
    if (this.current) await this.current.seek(seconds, await this.outputsFor(settings));
  },

  stopAll() {
    for (const voice of [...voices]) voice.stop();
    this.current = null;
    notify();
  },

  /** Esquece o buffer de um arquivo (usar quando o som sai da biblioteca). */
  forget(path) {
    buffers.delete(path);
    peaks.delete(path);
  },

  /** Buffer decodificado, para o editor desenhar a forma de onda. */
  async bufferOf(sound, settings) {
    const ctx = await contextFor('monitor', settings.monitorDeviceId);
    return bufferFor(sound.path, ctx);
  },

  /** Duracao bruta do arquivo, para o editor dimensionar os cortes. */
  async durationOf(sound, settings) {
    const buffer = await this.bufferOf(sound, settings);
    return buffer.duration;
  },
};
