# vendor/

## VBCABLE_Driver_Pack45.zip

Pacote **original e não modificado** do VB-CABLE, redistribuído conforme a licença do autor.

- **Origem:** https://vb-audio.com/Cable/ — www.vb-cable.com
- **Autor:** Vincent Burel / JS-Loezic — Copyright © V.Burel 2010-2024, todos os direitos reservados
- **SHA-256:** `b950e39f01af1d04ea623c8f6d8eb9b6ea5c477c637295fabf20631c85116bfb`

### VB-CABLE é donationware

Se você usa o soundFrog, considere **doar para a VB-Audio**: https://vb-audio.com/Services/licensing.htm
Eles mantêm o driver que faz nosso soundboard chegar ao Discord.

### Autorização de embutimento

Em **20/10/2026**, Vincent Burel (VB-Audio Software) autorizou por e-mail o embutimento do pacote
VB-CABLE original e sem modificações dentro do instalador NSIS do soundFrog, **sob a condição de
uso estritamente não comercial**. A autorização vale para a versão atual do VB-CABLE e para esse
contexto; qualquer mudança de uso, incluindo comercialização futura, exige nova autorização formal.

> ⚠️ **Atenção a quem fizer fork:** o código do soundFrog é MIT, que permite uso comercial — mas
> essa permissão **não se estende ao VB-CABLE**. Se você pretende vender ou monetizar um derivado,
> remova o pacote de `vendor/` e peça sua própria autorização em
> https://vb-audio.com/Services/contact.htm

### O que a licença base permite

O `readme.txt` dentro do pacote diz:

> As the VB-CABLE is a donationware, it is also allowed to copy and diffuse the VB-CABLE package
> AS IS without any modification. It is not allowed to integrate the VB-CABLE package in another
> software installation procedure without Author agreement.

Por isso:

- ✅ O arquivo aqui está **byte a byte idêntico** ao distribuído pela VB-Audio. Não descompactamos,
  não recompactamos, não alteramos nada.
- ✅ O soundFrog extrai esse zip e executa o `VBCABLE_Setup_x64.exe` **da própria VB-Audio**,
  com a interface e o UAC dela. Quem instala é o instalador oficial.
- ✅ O instalador do soundFrog oferece instalar o cabo, sob a autorização descrita acima. A pergunta
  é opcional: quem recusar instala depois pelo próprio app.
