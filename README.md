# Bot Minecraft con Mineflayer

Script CLI Node.js per collegare un piccolo gruppo di bot a un server Minecraft. Usalo esclusivamente su un server di tua proprietà o per cui hai un'autorizzazione esplicita. Il programma limita il gruppo a 10 bot e distanzia i tentativi di connessione di 2 secondi.

## Requisiti

- Node.js 18 o successivo e npm. Scaricalo da [nodejs.org](https://nodejs.org/) oppure installalo tramite il gestore di pacchetti del tuo sistema.
- Un server Minecraft raggiungibile e l'autorizzazione a collegarvi bot. Il server deve consentire gli accessi previsti dalla sua configurazione.

Verifica l'installazione:

```bash
node --version
npm --version
```

## Installazione

Apri un terminale nella cartella del progetto ed esegui:

```bash
npm install
```

Il file `package.json` installa `mineflayer` come dipendenza. In alternativa, per installarla esplicitamente:

```bash
npm install mineflayer
```

## Avvio

```bash
npm start
```

I valori predefiniti sono `127.0.0.1` (server sul computer locale), porta `25565` e 2 bot. Premi Invio per accettare un valore o inseriscine uno diverso. A ogni bot viene assegnato un nickname casuale in stile giocatore, per esempio `MistyFox42`; i nomi sono distinti all'interno dello stesso avvio. Con almeno 2 bot connessi, si scambiano messaggi nella chat pubblica ogni 30 secondi, contrassegnati da `[Test]`. Con un solo bot la conversazione non parte. Conferma di avere l'autorizzazione per avviare le connessioni. Per usare `127.0.0.1`, il server Minecraft deve essere in esecuzione sullo stesso computer.

Inoltre, i bot analizzano i messaggi in chat e, se rilevano un prompt del tipo `register` o `login`, inviano automaticamente i comandi `/register ...` o `/login ...` usando le variabili di ambiente `REGISTER_PASSWORD`, `LOGIN_PASSWORD` o `MINECRAFT_PASSWORD` (fallback `Password123`).

Una volta entrati, i bot effettuano un breve salto ogni 60 secondi come semplice attività anti-AFK. Questo comportamento potrebbe non essere compatibile con le regole o i plugin del server. Errori, espulsioni e disconnessioni sono segnalati individualmente; `Ctrl+C` disconnette i bot e termina lo script.

## Deploy su Railway

Collega il repository GitHub a un nuovo progetto Railway e usa il comando di avvio `npm start`. Nelle variabili del servizio Railway configura:

| Variabile | Valore | Descrizione |
| --- | --- | --- |
| `MINECRAFT_HOST` | Host o IP del server | Obbligatorio |
| `MINECRAFT_PORT` | `25565` | Porta del server; opzionale se standard |
| `MINECRAFT_VERSION` | `auto` | Versione, per esempio `1.20.4`; `auto` o vuota per il rilevamento automatico |
| `BOT_COUNT` | `2` | Numero intero da 1 a 10 |
| `ALLOW_SERVER_CONNECTIONS` | `true` | Conferma esplicita di avere l'autorizzazione a collegare i bot |

Railway avvia il programma in modalità non interattiva: `MINECRAFT_HOST` e `ALLOW_SERVER_CONNECTIONS=true` sono necessari. `MINECRAFT_VERSION=auto` non forza una versione e lascia che Mineflayer la rilevi. Il servizio gestisce `SIGTERM` per disconnettere i bot durante l'arresto o il riavvio.