; Integração do VB-CABLE no instalador do soundFrog.
;
; Embutir o pacote VB-CABLE original e sem modificações foi autorizado por
; Vincent Burel (VB-Audio Software) para uso estritamente NÃO COMERCIAL.
; A autorização vale para esta versão do VB-CABLE e para este contexto.
; Qualquer uso comercial exige nova autorização formal. Veja vendor/README.md.
;
; O driver é instalado pelo VBCABLE_Setup_x64.exe da própria VB-Audio, a
; partir do zip original. Não alteramos nem reempacotamos nada, e por isso
; não dá para rodar em silêncio: o instalador deles é gráfico e não aceita
; flag de modo silencioso. Ele abre sozinho e pede um clique em
; "Install Driver".

!macro customInstall
  ; Se o cabo já existe, não mexe: reinstalar custaria outro reboot à toa.
  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if (Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $$_.Name -match \"CABLE (Input|Output)\" }) { exit 10 } else { exit 0 }"'
  Pop $0
  ${If} $0 == 10
    DetailPrint "Cabo de áudio virtual já instalado, pulando."
    Goto vbcable_done
  ${EndIf}

  DetailPrint "Abrindo o instalador do VB-CABLE (VB-Audio Software)..."
  MessageBox MB_OK|MB_ICONINFORMATION \
    "Agora vai abrir o instalador do cabo de áudio virtual VB-CABLE, necessário para o Discord ouvir os sons.$\r$\n$\r$\n\
Clique em $\"Install Driver$\" na janela que aparecer e confirme a permissão do Windows.$\r$\n$\r$\n\
Depois reinicie o computador."

  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\vendor\install-vbcable.ps1" -Zip "$INSTDIR\resources\vendor\VBCABLE_Driver_Pack45.zip"'
  Pop $0

  ${If} $0 == 0
    DetailPrint "VB-CABLE instalado. Reinicie o computador para concluir."
  ${ElseIf} $0 == 1223
    DetailPrint "Permissão negada. Dá para instalar depois pelo próprio soundFrog."
  ${Else}
    DetailPrint "VB-CABLE retornou código $0. Dá para instalar depois pelo soundFrog."
  ${EndIf}

  vbcable_done:
!macroend
