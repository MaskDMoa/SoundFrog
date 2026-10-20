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

## O que ele faz

- **Hotbar** de 9 páginas × 12 slots, com hotkeys globais `F1`–`F12`
- **Saída dupla**: o mesmo som no microfone virtual e no seu fone
- **Passagem de voz**: manda seu microfone real para o mesmo cabo, então o Discord ouve você *e* os sons — sem VoiceMeeter
- **Destino por disparo**: ambos, só mic ou só fone (`Shift`+clique = prévia só no fone)
- **Editor**: cortar início/fim, fade in/out, volume e normalização, com forma de onda
- **Reprodução**: pausar, continuar e avançar dentro do som
- **Biblioteca**: busca, categorias, import de arquivo ou pasta
- **Auto-keys**: distribui os sons soltos pelos slots vazios de uma vez
- **Gravação**: microfone ou áudio do sistema, com replay buffer dos últimos 30s
- **Falar (TTS)**: digite e sua fala sai no microfone, usando as vozes do Windows

## O cabo de áudio virtual já vem junto

O instalador pergunta se você quer instalar o **VB-CABLE**, que cria o par `CABLE Input` / `CABLE Output`. Você não precisa baixar nada. Quem recusar pode instalar depois pelo próprio app — ele detecta a ausência e mostra um botão.

> VB-CABLE é da **VB-Audio Software** ([vb-cable.com](https://vb-cable.com)), incluído **sem modificações** com autorização de Vincent Burel para **uso não comercial**. É donationware — [considere doar](https://vb-audio.com/Services/licensing.htm).
> Se você for fazer fork comercial, leia [vendor/README.md](vendor/README.md) antes: a autorização não se estende a você.

Depois do cabo instalado e do PC reiniciado:

1. Na aba **Dispositivos**, escolha `CABLE Input` em **Vai pro microfone**.
2. Em **Você ouve em**, escolha seu fone.
3. No Discord/OBS/jogo, defina o microfone como `CABLE Output`.
4. Na aba **Sua voz**, escolha seu microfone real e ligue a **Passagem**. Agora o Discord ouve você e os sons pelo mesmo dispositivo.

> Sem a passagem ligada, o app de voz ouve **só os sons**. A passagem substitui o VoiceMeeter: o soundFrog abre seu microfone e o reinjeta no cabo em tempo real.
>
> O cancelamento de eco fica desligado de propósito nessa passagem — ele compara a entrada com a saída padrão e tentaria cancelar os próprios sons do soundboard, deixando sua voz oca. Se precisar de supressão de ruído, ela continua ativa.

## Baixar

Vá em **[Releases](../../releases)**, abra a versão mais recente e baixe o `soundFrog-Setup-X.Y.Z.exe` em *Assets*. Rode o arquivo e pronto.

> O instalador não é assinado digitalmente (um certificado de code signing custa a partir de ~US$ 200/ano). O Windows vai mostrar o aviso **"O Windows protegeu o computador"** — clique em *Mais informações* → *Executar assim mesmo*. Isso vale para quem baixar seu app também, então avise na descrição da release.

## Compilar você mesmo

```bash
npm install
npm start        # roda em modo dev
npm run dist     # gera o instalador em dist/
```

Requer Node.js 18+. O instalador sai em `dist/soundFrog-Setup-<versão>.exe`.

## Publicar uma nova versão

O [workflow de release](.github/workflows/release.yml) compila no Windows e publica sozinho. Basta marcar a versão:

```bash
# 1. suba a versão no package.json (0.1.0 -> 0.2.0)
npm version minor -m "chore: versao %s"

# 2. empurre o commit e a tag
git push origin main --follow-tags
```

A tag `v*` dispara o build; em poucos minutos a Release aparece com o `.exe` anexado. Para republicar sem mexer na versão, rode o workflow manualmente em *Actions → Release → Run workflow*.

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
├─ main/              processo principal (Node)
│  ├─ main.js         janela, bandeja, IPC, importação de arquivos
│  ├─ hotkeys.js      atalhos globais
│  ├─ tts.js          síntese de fala via SAPI do Windows
│  └─ store.js        persistência em JSON
├─ preload/           ponte segura (contextIsolation, sem Node na UI)
└─ renderer/          interface
   ├─ audio.js        motor Web Audio de saída dupla  ← o núcleo
   ├─ passthrough.js  seu microfone real → cabo virtual
   ├─ recorder.js     ring buffer PCM + encoder WAV
   └─ app.js          biblioteca, hotbar, editor, controles
```

Duas decisões que não são óbvias no código:

- **Web Audio, não `<audio>`.** Trim e fade precisam de `AudioBufferSourceNode.start(when, offset, duration)` e de rampas num `GainNode`; elemento de mídia não dá esse controle.
- **TTS pelo SAPI, não pela Web Speech API.** A API do Chromium toca sempre na saída padrão e ignora `setSinkId`, então a fala nunca chegaria ao cabo virtual. O SAPI gera um `.wav` que passa pelo motor normal.

## Limitações conhecidas

- Só Windows por enquanto (o loopback de sistema depende da implementação do Chromium nessa plataforma).
- Sem cabo virtual instalado, o app ainda toca os sons no fone — mas nada chega ao microfone.
- Algumas hotkeys são capturadas por jogos em tela cheia exclusiva antes de chegarem ao Windows.

## Licença

MIT
