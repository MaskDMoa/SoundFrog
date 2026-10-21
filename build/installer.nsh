; Passos extras do instalador do soundFrog.
;
; Embutir o pacote VB-CABLE original e sem modificações foi autorizado por
; Vincent Burel (VB-Audio Software) para uso estritamente NÃO COMERCIAL.
; A autorização vale para esta versão do VB-CABLE e para este contexto.
; Veja vendor/README.md.
;
; O driver é instalado pelo VBCABLE_Setup da própria VB-Audio, a partir do zip
; original: não alteramos nem reempacotamos nada. O instalador deles é gráfico
; e não aceita modo silencioso, então ele abre e pede um clique.
;
; Nota sobre o gancho de página: o electron-builder expõe
; `customPageAfterChangeDir`, mas nesta versão (25.1.8) o `Page custom`
; inserido por ele não chega a ser exibido — testado com um MessageBox de
; sondagem dentro da função da página, que nunca apareceu, tanto com o macro
; dentro quanto fora da guarda de BUILD_UNINSTALLER. Por isso a pergunta
; sobre o cabo vive em `customInstall`, que foi verificado executando
; de fato (sonda gravando arquivo marcador durante a instalacao).

; Este arquivo é incluído antes de o template puxar as bibliotecas, então
; ${If} ainda não existiria. LogicLib tem guarda contra inclusão dupla.
!include LogicLib.nsh

!macro customInstall
  ; O cabo pode já existir, de outro app ou de instalação anterior: nesse
  ; caso não há nada a fazer, e reinstalar custaria outro reboot à toa.
  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if (Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $$_.Name -match \"CABLE (Input|Output)\" }) { exit 10 } else { exit 0 }"'
  Pop $0   ; código de saída
  Pop $1   ; saída do comando: ExecToStack empilha dois valores

  ${If} $0 == 10
    DetailPrint "Cabo de áudio virtual já instalado, nada a fazer."
    Goto vbcable_done
  ${EndIf}

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "O soundFrog toca cada som em dois lugares ao mesmo tempo: no seu fone e em um microfone virtual, que é o que o Discord escuta.$\r$\n$\r$\n\
Esse microfone virtual é o VB-CABLE, da VB-Audio Software, e já acompanha este instalador. Deseja instalá-lo agora?$\r$\n$\r$\n\
O instalador da VB-Audio vai abrir: clique em $\"Install Driver$\" e confirme a permissão do Windows. Depois será preciso reiniciar o computador.$\r$\n$\r$\n\
Sem o cabo o soundFrog funciona, mas os sons tocam só no seu fone. Dá para instalar depois, pelo próprio aplicativo." \
    IDNO vbcable_skip

  DetailPrint "Abrindo o instalador do VB-CABLE (VB-Audio Software)..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\vendor\install-vbcable.ps1" -Zip "$INSTDIR\resources\vendor\VBCABLE_Driver_Pack45.zip"'
  Pop $0

  ${If} $0 == 0
    DetailPrint "VB-CABLE instalado. Reinicie o computador para concluir."
  ${ElseIf} $0 == 1223
    DetailPrint "Permissão negada. Dá para instalar depois pelo soundFrog."
  ${Else}
    DetailPrint "VB-CABLE retornou código $0. Dá para instalar depois pelo soundFrog."
  ${EndIf}
  Goto vbcable_done

  vbcable_skip:
    DetailPrint "VB-CABLE não instalado, a pedido do usuário."

  vbcable_done:
!macroend

; O cabo é um driver do sistema e outros programas podem estar usando:
; desinstalar o soundFrog não mexe nele.
!macro customUnInstall
  DetailPrint "O VB-CABLE não foi removido: outros programas podem usá-lo."
  DetailPrint "Para removê-lo, use Configurações > Aplicativos > VB-CABLE."
!macroend
