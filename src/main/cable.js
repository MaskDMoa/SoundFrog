// Instalação do cabo de áudio virtual (VB-CABLE).
//
// Vincent Burel (VB-Audio Software) autorizou embutir o pacote VB-CABLE
// original e sem modificações, para uso estritamente NÃO COMERCIAL. Mesmo
// com a autorização, não reimplementamos nada: extraímos o zip original e
// executamos o VBCABLE_Setup da própria VB-Audio, com o UAC dela.
// Veja vendor/README.md.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PACK = 'VBCABLE_Driver_Pack45.zip';

/** vendor/ fica fora do asar: empacotado como extraResource. */
function vendorFile(name) {
  const packaged = path.join(process.resourcesPath ?? '', 'vendor', name);
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', '..', 'vendor', name); // modo dev
}

const packagePath = () => vendorFile(PACK);

// Trava de concorrência: dois cliques seguidos chegavam a rodar o instalador
// duas vezes, e o Windows criava um segundo nó de dispositivo que não sobe
// (código 10). Uma instalação por vez.
let running = null;

/**
 * Dispara o instalador oficial da VB-Audio.
 *
 * Usa o mesmo install-vbcable.ps1 que o instalador do soundFrog chama, para
 * não existirem dois caminhos divergentes fazendo a mesma coisa.
 * Resolve quando o processo termina; o usuário ainda precisa reiniciar.
 */
function install() {
  if (running) return running;

  const zip = packagePath();
  const script = vendorFile('install-vbcable.ps1');

  if (!fs.existsSync(zip) || !fs.existsSync(script)) {
    throw new Error('O pacote do VB-CABLE nao veio junto nesta instalacao.');
  }

  running = new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Zip', zip],
      { windowsHide: true, timeout: 300000 },
      (err, stdout, stderr) => {
        const code = err?.code;
        if (code === 1223) {
          reject(new Error('Instalacao cancelada na janela do Windows.'));
        } else if (err) {
          reject(new Error(stderr?.trim() || stdout?.trim() || err.message));
        } else {
          resolve({ ok: true, output: stdout.trim() });
        }
      },
    );
  }).finally(() => { running = null; });

  return running;
}

module.exports = { install, packagePath, PACK };
