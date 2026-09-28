# Screen Share V2

Projeto web de transmissão de tela com:
- tela/janela/aba pelo seletor nativo do navegador
- microfone
- áudio do sistema (quando o navegador/OS oferecer)
- 480p/720p/1080p e 30/60 FPS como preferências de captura
- indicador ao vivo
- contador e pico de espectadores
- lista de espectadores
- expulsar/bloquear
- moderadores
- chat, apagar e fixar
- anti-spam básico
- salas públicas/privadas com senha
- limite de espectadores
- links personalizados
- salas temporárias
- dark mode, modo cinema, fullscreen e responsividade
- painel básico de transmissão

## Instalação

1. Instale Node.js.
2. Abra o terminal nesta pasta.
3. Rode:
   npm install
   npm start
4. Abra:
   http://localhost:3000

## Importante

Esta V2 é uma versão funcional/protótipo e usa WebRTC direto entre transmissor e espectadores. Para dezenas/centenas de espectadores, a próxima etapa recomendada é trocar o transporte de mídia por um SFU (por exemplo, LiveKit/mediasoup), além de usar HTTPS e TURN em produção.

A escolha de 480/720/1080 e 30/60 é uma preferência de captura; o navegador pode limitar o que o dispositivo realmente consegue entregar.

As salas ficam em memória e são perdidas ao reiniciar o servidor. Para produção, adicione banco de dados, autenticação, rate limiting e armazenamento persistente.


## Para seus amigos acessarem pela internet

Não use `localhost` no link enviado. O projeto precisa ser publicado em um servidor com domínio/HTTPS. O compartilhamento de tela e microfone exigem contexto seguro em navegadores, com `localhost` sendo uma exceção local. citeturn0search0turn0search4

### Variáveis opcionais de TURN

Defina no servidor:

```text
TURN_URL=turn:seu-turn.example.com:3478,turns:seu-turn.example.com:5349
TURN_USERNAME=usuario
TURN_CREDENTIAL=senha
```

O navegador receberá essas configurações em `/api/webrtc-config`.

TURN é importante quando NAT/firewalls impedem uma conexão WebRTC direta; ICE pode usar STUN/TURN para encontrar ou retransmitir uma rota. citeturn0search5turn0search8

### Importante

O TURN deve ser um servidor que você administra ou para o qual tem autorização. Não coloque uma senha TURN fixa no código do navegador. O servidor deve entregar credenciais apropriadas. citeturn0search2
