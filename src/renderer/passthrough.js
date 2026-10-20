// Passagem de voz: joga seu microfone real dentro do mesmo cabo virtual para
// onde os sons vao, ao vivo.
//
// Sem isso o Discord ouve so os sons, e voce precisaria do VoiceMeeter para
// somar sua voz. O Soundpad nao tem esse problema porque injeta no processo do
// app de voz, deixando o microfone original intacto. Aqui a soma e nossa:
//
//   microfone real --> [ganho] --> AudioContext(sinkId = CABLE Input)
//
// Os sons disparados entram no mesmo dispositivo por outro contexto, e o
// Windows mistura os dois no cabo.

let stream = null;
let ctx = null;
let source = null;
let gainNode = null;
let active = { deviceId: '', outputId: '' };

export const passthrough = {
  get running() {
    return Boolean(ctx);
  },

  /**
   * @param {{deviceId: string, gain: number, noiseSuppression: boolean}} config
   * @param {string} outputId dispositivo de saida (o cabo virtual)
   */
  async start(config, outputId) {
    await this.stop();

    if (!outputId) {
      throw new Error('Escolha primeiro para onde vai o microfone (o cabo virtual).');
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: config.deviceId ? { exact: config.deviceId } : undefined,
        // Cancelamento de eco compara a entrada com o que SAI do dispositivo
        // padrao. Como a saida aqui e o cabo, ele tentaria cancelar os proprios
        // sons do soundboard e deixaria a voz oca. Fica desligado.
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: config.noiseSuppression,
      },
      video: false,
    });

    try {
      ctx = new AudioContext({ sinkId: outputId, latencyHint: 'interactive' });
    } catch {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      console.warn('[soundFrog] sinkId no AudioContext nao suportado; voz vai pra saida padrao');
    }

    source = ctx.createMediaStreamSource(stream);
    gainNode = ctx.createGain();
    gainNode.gain.value = config.gain ?? 1;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    active = { deviceId: config.deviceId, outputId };

    // Se o microfone sumir (desconectou o fone, por exemplo), nao fica um
    // contexto morto segurando o dispositivo.
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => this.stop());
    }
  },

  setGain(value) {
    if (gainNode) gainNode.gain.value = value;
  },

  /** Precisa reabrir se o microfone ou o destino mudaram. */
  needsRestart(config, outputId) {
    return active.deviceId !== config.deviceId || active.outputId !== outputId;
  },

  async stop() {
    if (stream) for (const track of stream.getTracks()) track.stop();
    if (ctx) await ctx.close().catch(() => {});
    stream = null;
    ctx = null;
    source = null;
    gainNode = null;
    active = { deviceId: '', outputId: '' };
  },
};
