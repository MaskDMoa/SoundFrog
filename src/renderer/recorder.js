// Gravacao de microfone e do audio do sistema (o "gravar alto-falantes").
//
// Nao usamos MediaRecorder de proposito. Um replay buffer real precisa jogar
// fora o audio antigo, e um .webm picado no meio nao toca -- o header fica no
// primeiro chunk. Entao mantemos um ring buffer de PCM cru e so na hora de
// salvar a gente encoda um WAV. Assim "salvar os ultimos 30s" e exatamente 30s.

const BUFFER_SIZE = 4096;

function encodeWav(channels, sampleRate) {
  const channelCount = channels.length;
  const frameCount = channels[0].length;
  const bytesPerSample = 2;
  const dataBytes = frameCount * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeText(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let ch = 0; ch < channelCount; ch += 1) {
      const clamped = Math.max(-1, Math.min(1, channels[ch][frame]));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

async function openStream(source, micDeviceId) {
  if (source === 'system') {
    // O handler de displayMedia no main devolve 'loopback': o mix do Windows.
    try {
      return await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false });
    } catch {
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
      }
      return stream;
    }
  }
  return navigator.mediaDevices.getUserMedia({
    audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
    video: false,
  });
}

export class Recorder {
  constructor() {
    this.state = 'idle'; // idle | armed
    this.source = null;
    this.ringSeconds = null;
    this.stream = null;
    this.context = null;
    this.node = null;
    this.chunks = [];
    this.frames = 0;
  }

  get armed() {
    return this.state === 'armed';
  }

  get seconds() {
    return this.context ? this.frames / this.context.sampleRate : 0;
  }

  /** @param {'mic'|'system'} source @param {number|null} ringSeconds null = cresce ate o stop */
  async arm(source, ringSeconds, micDeviceId) {
    if (this.armed) await this.disarm();

    this.stream = await openStream(source, micDeviceId);
    this.source = source;
    this.ringSeconds = ringSeconds;
    this.chunks = [];
    this.frames = 0;

    this.context = new AudioContext();
    const input = this.context.createMediaStreamSource(this.stream);
    const channelCount = Math.min(2, input.channelCount || 1);

    // ScriptProcessorNode e deprecado, mas e a via mais curta pra pegar PCM
    // cru e roda sem ressalvas dentro do nosso proprio Chromium.
    this.node = this.context.createScriptProcessor(BUFFER_SIZE, channelCount, channelCount);
    this.node.onaudioprocess = (event) => {
      const block = [];
      for (let ch = 0; ch < channelCount; ch += 1) {
        block.push(new Float32Array(event.inputBuffer.getChannelData(ch)));
      }
      this.chunks.push(block);
      this.frames += block[0].length;

      if (this.ringSeconds != null) {
        const maxFrames = this.ringSeconds * this.context.sampleRate;
        while (this.frames - this.chunks[0][0].length > maxFrames) {
          this.frames -= this.chunks.shift()[0].length;
        }
      }
    };

    input.connect(this.node);
    // Destino muted: o node precisa de um caminho ate a saida pra processar,
    // mas nao queremos ouvir (nem realimentar) o que esta sendo gravado.
    const mute = this.context.createGain();
    mute.gain.value = 0;
    this.node.connect(mute);
    mute.connect(this.context.destination);

    this.state = 'armed';
  }

  async disarm() {
    if (this.node) this.node.onaudioprocess = null;
    if (this.stream) for (const track of this.stream.getTracks()) track.stop();
    if (this.context) await this.context.close().catch(() => {});
    this.state = 'idle';
    this.stream = null;
    this.context = null;
    this.node = null;
  }

  /** Encoda o que esta no buffer como WAV. Nao para a gravacao. */
  grab() {
    if (!this.chunks.length || !this.context) return null;
    const channelCount = this.chunks[0].length;
    const sampleRate = this.context.sampleRate;
    const channels = Array.from({ length: channelCount }, () => new Float32Array(this.frames));

    let offset = 0;
    for (const block of this.chunks) {
      for (let ch = 0; ch < channelCount; ch += 1) channels[ch].set(block[ch], offset);
      offset += block[0].length;
    }
    return encodeWav(channels, sampleRate);
  }
}
