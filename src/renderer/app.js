import { engine } from './audio.js';
import { Recorder } from './recorder.js';
import { passthrough } from './passthrough.js';
import { MENUS } from './menus.js';

const frog = window.frog;
const $ = (id) => document.getElementById(id);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

const fmtTime = (s) => {
  const total = Math.max(0, Math.round(s || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

let state = null;
let activePage = 0;
let filter = '';
let activeCategory = '';   // '' = todos os sons
let selectedId = null;
let liveHotkeys = new Set();
let editing = null;
let editDuration = 0;
let visible = [];          // sons na ordem em que a tabela mostra
let setupDismissed = false;
const recorder = new Recorder();
let recMode = null;

const soundById = (id) => state.sounds.find((s) => s.id === id) ?? null;

async function pushSettings(partial) {
  state = await frog.patchState({ settings: partial });
  liveHotkeys = new Set(await frog.hotkeyList());
}

const setStatus = (text) => { $('recStatus').textContent = text; };

/* ============================================================ devices ==== */

async function unlockDeviceLabels() {
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of probe.getTracks()) track.stop();
  } catch (err) {
    console.warn('[soundFrog] permissao de microfone negada:', err.message);
  }
}

function fillSelect(select, devices, selectedDevice, emptyLabel) {
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
  select.value = devices.some((d) => d.deviceId === selectedDevice) ? selectedDevice : '';
}

async function refreshDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default');
  const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');

  fillSelect($('micOut'), outputs, state.settings.micDeviceId, 'nenhum (so no fone)');
  fillSelect($('monitorOut'), outputs, state.settings.monitorDeviceId, 'saida padrao do Windows');
  fillSelect($('recMicIn'), inputs, state.settings.recordMicDeviceId, 'microfone padrao');
  fillSelect($('passDevice'), inputs, state.settings.passthrough.deviceId, 'microfone padrao');

  $('devInfo').textContent = `${outputs.length} saidas / ${inputs.length} entradas`;

  const cable = outputs.find((d) => /cable input|voicemeeter|virtual audio/i.test(d.label));
  if (cable && !state.settings.micDeviceId) {
    await pushSettings({ micDeviceId: cable.deviceId });
    $('micOut').value = cable.deviceId;
    setStatus(`Cabo virtual detectado: ${cable.label}`);
  }

  // Sem cabo o app toca so no fone; avisa antes que pareca defeito.
  $('setup').classList.toggle('hidden', Boolean(cable) || setupDismissed);
}

/* ========================================================= passagem ====== */

async function syncPassthrough() {
  const config = state.settings.passthrough;
  const target = state.settings.micDeviceId;
  const toggle = $('passToggle');

  try {
    if (config.enabled) {
      if (!passthrough.running || passthrough.needsRestart(config, target)) {
        await passthrough.start(config, target);
      }
      passthrough.setGain(config.gain);
    } else {
      await passthrough.stop();
    }
  } catch (err) {
    await pushSettings({ passthrough: { enabled: false } });
    setStatus(`Passagem de voz: ${err.message}`);
  }

  const on = passthrough.running;
  toggle.dataset.on = String(on);
  toggle.querySelector('.pill-text').textContent = on ? 'Passagem on' : 'Passagem off';
}

/* ============================================================== lista ==== */

function categoryCounts() {
  const counts = new Map();
  for (const sound of state.sounds) {
    const key = sound.category || '';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function renderCategories() {
  const tree = $('catTree');
  const counts = categoryCounts();
  const names = [...new Set(state.sounds.map((s) => s.category).filter(Boolean))].sort();

  tree.innerHTML = '';

  const row = (value, label, count, icon) => {
    const li = document.createElement('li');
    li.dataset.on = String(activeCategory === value);
    li.innerHTML = `<span class="ci">${icon}</span><span class="cn">${escapeHtml(label)}</span><span class="cc">${count}</span>`;
    li.addEventListener('click', () => {
      activeCategory = value;
      renderCategories();
      renderRows();
    });
    tree.append(li);
  };

  row('', 'Todos os sons', state.sounds.length, '\u{1F50A}');
  const loose = counts.get('') ?? 0;
  if (loose) row('\u0000', 'Sem categoria', loose, '\u{1F4C2}');
  for (const name of names) row(name, name, counts.get(name) ?? 0, '\u{1F4C1}');

  $('catList').innerHTML = names.map((c) => `<option value="${escapeHtml(c)}">`).join('');
}

function matchesCategory(sound) {
  if (activeCategory === '') return true;
  if (activeCategory === '\u0000') return !sound.category;
  return sound.category === activeCategory;
}

function renderRows() {
  const body = $('rows');
  const needle = filter.trim().toLowerCase();

  visible = state.sounds
    .filter((s) => matchesCategory(s))
    .filter((s) => !needle || s.name.toLowerCase().includes(needle));

  body.innerHTML = '';

  visible.forEach((sound, index) => {
    const tr = document.createElement('tr');
    tr.dataset.id = sound.id;
    tr.dataset.on = String(selectedId === sound.id);
    tr.draggable = true;

    const accel = hotkeyOf(sound.id);
    tr.innerHTML = `
      <td class="c-idx">${index + 1}</td>
      <td class="c-name">${escapeHtml(sound.name)}</td>
      <td class="c-cat">${escapeHtml(sound.category || '')}</td>
      <td class="c-dur">${sound.duration ? fmtTime(sound.duration) : '--:--'}</td>
      <td class="c-count">${sound.playCount || ''}</td>
      <td class="c-key">${accel ? `<span class="kbd">${escapeHtml(accel)}</span>` : ''}</td>`;

    tr.addEventListener('click', () => select(sound.id));
    tr.addEventListener('dblclick', () => play(sound));
    tr.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      select(sound.id);
      openEditor(sound);
    });
    tr.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', sound.id);
    });

    body.append(tr);
  });

  const empty = $('listEmpty');
  if (!visible.length) {
    empty.textContent = state.sounds.length
      ? 'Nenhum som com esse filtro.'
      : 'Lista vazia. Use + Arquivos ou + Pasta.';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
  }

  syncStatusBar();
  ensureDurations();
}

/** Qual hotkey dispara esse som, olhando em que slot ele esta. */
function hotkeyOf(soundId) {
  for (let page = 0; page < state.pages.length; page += 1) {
    const slot = state.pages[page].indexOf(soundId);
    if (slot >= 0) {
      const accel = state.settings.slotHotkeys[slot] ?? '';
      return page === 0 ? accel : `P${page + 1}+${accel}`;
    }
  }
  return '';
}

function select(id) {
  selectedId = id;
  for (const tr of $('rows').querySelectorAll('tr')) {
    tr.dataset.on = String(tr.dataset.id === id);
  }
  syncStatusBar();
}

function syncStatusBar() {
  const label = activeCategory === ''
    ? 'Todos os sons'
    : (activeCategory === '\u0000' ? 'Sem categoria' : activeCategory);
  $('sbCat').textContent = label;
  $('sbCount').textContent = visible.length;
  $('sbSel').textContent = selectedId ? 1 : 0;
  $('sbPlays').textContent = state.sounds.reduce((sum, s) => sum + (s.playCount || 0), 0);
}

/** Preenche a coluna de duracao decodificando o que ainda nao tem. */
let durationQueue = false;
async function ensureDurations() {
  if (durationQueue) return;
  const pending = visible.filter((s) => !s.duration).slice(0, 12);
  if (!pending.length) return;
  durationQueue = true;
  for (const sound of pending) {
    try {
      const duration = await engine.durationOf(sound, state.settings);
      sound.duration = duration;
      await frog.setDuration(sound.id, duration);
    } catch { /* arquivo sumiu ou formato nao suportado */ }
  }
  durationQueue = false;
  renderRows();
}

/* =========================================================== playback ==== */

async function play(sound, override) {
  if (!sound) return;
  if (state.settings.autoStop) engine.stopAll();
  try {
    await engine.play(sound, state.settings, override);
    const result = await frog.played(sound.id, sound.duration);
    if (result) {
      sound.playCount = result.playCount;
      renderRows();
    }
  } catch (err) {
    setStatus(`Nao deu pra tocar: ${err.message}`);
  }
}

const selectedSound = () => (selectedId ? soundById(selectedId) : null);

function playSelected(override) {
  play(selectedSound() ?? visible[0], override);
}

function playRandom(override, allCategories) {
  const pool = allCategories ? state.sounds : visible;
  if (!pool.length) return;
  const sound = pool[Math.floor(Math.random() * pool.length)];
  select(sound.id);
  play(sound, override);
}

function step(delta) {
  if (!visible.length) return;
  const current = visible.findIndex((s) => s.id === selectedId);
  const next = (((current < 0 ? 0 : current) + delta) % visible.length + visible.length) % visible.length;
  const sound = visible[next];
  select(sound.id);
  play(sound);
}

/** Encadeamento: repetir atual, repetir lista ou seguir para o proximo. */
function onVoiceEnded(voice) {
  const settings = state.settings;
  if (settings.repeatOne) {
    play(soundById(voice.sound.id) ?? voice.sound);
    return;
  }
  if (!settings.continueAfter && !settings.repeatList) return;

  const index = visible.findIndex((s) => s.id === voice.sound.id);
  if (index < 0) return;
  const next = index + 1;
  if (next < visible.length) {
    select(visible[next].id);
    play(visible[next]);
  } else if (settings.repeatList && visible.length) {
    select(visible[0].id);
    play(visible[0]);
  }
}

let seeking = false;

function renderTransport() {
  const voice = engine.current;
  $('tTime').textContent = fmtTime(voice ? voice.position : 0);
  $('tDur').textContent = fmtTime(voice ? voice.duration : 0);
  $('tPause').textContent = voice && voice.paused ? '▶' : '❙❙';
  if (!seeking) $('seek').value = voice ? Math.round((voice.position / voice.duration) * 1000) : 0;
}

/* ============================================================ hotbar ===== */

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

  state.pages[activePage].forEach((soundId, slot) => {
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

    if (sound) {
      cell.addEventListener('click', (event) => fire(slot, event.shiftKey ? 'monitor' : undefined));
    }
    cell.addEventListener('contextmenu', async (event) => {
      event.preventDefault();
      state = await frog.assignSlot(activePage, slot, null);
      renderGrid();
      renderPages();
      renderRows();
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
      renderPages();
      renderRows();
    });

    grid.append(cell);
  });
}

function fire(slot, override) {
  const soundId = state.pages[activePage][slot];
  const sound = soundId ? soundById(soundId) : null;
  if (!sound) return;
  select(sound.id);
  play(sound, override);

  const cell = $('grid').querySelector(`[data-slot="${slot}"]`);
  if (cell) {
    cell.classList.remove('fired');
    void cell.offsetWidth;
    cell.classList.add('fired');
  }
}

/* ============================================================ editor ===== */

function drawWave(buffer) {
  const canvas = $('edWave');
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const mid = height / 2;
  ctx.clearRect(0, 0, width, height);
  if (!buffer || !editing) return;

  const data = buffer.getChannelData(0);
  const step2 = Math.max(1, Math.floor(data.length / width));
  ctx.fillStyle = '#5c9018';
  for (let x = 0; x < width; x += 1) {
    let min = 0;
    let max = 0;
    for (let i = 0; i < step2; i += 1) {
      const value = data[x * step2 + i] ?? 0;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    ctx.fillRect(x, mid + min * mid, 1, Math.max(1, (max - min) * mid));
  }

  const toX = (seconds) => (seconds / editDuration) * width;
  ctx.fillStyle = 'rgba(12, 17, 10, 0.72)';
  if (editing.trimStart > 0) ctx.fillRect(0, 0, toX(editing.trimStart), height);
  if (editing.trimEnd > 0 && editing.trimEnd < editDuration) {
    ctx.fillRect(toX(editing.trimEnd), 0, width - toX(editing.trimEnd), height);
  }
}

async function openEditor(sound) {
  editing = sound;
  $('editor').classList.remove('hidden');

  $('edName').value = sound.name;
  $('edCategory').value = sound.category ?? '';
  $('edVol').value = Math.round((sound.volume ?? 1) * 100);
  $('edVolVal').textContent = `${$('edVol').value}%`;
  $('edNorm').checked = Boolean(sound.normalize);
  $('edFadeIn').value = Math.round((sound.fadeIn ?? 0) * 10);
  $('edFadeOut').value = Math.round((sound.fadeOut ?? 0) * 10);

  try {
    editDuration = await engine.durationOf(sound, state.settings);
  } catch (err) {
    editDuration = 0;
    setStatus(`Nao deu pra ler o arquivo: ${err.message}`);
    return;
  }

  $('edStart').value = Math.round(((sound.trimStart ?? 0) / editDuration) * 1000);
  const end = sound.trimEnd > 0 ? sound.trimEnd : editDuration;
  $('edEnd').value = Math.round((end / editDuration) * 1000);

  syncEditorLabels();
  drawWave(await engine.bufferOf(sound, state.settings).catch(() => null));
}

function syncEditorLabels() {
  if (!editing) return;
  $('edStartVal').textContent = `${(editing.trimStart ?? 0).toFixed(2).replace('.', ',')}s`;
  const end = editing.trimEnd > 0 ? editing.trimEnd : editDuration;
  $('edEndVal').textContent = `${end.toFixed(2).replace('.', ',')}s`;
  $('edFadeInVal').textContent = `${(editing.fadeIn ?? 0).toFixed(1).replace('.', ',')}s`;
  $('edFadeOutVal').textContent = `${(editing.fadeOut ?? 0).toFixed(1).replace('.', ',')}s`;
}

async function saveEdit(patch) {
  if (!editing) return;
  Object.assign(editing, patch);
  state = await frog.updateSound(editing.id, patch);
  editing = soundById(editing.id);
  engine.forget(editing.path);
  syncEditorLabels();
  renderRows();
  renderGrid();
  renderCategories();
}

function closeEditor() {
  editing = null;
  $('editor').classList.add('hidden');
}

/* ========================================================== gravacao ===== */

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
    renderRows();
    renderCategories();
    setStatus('Salvo na lista.');
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

/* =============================================================== TTS ===== */

async function loadVoices() {
  const voices = await frog.ttsVoices();
  const select = $('ttsVoice');
  select.innerHTML = '';
  if (!voices.length) {
    select.innerHTML = '<option value="">nenhuma voz instalada</option>';
    $('ttsSpeak').disabled = true;
    $('ttsSave').disabled = true;
    return;
  }
  for (const voice of voices) {
    const option = document.createElement('option');
    option.value = voice;
    option.textContent = voice.replace(/^Microsoft /, '');
    select.append(option);
  }
  const preferred = state.settings.tts.voice
    || voices.find((v) => /maria|daniel|portug/i.test(v))
    || voices[0];
  select.value = preferred;
  if (preferred !== state.settings.tts.voice) await pushSettings({ tts: { voice: preferred } });
}

const ttsOptions = () => ({
  text: $('ttsText').value,
  voice: $('ttsVoice').value,
  rate: Number($('ttsRate').value),
  volume: state.settings.tts.volume,
});

async function doSpeak() {
  const status = $('ttsStatus');
  status.textContent = 'sintetizando...';
  try {
    const { path } = await frog.ttsSpeak(ttsOptions());
    engine.forget(path);
    await engine.play(
      { name: 'fala', path, volume: 1, trimStart: 0, trimEnd: 0, fadeIn: 0, fadeOut: 0 },
      state.settings,
    );
    status.textContent = 'falando';
  } catch (err) {
    status.textContent = err.message;
  }
}

async function doSaveSpeech() {
  const status = $('ttsStatus');
  status.textContent = 'salvando...';
  try {
    const result = await frog.ttsSave(ttsOptions());
    state = result.state;
    renderRows();
    renderCategories();
    status.textContent = 'guardado na lista';
  } catch (err) {
    status.textContent = err.message;
  }
}

/* ============================================================= menus ===== */

function closeMenu() {
  $('menupop').classList.add('hidden');
  for (const button of $('menubar').querySelectorAll('button')) button.dataset.on = 'false';
}

function openMenu(name, anchor) {
  const pop = $('menupop');
  const items = MENUS[name] ?? [];
  pop.innerHTML = '';

  for (const item of items) {
    if (item.sep) {
      pop.append(Object.assign(document.createElement('div'), { className: 'msep' }));
      continue;
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mitem';
    const checked = item.check ? item.check(state) : null;
    row.innerHTML = `
      <span class="mcheck">${checked === true ? '✓' : ''}</span>
      <span class="mlabel">${escapeHtml(item.label)}</span>
      <span class="maccel">${escapeHtml(item.accel ?? '')}</span>`;
    row.addEventListener('click', async () => {
      closeMenu();
      await item.run(ACTIONS);
    });
    pop.append(row);
  }

  const box = anchor.getBoundingClientRect();
  pop.style.left = `${Math.round(box.left)}px`;
  pop.style.top = `${Math.round(box.bottom + 2)}px`;
  pop.classList.remove('hidden');
  anchor.dataset.on = 'true';
}

/** Tudo que os menus podem acionar. Fica num objeto so para o menus.js
 *  descrever o cardapio sem conhecer o resto do app. */
const ACTIONS = {
  get state() { return state; },

  addFiles: async () => {
    const result = await frog.addFiles();
    state = result.state;
    renderRows();
    renderCategories();
  },
  addFolder: async () => {
    const result = await frog.addFolder();
    state = result.state;
    renderRows();
    renderCategories();
  },
  removeSelected: async () => {
    if (!selectedId) return;
    const sound = soundById(selectedId);
    state = await frog.removeSound(selectedId);
    if (sound) engine.forget(sound.path);
    selectedId = null;
    if (editing?.id === sound?.id) closeEditor();
    renderRows();
    renderGrid();
    renderPages();
    renderCategories();
  },
  shuffle: async () => {
    state = await frog.shuffle();
    renderRows();
  },
  findDead: async () => {
    const dead = await frog.findDead();
    if (!dead.length) {
      setStatus('Nenhum registro inoperante.');
      return;
    }
    state = await frog.removeMany(dead);
    renderRows();
    renderGrid();
    renderPages();
    renderCategories();
    setStatus(`${dead.length} registro(s) inoperante(s) removido(s).`);
  },
  resetStats: async () => {
    state = await frog.resetStats();
    renderRows();
  },
  focusSearch: () => $('search').focus(),

  playSelected: (override) => playSelected(override),
  playRandom: (override, all) => playRandom(override, all),
  stop: () => engine.stopAll(),
  pause: () => engine.togglePause(state.settings),
  prev: () => step(-1),
  next: () => step(1),

  setMode: async (value) => {
    await pushSettings({ playTarget: value });
    syncModes();
  },
  toggle: async (key) => {
    await pushSettings({ [key]: !state.settings[key] });
    syncModes();
  },

  toggleHotbar: async () => {
    await pushSettings({ hotbarVisible: !state.settings.hotbarVisible });
    syncHotbar();
  },
  toggleHotkeys: async () => {
    await pushSettings({ hotkeysEnabled: !state.settings.hotkeysEnabled });
    syncHotkeyToggle();
    renderGrid();
  },
  autoKeys: async () => {
    const result = await frog.autoAssign();
    state = result.state;
    renderPages();
    renderGrid();
    renderRows();
    setStatus(result.placed ? `${result.placed} som(ns) distribuido(s).` : 'Nenhum slot vazio.');
  },
  openPanel: (tab) => {
    for (const other of document.querySelectorAll('.panel-tabs button')) {
      other.classList.toggle('on', other.dataset.tab === tab);
    }
    for (const body of document.querySelectorAll('.panel-body')) {
      body.classList.toggle('hidden', body.dataset.tab !== tab);
    }
  },
  editSelected: () => {
    const sound = selectedSound();
    if (sound) openEditor(sound);
  },
  openDataFolder: () => frog.openDataFolder(),
};

/* ============================================================= setup ===== */

function syncModes() {
  const mode = state.settings.playTarget ?? 'both';
  $('tPlay').dataset.on = String(mode === 'both');
  $('tPlaySpk').dataset.on = String(mode === 'monitor');
  $('tPlayMic').dataset.on = String(mode === 'mic');
  $('mRepeatList').dataset.on = String(state.settings.repeatList);
  $('mRepeatOne').dataset.on = String(state.settings.repeatOne);
  $('mContinue').dataset.on = String(state.settings.continueAfter);
  $('mAutoStop').dataset.on = String(state.settings.autoStop);
}

function syncHotbar() {
  const on = state.settings.hotbarVisible;
  $('hotbar').classList.toggle('hidden', !on);
  $('hotbarToggle').dataset.on = String(on);
}

function syncHotkeyToggle() {
  const on = state.settings.hotkeysEnabled;
  const toggle = $('hotkeyToggle');
  toggle.dataset.on = String(on);
  toggle.querySelector('.pill-text').textContent = on ? 'Hotkeys' : 'Hotkeys off';
}

function wireControls() {
  // menubar
  for (const button of $('menubar').querySelectorAll('button')) {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const already = button.dataset.on === 'true';
      closeMenu();
      if (!already) openMenu(button.dataset.menu, button);
    });
  }
  document.addEventListener('click', closeMenu);

  // transporte
  $('tPlay').addEventListener('click', () => { ACTIONS.setMode('both'); playSelected('both'); });
  $('tPlaySpk').addEventListener('click', () => playSelected('monitor'));
  $('tPlayMic').addEventListener('click', () => playSelected('mic'));
  $('tPause').addEventListener('click', () => engine.togglePause(state.settings));
  $('tStop').addEventListener('click', () => engine.stopAll());
  $('tPrev').addEventListener('click', () => step(-1));
  $('tNext').addEventListener('click', () => step(1));
  $('tRandom').addEventListener('click', () => playRandom());

  $('mRepeatList').addEventListener('click', () => ACTIONS.toggle('repeatList'));
  $('mRepeatOne').addEventListener('click', () => ACTIONS.toggle('repeatOne'));
  $('mContinue').addEventListener('click', () => ACTIONS.toggle('continueAfter'));
  $('mAutoStop').addEventListener('click', () => ACTIONS.toggle('autoStop'));

  const seek = $('seek');
  seek.addEventListener('pointerdown', () => { seeking = true; });
  seek.addEventListener('change', async () => {
    const voice = engine.current;
    if (voice) await engine.seek((Number(seek.value) / 1000) * voice.duration, state.settings);
    seeking = false;
  });

  const master = $('master');
  master.addEventListener('input', () => { $('masterVal').textContent = `${master.value}%`; });
  master.addEventListener('change', () => pushSettings({ masterVolume: Number(master.value) / 100 }));

  const monitor = $('monitorVol');
  monitor.addEventListener('input', () => { $('monitorVal').textContent = `${monitor.value}%`; });
  monitor.addEventListener('change', () => pushSettings({ monitorVolume: Number(monitor.value) / 100 }));

  $('hotbarToggle').addEventListener('click', () => ACTIONS.toggleHotbar());
  $('hotkeyToggle').addEventListener('click', () => ACTIONS.toggleHotkeys());
  $('stopAll').addEventListener('click', () => engine.stopAll());

  // lista
  $('search').addEventListener('input', (e) => { filter = e.target.value; renderRows(); });
  $('addFiles').addEventListener('click', () => ACTIONS.addFiles());
  $('addFolder').addEventListener('click', () => ACTIONS.addFolder());
  $('addCat').addEventListener('click', () => {
    const sound = selectedSound();
    if (!sound) {
      setStatus('Selecione um som para dar categoria a ele.');
      return;
    }
    openEditor(sound);
    $('edCategory').focus();
  });

  // dispositivos e voz
  $('micOut').addEventListener('change', async (e) => {
    await pushSettings({ micDeviceId: e.target.value });
    await syncPassthrough();
  });
  $('monitorOut').addEventListener('change', (e) => pushSettings({ monitorDeviceId: e.target.value }));
  $('recMicIn').addEventListener('change', (e) => pushSettings({ recordMicDeviceId: e.target.value }));
  $('passDevice').addEventListener('change', async (e) => {
    await pushSettings({ passthrough: { deviceId: e.target.value } });
    await syncPassthrough();
  });
  $('passGain').addEventListener('input', () => {
    $('passGainVal').textContent = `${$('passGain').value}%`;
    passthrough.setGain(Number($('passGain').value) / 100);
  });
  $('passGain').addEventListener('change', () =>
    pushSettings({ passthrough: { gain: Number($('passGain').value) / 100 } }));
  $('passToggle').addEventListener('click', async () => {
    await pushSettings({ passthrough: { enabled: !state.settings.passthrough.enabled } });
    await syncPassthrough();
  });

  // hotbar
  $('autoKeys').addEventListener('click', () => ACTIONS.autoKeys());
  $('clearPage').addEventListener('click', async () => {
    state = await frog.clearPage(activePage);
    renderPages();
    renderGrid();
    renderRows();
  });

  // painel
  for (const tab of document.querySelectorAll('.panel-tabs button')) {
    tab.addEventListener('click', () => ACTIONS.openPanel(tab.dataset.tab));
  }
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
  $('ttsSpeak').addEventListener('click', doSpeak);
  $('ttsSave').addEventListener('click', doSaveSpeech);
  $('ttsText').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSpeak(); });
  $('ttsVoice').addEventListener('change', (e) => pushSettings({ tts: { voice: e.target.value } }));
  $('ttsRate').addEventListener('change', (e) => pushSettings({ tts: { rate: Number(e.target.value) } }));

  // editor
  $('edClose').addEventListener('click', closeEditor);
  $('edName').addEventListener('change', (e) => saveEdit({ name: e.target.value }));
  $('edCategory').addEventListener('change', (e) => saveEdit({ category: e.target.value }));
  $('edVol').addEventListener('input', () => { $('edVolVal').textContent = `${$('edVol').value}%`; });
  $('edVol').addEventListener('change', () => saveEdit({ volume: Number($('edVol').value) / 100 }));
  $('edNorm').addEventListener('change', (e) => saveEdit({ normalize: e.target.checked }));
  $('edStart').addEventListener('input', () => {
    if (!editing) return;
    editing.trimStart = (Number($('edStart').value) / 1000) * editDuration;
    syncEditorLabels();
    engine.bufferOf(editing, state.settings).then(drawWave).catch(() => {});
  });
  $('edStart').addEventListener('change', () => saveEdit({ trimStart: editing.trimStart }));
  $('edEnd').addEventListener('input', () => {
    if (!editing) return;
    const value = (Number($('edEnd').value) / 1000) * editDuration;
    editing.trimEnd = value >= editDuration - 0.01 ? 0 : value;
    syncEditorLabels();
    engine.bufferOf(editing, state.settings).then(drawWave).catch(() => {});
  });
  $('edEnd').addEventListener('change', () => saveEdit({ trimEnd: editing.trimEnd }));
  $('edFadeIn').addEventListener('change', () => saveEdit({ fadeIn: Number($('edFadeIn').value) / 10 }));
  $('edFadeOut').addEventListener('change', () => saveEdit({ fadeOut: Number($('edFadeOut').value) / 10 }));
  $('edPreview').addEventListener('click', () => editing && play(editing, 'monitor'));
  $('edReveal').addEventListener('click', () => editing && frog.revealSound(editing.id));
  $('edDelete').addEventListener('click', () => {
    selectedId = editing?.id ?? selectedId;
    ACTIONS.removeSelected();
  });

  $('openData').addEventListener('click', () => frog.openDataFolder());

  $('setupDonate').addEventListener('click', () =>
    frog.openExternal('https://vb-audio.com/Services/licensing.htm'));

  $('setupInstall').addEventListener('click', async () => {
    const button = $('setupInstall');
    const msg = $('setupMsg');
    button.disabled = true;
    button.textContent = 'Instalando...';
    msg.textContent = 'Confirme na janela do Windows. O instalador e da propria VB-Audio.';
    try {
      await frog.installCable();
      msg.innerHTML = '<b>Cabo instalado.</b> Reinicie o computador para o Windows '
        + 'reconhecer o dispositivo; depois o soundFrog o encontra sozinho.';
      button.textContent = 'Pronto';
    } catch (err) {
      msg.textContent = err.message;
      button.disabled = false;
      button.textContent = 'Tentar de novo';
    }
  });

  $('setupDismiss').addEventListener('click', () => {
    setupDismissed = true;
    $('setup').classList.add('hidden');
  });

  // atalhos de teclado da janela
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'f') { event.preventDefault(); $('search').focus(); }
    else if (event.ctrlKey && event.key === 't') { event.preventDefault(); ACTIONS.openPanel('tts'); }
    else if (event.ctrlKey && event.key === 'r') { event.preventDefault(); ACTIONS.openPanel('rec'); }
    else if (event.key === 'Delete' && document.activeElement?.tagName !== 'INPUT') {
      ACTIONS.removeSelected();
    } else if (event.key === 'Escape') {
      closeMenu();
    }
  });

  navigator.mediaDevices.addEventListener('devicechange', refreshDevices);

  engine.onChange((count) => {
    $('playing').textContent = count ? `${count} tocando` : 'nada tocando';
    document.querySelector('.meter').dataset.live = String(count > 0);
    renderTransport();
  });
  engine.onEnded(onVoiceEnded);

  frog.onHotkey((payload) => {
    if (payload.type === 'slot') fire(payload.slot);
    else if (payload.type === 'stopAll') engine.stopAll();
    else if (payload.type === 'page') {
      activePage = payload.page;
      renderPages();
      renderGrid();
    }
  });

  setInterval(renderTransport, 200);
}

async function boot() {
  state = await frog.getState();

  $('master').value = Math.round(state.settings.masterVolume * 100);
  $('masterVal').textContent = `${$('master').value}%`;
  $('monitorVol').value = Math.round(state.settings.monitorVolume * 100);
  $('monitorVal').textContent = `${$('monitorVol').value}%`;
  $('passGain').value = Math.round(state.settings.passthrough.gain * 100);
  $('passGainVal').textContent = `${$('passGain').value}%`;
  $('ttsRate').value = state.settings.tts.rate;

  liveHotkeys = new Set(await frog.hotkeyList());

  wireControls();
  syncHotkeyToggle();
  syncModes();
  syncHotbar();
  syncRecorderUi();
  renderPages();
  renderGrid();
  renderCategories();
  renderRows();

  await unlockDeviceLabels();
  await refreshDevices();
  await syncPassthrough();
  await loadVoices();
}

boot();
