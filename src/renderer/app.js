import { engine } from './audio.js';
import { Recorder } from './recorder.js';

const frog = window.frog;
const $ = (id) => document.getElementById(id);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

let state = null;
let activePage = 0;
let filter = '';
const recorder = new Recorder();
let recMode = null; // null | 'manual' | 'buffer'
let liveHotkeys = new Set(); // as que o Windows realmente aceitou registrar

/* ------------------------------------------------------------ helpers ---- */

const soundById = (id) => state.sounds.find((s) => s.id === id) ?? null;

async function pushSettings(partial) {
  state = await frog.patchState({ settings: partial });
  await refreshLiveHotkeys();
}

async function refreshLiveHotkeys() {
  liveHotkeys = new Set(await frog.hotkeyList());
}

function setStatus(text) {
  $('recStatus').textContent = text;
}

/* ------------------------------------------------------------ devices ---- */

async function unlockDeviceLabels() {
  // Sem uma permissao de midia concedida, enumerateDevices devolve labels
  // vazias e ids anonimos -- e sem id real nao existe saida dupla.
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of probe.getTracks()) track.stop();
  } catch (err) {
    console.warn('[soundFrog] permissao de microfone negada:', err.message);
  }
}

function fillSelect(select, devices, selectedId, emptyLabel) {
  select.innerHTML = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = emptyLabel;
  select.append(blank);

  for (const device of devices) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `(dispositivo ${device.deviceId.slice(0, 6)})`;
    select.append(option);
  }
  select.value = devices.some((d) => d.deviceId === selectedId) ? selectedId : '';
}

async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default');
  const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');

  fillSelect($('micOut'), outputs, state.settings.micDeviceId, 'nenhum (so no fone)');
  fillSelect($('monitorOut'), outputs, state.settings.monitorDeviceId, 'saida padrao do Windows');
  fillSelect($('recMicIn'), inputs, state.settings.recordMicDeviceId, 'microfone padrao');

  $('devInfo').textContent = `${outputs.length} saidas - ${inputs.length} entradas`;

  // Primeira execucao: tenta achar o cabo virtual sozinho.
  if (!state.settings.micDeviceId) {
    const cable = outputs.find((d) => /cable input|voicemeeter input|virtual/i.test(d.label));
    if (cable) {
      await pushSettings({ micDeviceId: cable.deviceId });
      $('micOut').value = cable.deviceId;
      setStatus(`Cabo virtual detectado: ${cable.label}`);
    }
  }
}

/* -------------------------------------------------------------- board ---- */

function renderPages() {
  const nav = $('pages');
  nav.innerHTML = '';
  for (let page = 0; page < 9; page += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(page + 1);
    button.dataset.active = String(page === activePage);
    button.dataset.filled = String(state.pages[page].some(Boolean));
    button.title = `${state.settings.pageHotkeyPrefix}+${page + 1}`;
    button.addEventListener('click', () => {
      activePage = page;
      renderPages();
      renderGrid();
    });
    nav.append(button);
  }
}

function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  const page = state.pages[activePage];

  page.forEach((soundId, slot) => {
    const sound = soundId ? soundById(soundId) : null;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'slot';
    cell.dataset.slot = String(slot);
    cell.dataset.empty = String(!sound);

    const accel = state.settings.slotHotkeys[slot] ?? '';
    const dead = Boolean(accel) && state.settings.hotkeysEnabled && !liveHotkeys.has(accel);
    cell.dataset.dead = String(dead);
    if (dead) cell.title = `${accel} esta ocupada por outro programa`;

    cell.innerHTML = `
      <span class="label">${sound ? escapeHtml(sound.name) : 'vazio'}</span>
      <span class="key">${escapeHtml(accel)}</span>`;

    if (sound) cell.addEventListener('click', () => fire(slot));

    cell.addEventListener('contextmenu', async (event) => {
      event.preventDefault();
      state = await frog.assignSlot(activePage, slot, null);
      renderGrid();
    });

    cell.addEventListener('dragover', (event) => {
      event.preventDefault();
      cell.classList.add('drop');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
    cell.addEventListener('drop', async (event) => {
      event.preventDefault();
      cell.classList.remove('drop');
      const id = event.dataTransfer.getData('text/plain');
      if (!id) return;
      state = await frog.assignSlot(activePage, slot, id);
      renderGrid();
    });

    grid.append(cell);
  });
}

/* ------------------------------------------------------------ library ---- */

function renderList() {
  const list = $('list');
  list.innerHTML = '';
  const needle = filter.trim().toLowerCase();
  const matches = state.sounds
    .filter((s) => !needle || s.name.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  for (const sound of matches) {
    const item = document.createElement('li');
    item.draggable = true;
    item.innerHTML = `
      <span class="name" title="${escapeHtml(sound.path)}">${escapeHtml(sound.name)}</span>
      <input class="vol" type="range" min="0" max="200" value="${Math.round((sound.volume ?? 1) * 100)}"
             title="Volume deste som">
      <button class="x" type="button" title="Remover da biblioteca">&times;</button>`;

    item.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', sound.id);
    });
    item.querySelector('.name').addEventListener('dblclick', () => play(sound));
    item.querySelector('.vol').addEventListener('change', async (event) => {
      state = await frog.setSoundVolume(sound.id, Number(event.target.value) / 100);
    });
    item.querySelector('.x').addEventListener('click', async (event) => {
      event.stopPropagation();
      state = await frog.removeSound(sound.id);
      renderList();
      renderGrid();
    });

    list.append(item);
  }

  if (!matches.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = state.sounds.length
      ? 'Nenhum som com esse nome.'
      : 'Biblioteca vazia. Comece em Arquivos ou Pasta.';
    list.append(empty);
  }
}

/* ----------------------------------------------------------- playback ---- */

function play(sound) {
  engine.play(sound, state.settings, { toMic: true, toMonitor: true });
}

function fire(slot) {
  const soundId = state.pages[activePage][slot];
  const sound = soundId ? soundById(soundId) : null;
  if (!sound) return;

  play(sound);
  const cell = $('grid').querySelector(`[data-slot="${slot}"]`);
  if (cell) {
    cell.classList.remove('fired');
    void cell.offsetWidth; // reinicia a animacao se a mesma tecla repetir
    cell.classList.add('fired');
  }
}

/* ----------------------------------------------------------- gravacao ---- */

async function startRecording(mode) {
  const source = $('recSource').value;
  const ring = mode === 'buffer' ? state.settings.replaySeconds : null;
  try {
    await recorder.arm(source, ring, state.settings.recordMicDeviceId);
    recMode = mode;
    setStatus(mode === 'buffer' ? 'Buffer rodando...' : 'Gravando...');
  } catch (err) {
    setStatus(`Falhou: ${err.message}`);
    recMode = null;
  }
  syncRecorderUi();
}

async function saveRecording(stopAfter) {
  const wav = recorder.grab();
  const label = $('recSource').value === 'system' ? 'sistema' : 'mic';
  if (stopAfter) {
    await recorder.disarm();
    recMode = null;
  }
  if (!wav) {
    setStatus('Nada capturado.');
  } else {
    const result = await frog.saveRecording(wav, label);
    state = result.state;
    renderList();
    setStatus('Salvo na biblioteca.');
  }
  syncRecorderUi();
}

function syncRecorderUi() {
  const manual = recMode === 'manual';
  const buffering = recMode === 'buffer';
  const secs = state.settings.replaySeconds;

  $('recToggle').innerHTML = `<span class="dot"></span>${manual ? 'Parar e salvar' : 'Gravar'}`;
  $('recToggle').dataset.on = String(manual);
  $('recToggle').disabled = buffering;
  $('bufferToggle').innerHTML = `Buffer <b>${secs}</b>s: ${buffering ? 'on' : 'off'}`;
  $('bufferToggle').dataset.on = String(buffering);
  $('bufferToggle').disabled = manual;
  $('bufferGrab').innerHTML = `Salvar ultimos <b>${secs}</b>s`;
  $('bufferGrab').disabled = !buffering;
  $('recSource').disabled = recMode !== null;
  $('recMicIn').disabled = recMode !== null;
}

/* -------------------------------------------------------------- setup ---- */

function wireControls() {
  $('micOut').addEventListener('change', (e) => pushSettings({ micDeviceId: e.target.value }));
  $('monitorOut').addEventListener('change', (e) => pushSettings({ monitorDeviceId: e.target.value }));
  $('recMicIn').addEventListener('change', (e) => pushSettings({ recordMicDeviceId: e.target.value }));

  const master = $('master');
  master.addEventListener('input', () => { $('masterVal').textContent = `${master.value}%`; });
  master.addEventListener('change', () => pushSettings({ masterVolume: Number(master.value) / 100 }));

  const monitor = $('monitorVol');
  monitor.addEventListener('input', () => { $('monitorVal').textContent = `${monitor.value}%`; });
  monitor.addEventListener('change', () => pushSettings({ monitorVolume: Number(monitor.value) / 100 }));

  $('hotkeyToggle').addEventListener('click', async () => {
    await pushSettings({ hotkeysEnabled: !state.settings.hotkeysEnabled });
    syncHotkeyToggle();
    renderGrid();
  });

  $('stopAll').addEventListener('click', () => engine.stopAll());

  $('search').addEventListener('input', (e) => { filter = e.target.value; renderList(); });

  $('addFiles').addEventListener('click', async () => {
    const result = await frog.addFiles();
    state = result.state;
    renderList();
    if (result.added) setStatus(`${result.added} som(ns) adicionado(s).`);
  });

  $('addFolder').addEventListener('click', async () => {
    const result = await frog.addFolder();
    state = result.state;
    renderList();
    setStatus(`${result.added} adicionado(s), ${result.skipped} ja existiam.`);
  });

  $('recToggle').addEventListener('click', () => {
    if (recMode === 'manual') saveRecording(true);
    else startRecording('manual');
  });

  $('bufferToggle').addEventListener('click', async () => {
    if (recMode === 'buffer') {
      await recorder.disarm();
      recMode = null;
      setStatus('Buffer desligado.');
      syncRecorderUi();
    } else {
      startRecording('buffer');
    }
  });

  $('bufferGrab').addEventListener('click', () => saveRecording(false));

  $('openData').addEventListener('click', () => frog.openDataFolder());

  navigator.mediaDevices.addEventListener('devicechange', refreshDevices);

  engine.onActiveChange((count) => {
    // count conta saidas, nao sons: um disparo acende duas (mic + fone).
    $('playing').textContent = count ? `${count} saida(s) tocando` : 'nada tocando';
    document.querySelector('.meter').dataset.live = String(count > 0);
  });

  frog.onHotkey((payload) => {
    if (payload.type === 'slot') fire(payload.slot);
    else if (payload.type === 'stopAll') engine.stopAll();
    else if (payload.type === 'page') {
      activePage = payload.page;
      renderPages();
      renderGrid();
    }
  });
}

function syncHotkeyToggle() {
  const on = state.settings.hotkeysEnabled;
  const toggle = $('hotkeyToggle');
  toggle.dataset.on = String(on);
  toggle.querySelector('.pill-text').textContent = on ? 'Hotkeys ativas' : 'Hotkeys desligadas';
  toggle.title = on
    ? 'Clique para liberar F1-F12 para o jogo'
    : 'Clique para voltar a disparar sons pelas teclas';
}

async function boot() {
  state = await frog.getState();

  $('master').value = Math.round(state.settings.masterVolume * 100);
  $('masterVal').textContent = `${$('master').value}%`;
  $('monitorVol').value = Math.round(state.settings.monitorVolume * 100);
  $('monitorVal').textContent = `${$('monitorVol').value}%`;

  await refreshLiveHotkeys();

  wireControls();
  syncHotkeyToggle();
  syncRecorderUi();
  renderPages();
  renderGrid();
  renderList();

  await unlockDeviceLabels();
  await refreshDevices();
}

boot();
