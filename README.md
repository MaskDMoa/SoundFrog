# 🐸 soundFrog

Soundboard para Windows: toca seus sons **no microfone e no seu fone ao mesmo tempo**, com hotkeys globais, hotbar de 9 páginas, biblioteca com busca e gravação do microfone ou do áudio do sistema.

Feito em Electron. Instalador `.exe`, sem driver próprio, sem injeção em processo de terceiros.

---

## Como funciona (e por que assim)

Apps como o Soundpad injetam uma DLL no processo do Discord e misturam o áudio direto no stream de captura dele. Funciona, mas quebra a cada atualização do alvo e pode acionar anti-cheat em jogos.

O soundFrog usa o caminho previsível: **toca cada som em dois dispositivos de saída ao mesmo tempo.**

```
                     ┌──────────────► CABLE Input ──► (Discord ouve como microfone)
  som disparado ─────┤
                     └──────────────► seu fone      ──► (você ouve o que disparou)
```

Cada saída é um elemento `<audio>` próprio com `setSinkId()` apontando para o dispositivo escolhido. Nenhum processo externo é tocado.

## Pré-requisito: um cabo de áudio virtual

Instale **[VB-CABLE](https://vb-audio.com/Cable/)** (gratuito). Ele cria o par `CABLE Input` / `CABLE Output`.

Depois:

1. No soundFrog, em **Microfone (cabo virtual)**, escolha `CABLE Input`.
2. Em **Você ouve em**, escolha seu fone.
3. No Discord/OBS/jogo, defina o microfone como `CABLE Output`.

> Com isso o app de voz ouve **só os sons**. Para que ele ouça sua voz junto, roteie seu microfone real para o `CABLE Input` também — pelo **VoiceMeeter**, ou pelo Windows em `Painel de Controle de Som → Gravação → seu microfone → Ouvir → Reproduzir neste dispositivo: CABLE Input`.

## Instalação

Baixe o instalador na aba [Releases](../../releases) e rode. Ou compile:

```bash
npm install
npm start        # roda em modo dev
npm run dist     # gera o instalador em dist/
```

Requer Node.js 18+.

## Uso

| Ação | Como |
|---|---|
| Adicionar sons | `+ Arquivos` ou `+ Pasta` (varre subpastas até 4 níveis) |
| Colocar no hotbar | arraste da biblioteca para um slot |
| Limpar um slot | botão direito nele |
| Tocar | clique no slot, ou a hotkey dele, ou duplo clique na biblioteca |
| Trocar de página | `Ctrl+Alt+1` … `Ctrl+Alt+9` |
| Parar tudo | `Ctrl+Alt+Esc` ou o botão vermelho |
| Desligar hotkeys | botão `Hotkeys: ON` (o jogo volta a receber F1–F12) |

**Hotkeys padrão:** `F1`–`F12`, uma por slot. São **posicionais**: `F1` toca o slot 1 da página ativa, então 9 páginas × 12 slots = 108 sons em 12 teclas.

Fechar a janela manda o app para a bandeja; para sair de verdade, use o menu do ícone na bandeja.

### Gravação

- **Meu microfone** — grava do dispositivo de entrada escolhido.
- **Áudio do sistema** — grava o mix do Windows (loopback), sem precisar de cabo.
- **Buffer dos últimos 30s** — mantém um *ring buffer* rodando; clique em `Salvar os últimos 30s` quando alguém falar algo bom.

O buffer guarda PCM cru e só codifica WAV na hora de salvar — por isso "últimos 30s" são exatamente 30s. Gravações entram direto na biblioteca.

## Onde ficam os dados

`%APPDATA%\soundFrog\`

- `soundfrog.json` — biblioteca, páginas, atalhos e preferências
- `recordings\` — o que você gravou

A biblioteca guarda **caminhos**, não cópias: se você mover ou apagar o arquivo original, o som para de tocar.

## Estrutura

```
src/
├─ main/           processo principal (Node)
│  ├─ main.js      janela, bandeja, IPC, importação de arquivos
│  ├─ hotkeys.js   atalhos globais
│  └─ store.js     persistência em JSON
├─ preload/        ponte segura (contextIsolation, sem Node na UI)
└─ renderer/       interface
   ├─ audio.js     motor de saída dupla  ← o núcleo
   ├─ recorder.js  ring buffer PCM + encoder WAV
   └─ app.js       biblioteca, hotbar, controles
```

## Limitações conhecidas

- Só Windows por enquanto (o loopback de sistema depende da implementação do Chromium nessa plataforma).
- Sem cabo virtual instalado, o app ainda toca os sons no fone — mas nada chega ao microfone.
- Algumas hotkeys são capturadas por jogos em tela cheia exclusiva antes de chegarem ao Windows.

## Licença

MIT
