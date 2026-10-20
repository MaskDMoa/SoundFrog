// Text-to-speech via SAPI do Windows.
//
// A Web Speech API do Chromium toca direto na saida padrao e nao aceita
// sinkId, entao nao daria para mandar a fala ao cabo virtual. Aqui o SAPI
// sintetiza para um .wav e o renderer toca esse arquivo pelo motor normal --
// com isso a fala sai no microfone e no fone, igual a qualquer outro som.

const { app } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TTS_DIR = path.join(app.getPath('userData'), 'tts');

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.trim() || err.message));
        else resolve(stdout);
      },
    );
  });
}

let cachedVoices = null;

async function listVoices() {
  if (cachedVoices) return cachedVoices;
  try {
    const out = await runPowerShell(
      "Add-Type -AssemblyName System.Speech; " +
      "(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() " +
      "| Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name }",
    );
    cachedVoices = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    console.warn('[soundFrog] nao deu para listar vozes do SAPI:', err.message);
    cachedVoices = [];
  }
  return cachedVoices;
}

/**
 * Sintetiza e devolve o caminho do .wav.
 * @param {{text: string, voice?: string, rate?: number, volume?: number}} options
 */
async function speak({ text, voice = '', rate = 0, volume = 100 }) {
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('Nada para falar.');
  if (clean.length > 2000) throw new Error('Texto longo demais (limite 2000 caracteres).');

  fs.mkdirSync(TTS_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const textFile = path.join(TTS_DIR, `${id}.txt`);
  const wavFile = path.join(TTS_DIR, `${id}.wav`);

  // O texto vai por arquivo, nunca interpolado no script: aspas e caracteres
  // de controle digitados pelo usuario nao viram comando de shell.
  fs.writeFileSync(textFile, clean, 'utf8');

  const voices = await listVoices();
  const chosen = voices.includes(voice) ? voice : '';
  const safeRate = Math.max(-10, Math.min(10, Math.round(Number(rate) || 0)));
  const safeVolume = Math.max(0, Math.min(100, Math.round(Number(volume) || 100)));

  // Os caminhos sao nossos (UUID dentro de userData), mas escapamos a aspa
  // simples mesmo assim porque userData carrega o nome do usuario.
  const q = (value) => `'${String(value).replace(/'/g, "''")}'`;

  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    chosen ? `$s.SelectVoice(${q(chosen)})` : '',
    `$s.Rate = ${safeRate}`,
    `$s.Volume = ${safeVolume}`,
    `$s.SetOutputToWaveFile(${q(wavFile)})`,
    `$s.Speak([System.IO.File]::ReadAllText(${q(textFile)}, [System.Text.Encoding]::UTF8))`,
    '$s.Dispose()',
  ].filter(Boolean).join('; ');

  try {
    await runPowerShell(script);
  } finally {
    fs.rm(textFile, { force: true }, () => {});
  }

  if (!fs.existsSync(wavFile) || fs.statSync(wavFile).size < 128) {
    throw new Error('O SAPI nao gerou audio. Verifique se ha uma voz instalada.');
  }
  return wavFile;
}

module.exports = { listVoices, speak, dir: TTS_DIR };
