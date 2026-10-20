import { engine } from './audio.js';
import { Recorder } from './recorder.js';
import { passthrough } from './passthrough.js';

const frog = window.frog;
const $ = (id) => document.getElementById(id);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

const fmtTime = (s) => {
  const total = Math.max(0, Math.round(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

let state = null;
let activePage = 0;
let filter = '';
let activeCategory = '';
let liveHotkeys = new Set();
let editing = null;      // som aberto no editor
let editDuration = 0;    // duracao bruta do som em edicao
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
  fillSelect($('passDevice'), inputs, state.settings.passthrough.deviceId, 'microfone padrao');

  $('devInfo').textContent = `${outputs.length} saidas - ${inputs.length} entradas`;

  if (!state.settings.micDeviceId) {
    const cable = outputs.find((d) => /cable input|voicemeeter input|virtual/i.test(d.label));
    if (cable) {
      await pushSettings({ micDeviceId: cable.deviceId });
      $('micOut').value = cable.deviceId;
      setStatus(`Cabo virtual detectado: ${cable.label}`);
    }
  }
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
  toggle.title = on
    ? 'Sua voz esta indo para o cabo virtual junto com os sons'
    : 'Ligue para o Discord ouvir voce E os sons pelo mesmo dispositivo';
}

/* ============================================================= board ===== */

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
      cell.addEventListener('click', (event) => {
        // Shift = previa so no fone, sem mandar nada pro Discord.
        fire(slot, event.shiftKey ? 'monitor' : undefined);
      });
    }

    cell.addEventListener('contextmenu', async (event) => {
      event.preventDefault();
      state = await frog.assignSlot(activePage, slot, null);
      renderGrid();
      renderPages();
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
    });

    grid.append(cell);
  });
}

/* =========================================================== library ===== */

function renderCategories() {
  const box = $('cats');
  const used = [...new Set(state.sounds.map((s) => s.category).filter(Boolean))].sort();
  box.innerHTML = '';
  if (!used.length) return;

  const make = (value, label) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = label;
    chip.dataset.on = String(activeCategory === value);
    chip.addEventListener('click', () => {
      activeCategory = activeCategory === value ? '' : value;
      renderCategories();
      renderList();
    });
    box.append(chip);
  };

  make('', 'Todas');
  for (const cat of used) make(cat, cat);

  $('catList').innerHTML = used.map((c) => `<option value="${escapeHtml(c)}">`).join('');
}

function renderList() {
  const list = $('list');
  list.innerHTML = '';
  const needle = filter.trim().toLowerCase();

  const matches = state.sounds
    .filter((s) => !needle || s.name.toLowerCase().includes(needle))
    .filter((s) => !activeCategory || s.category === activeCategory)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  for (const sound of matches) {
    const item = document.createElement('li');
    item.draggable = true;
    item.dataset.on = String(editing?.id === sound.id);
    item.innerHTML = `
      <span class="name" title="${escapeHtml(sound.path)}">${escapeHtml(sound.name)}</span>
      ${sound.category ? `<span class="tag">${escapeHtml(sound.category)}</span>` : ''}
      <button class="gear" type="button" title="Editar">&#9881;</button>`;

    item.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', sound.id);
    });
    item.querySelector('.name').addEventListener('click', () => play(sound));
    item.querySelector('.gear').addEventListener('click', (event) => {
      event.stopPropagation();
      openEditor(sound);
    });

    list.append(item);
  }

  if (!matches.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = state.sounds.length
      ? 'Nenhum som com esse filtro.'
      : 'Biblioteca vazia. Comece em Arquivos ou Pasta.';
    list.append(empty);
  }
}

/* ========================================================== playback ===== */

function play(sound, override) {
  engine.play(sound, state.settings, override).catch((err) => {
    setStatus(`Nao deu pra tocar: ${err.message}`);
  });
}

function fire(slot, override) {
  const soundId = state.pages[activePage][slot];
  const sound = soundId ? soundById(soundId) : null;
  if (!sound) return;

  play(sound, override);
  const cell = $('grid').querySelector(`[data-slot="${slot}"]`);
  if (cell) {
    cell.classList.remove('fired');
    void cell.offsetWidth;
    cell.classList.add('fired');
  }
}

let seeking = false;

function renderNowPlaying() {
  const voice = engine.current;
  const box = $('nowplaying');
  box.dataset.has = String(Boolean(voice));

  if (!voice) {
    $('npName').textContent = 'nada tocando';
    $('npTime').textContent = '0:00';
    $('npDur').textContent = '0:00';
    if (!seeking) $('seek').value = 0;
    $('playPause').textContent = '⏸';
    return;
  }

  $('npName').textContent = voice.sound.name;
  $('npDur').textContent = fmtTime(voice.duration);
  $('npTime').textContent = fmtTime(voice.position);
  $('playPause').textContent = voice.paused ? '▶' : '⏸';
  if (!seeking) $('seek').value = Math.round((voice.position / voice.duration) * 1000);
}

/* ============================================================ editor ===== */

function drawWave(buffer) {
  const canvas = $('edWave');
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const mid = height / 2;

  ctx.clearRect(0, 0, width, height);
  if (!buffer) return;

  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / width));

  ctx.fillStyle = '#5c9018';
  for (let x = 0; x < width; x += 1) {
    let min = 0;
    let max = 0;
    for (let i = 0; i < step; i += 1) {
      const value = data[x * step + i] ?? 0;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    ctx.fillRect(x, mid + min * mid, 1, Math.max(1, (max - min) * mid));
  }

  // Sombreia o que o trim descarta.
  const sound = editing;
  const toX = (seconds) => (seconds / editDuration) * width;
  ctx.fillStyle = 'rgba(12, 17, 10, 0.72)';
  if (sound.trimStart > 0) ctx.fillRect(0, 0, toX(sound.trimStart), height);
  if (sound.trimEnd > 0 && sound.trimEnd < editDuration) {
    ctx.fillRect(toX(sound.trimEnd), 0, width - toX(sound.trimEnd), height);
  }
}

async function openEditor(sound) {
  editing = sound;
  $('editor').classList.remove('hidden');
  renderList();

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
  const buffer = await engine.bufferOf(sound, state.settings).catch(() => null);
  drawWave(buffer);
}

function syncEditorLabels() {
  const sound = editing;
  if (!sound) return;
  $('edStartVal').textContent = `${(sound.trimStart ?? 0).toFixed(2).replace('.', ',')}s`;
  const end = sound.trimEnd > 0 ? sound.trimEnd : editDuration;
  $('edEndVal').textContent = `${end.toFixed(2).replace('.', ',')}s`;
  $('edFadeInVal').textContent = `${(sound.fadeIn ?? 0).toFixed(1).replace('.', ',')}s`;
  $('edFadeOutVal').textContent = `${(sound.fadeOut ?? 0).toFixed(1).replace('.', ',')}s`;
}

async function saveEdit(patch) {
  if (!editing) return;
  Object.assign(editing, patch);
  state = await frog.updateSound(editing.id, patch);
  editing = soundById(editing.id);
  engine.forget(editing.path); // o buffer em cache nao conhece o novo trim
  syncEditorLabels();
  renderList();
  renderGrid();
  renderCategories();
}

function closeEditor() {
  editing = null;
  $('editor').classList.add('hidden');
  renderList();
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
    renderList();
    renderCategories();
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
  // Prefere uma voz em portugues na primeira vez.
  const preferred = state.settings.tts.voice
    || voices.find((v) => /maria|daniel|portug/i.test(v))
    || voices[0];
  select.value = preferred;
  if (preferred !== state.settings.tts.voice) await pushSettings({ tts: { voice: preferred } });
}

function ttsOptions() {
  return {
    text: $('ttsText').value,
    voice: $('ttsVoice').value,
    rate: Number($('ttsRate').value),
    volume: state.settings.tts.volume,
  };
}

async function doSpeak() {
  const status = $('ttsStatus');
  status.textContent = 'sintetizando...';
  try {
    const { path } = await frog.ttsSpeak(ttsOptions());
    engine.forget(path); // cada sintese gera um arquivo novo, nada a reaproveitar
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
    renderList();
    renderCategories();
    status.textContent = 'guardado na biblioteca';
  } catch (err) {
    status.textContent = err.message;
  }
}

/* ============================================================= setup ===== */

function wireControls() {
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

  for (const button of $('target').querySelectorAll('button')) {
    button.addEventListener('click', async () => {
      await pushSettings({ playTarget: button.dataset.value });
      syncTarget();
    });
  }

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
    renderCategories();
    if (result.added) setStatus(`${result.added} som(ns) adicionado(s).`);
  });

  $('addFolder').addEventListener('click', async () => {
    const result = await frog.addFolder();
    state = result.state;
    renderList();
    renderCategories();
    setStatus(`${result.added} adicionado(s), ${result.skipped} ja existiam.`);
  });

  $('autoKeys').addEventListener('click', async () => {
    const result = await frog.autoAssign();
    state = result.state;
    renderPages();
    renderGrid();
    setStatus(result.placed
      ? `${result.placed} som(ns) distribuido(s)${result.remaining ? `, ${result.remaining} sem espaco` : ''}.`
      : 'Nenhum slot vazio para preencher.');
  });

  $('clearPage').addEventListener('click', async () => {
    state = await frog.clearPage(activePage);
    renderPages();
    renderGrid();
  });

  $('playPause').addEventListener('click', () => engine.togglePause(state.settings));

  const seek = $('seek');
  seek.addEventListener('pointerdown', () => { seeking = true; });
  seek.addEventListener('change', async () => {
    const voice = engine.current;
    if (voice) await engine.seek((Number(seek.value) / 1000) * voice.duration, state.settings);
    seeking = false;
  });

  // Painel inferior: gravar / falar
  for (const tab of document.querySelectorAll('.panel-tabs button')) {
    tab.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.panel-tabs button')) {
        other.classList.toggle('on', other === tab);
      }
      for (const body of document.querySelectorAll('.panel-body')) {
        body.classList.toggle('hidden', body.dataset.tab !== tab.dataset.tab);
      }
    });
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

  // Editor
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

  $('edFadeIn').addEventListener('change', () =>
    saveEdit({ fadeIn: Number($('edFadeIn').value) / 10 }));
  $('edFadeOut').addEventListener('change', () =>
    saveEdit({ fadeOut: Number($('edFadeOut').value) / 10 }));

  $('edPreview').addEventListener('click', () => editing && play(editing, 'monitor'));
  $('edReveal').addEventListener('click', () => editing && frog.revealSound(editing.id));
  $('edDelete').addEventListener('click', async () => {
    if (!editing) return;
    const gone = editing;
    state = await frog.removeSound(gone.id);
    engine.forget(gone.path);
    closeEditor();
    renderGrid();
    renderPages();
    renderCategories();
  });

  $('openData').addEventListener('click', () => frog.openDataFolder());

  navigator.mediaDevices.addEventListener('devicechange', refreshDevices);

  engine.onChange((count) => {
    $('playing').textContent = count ? `${count} som(ns) tocando` : 'nada tocando';
    document.querySelector('.meter').dataset.live = String(count > 0);
    renderNowPlaying();
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

  setInterval(renderNowPlaying, 200);
}

function syncTarget() {
  const value = state.settings.playTarget ?? 'both';
  for (const button of $('target').querySelectorAll('button')) {
    button.dataset.on = String(button.dataset.value === value);
  }
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
  $('passGain').value = Math.round(state.settings.passthrough.gain * 100);
  $('passGainVal').textContent = `${$('passGain').value}%`;
  $('ttsRate').value = state.settings.tts.rate;

  liveHotkeys = new Set(await frog.hotkeyList());

  wireControls();
  syncHotkeyToggle();
  syncTarget();
  syncRecorderUi();
  renderPages();
  renderGrid();
  renderCategories();
  renderList();

  await unlockDeviceLabels();
  await refreshDevices();
  await syncPassthrough();
  await loadVoices();
}

boot();
