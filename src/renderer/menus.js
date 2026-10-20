// Cardapio dos menus, espelhando a estrutura do Soundpad.
//
// Cada item recebe o objeto ACTIONS do app.js, entao este arquivo descreve
// *o que existe* sem saber como nada e feito. `check` devolve true quando o
// item deve aparecer marcado.

const sep = { sep: true };

export const MENUS = {
  arquivo: [
    { label: 'Adicionar arquivos de som', run: (a) => a.addFiles() },
    { label: 'Adicionar pasta', run: (a) => a.addFolder() },
    sep,
    { label: 'Estatisticas: reiniciar contagem', run: (a) => a.resetStats() },
    sep,
    { label: 'Abrir pasta de dados', run: (a) => a.openDataFolder() },
  ],

  editar: [
    { label: 'Editar som selecionado', run: (a) => a.editSelected() },
    { label: 'Remover selecionado', accel: 'Del', run: (a) => a.removeSelected() },
    sep,
    { label: 'Embaralhar lista', run: (a) => a.shuffle() },
    { label: 'Encontrar registros inoperantes', run: (a) => a.findDead() },
    sep,
    { label: 'Pesquisar', accel: 'Ctrl+F', run: (a) => a.focusSearch() },
  ],

  reproduzir: [
    {
      label: 'Reproduzir selecionado (alto-falantes e microfone)',
      run: (a) => a.playSelected('both'),
    },
    {
      label: 'Reproduzir selecionado apenas nos alto-falantes',
      run: (a) => a.playSelected('monitor'),
    },
    {
      label: 'Reproduzir selecionado apenas no microfone',
      run: (a) => a.playSelected('mic'),
    },
    sep,
    { label: 'Reproduzir aleatorio (alto-falantes e microfone)', run: (a) => a.playRandom('both') },
    { label: 'Reproduzir aleatorio apenas nos alto-falantes', run: (a) => a.playRandom('monitor') },
    { label: 'Reproduzir aleatorio apenas no microfone', run: (a) => a.playRandom('mic') },
    {
      label: 'Reproduzir aleatorio de todas as categorias',
      run: (a) => a.playRandom(undefined, true),
    },
    sep,
    { label: 'Parar reproducao', run: (a) => a.stop() },
    { label: 'Pausar / retomar reproducao', run: (a) => a.pause() },
    { label: 'Reproduzir arquivo anterior', run: (a) => a.prev() },
    { label: 'Reproduzir proximo arquivo', run: (a) => a.next() },
    sep,
    {
      label: 'Continuar a reproducao apos o arquivo atual',
      check: (s) => s.settings.continueAfter,
      run: (a) => a.toggle('continueAfter'),
    },
    {
      label: 'Repetir a reproducao da lista',
      check: (s) => s.settings.repeatList,
      run: (a) => a.toggle('repeatList'),
    },
    {
      label: 'Repetir a reproducao do arquivo atual',
      check: (s) => s.settings.repeatOne,
      run: (a) => a.toggle('repeatOne'),
    },
    {
      label: 'Interrupcao automatica (recomendado)',
      check: (s) => s.settings.autoStop,
      run: (a) => a.toggle('autoStop'),
    },
    sep,
    {
      label: 'Modo padrao: alto-falantes e microfone',
      check: (s) => s.settings.playTarget === 'both',
      run: (a) => a.setMode('both'),
    },
    {
      label: 'Modo padrao: apenas alto-falantes',
      check: (s) => s.settings.playTarget === 'monitor',
      run: (a) => a.setMode('monitor'),
    },
    {
      label: 'Modo padrao: apenas microfone',
      check: (s) => s.settings.playTarget === 'mic',
      run: (a) => a.setMode('mic'),
    },
  ],

  janela: [
    {
      label: 'Barra principal',
      check: (s) => s.settings.hotbarVisible,
      run: (a) => a.toggleHotbar(),
    },
    { label: 'Auto-keys: distribuir sons nos slots', run: (a) => a.autoKeys() },
    sep,
    {
      label: 'Teclas de atalho ativadas',
      check: (s) => s.settings.hotkeysEnabled,
      run: (a) => a.toggleHotkeys(),
    },
    sep,
    { label: 'Gravador de som', accel: 'Ctrl+R', run: (a) => a.openPanel('rec') },
    { label: 'Conversao de texto em fala', accel: 'Ctrl+T', run: (a) => a.openPanel('tts') },
    { label: 'Sua voz (passagem)', run: (a) => a.openPanel('voice') },
    { label: 'Dispositivos', run: (a) => a.openPanel('dev') },
  ],
};
