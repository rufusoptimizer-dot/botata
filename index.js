const mineflayer = require('mineflayer');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

const CONNECT_DELAY_MS = 10_000;
const ANTI_AFK_INTERVAL_MS = 60_000;
const ANTI_AFK_JUMP_MS = 300;
const DEFAULT_CHAT_INTERVAL_SECONDS = 30;
const MAX_TIMER_MS = 2_147_483_647;
const DEFAULT_CHAT_MESSAGES = [
  'Ciao {target}, come va?',
  'Bene, grazie! Sto esplorando vicino allo spawn.',
  'Hai trovato qualcosa di interessante?',
  'Sì, sto raccogliendo risorse per costruire una base.',
];
const AUTH_COMMAND_DELAY_MS = 1500;
const AUTH_CONFIRM_TIMEOUT_MS = 5000;
const LOGIN_AFTER_REGISTER_DELAY_MS = 2000;
const BOT_PASSWORD = process.env.BOT_PASSWORD?.trim();

const rl = readline.createInterface({ input, output });
const bots = [];
const spawnedBots = new Map();
let chatInterval;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getChatMessages() {
  const raw = process.env.CHAT_MESSAGES;
  if (raw === undefined) return DEFAULT_CHAT_MESSAGES;

  const messages = raw
    .split('|')
    .map((message) => message.trim())
    .filter((message) => message !== '');
  return messages.length > 0 ? messages : DEFAULT_CHAT_MESSAGES;
}

function getChatIntervalSeconds() {
  const raw = process.env.CHAT_INTERVAL_SECONDS?.trim();
  if (!raw) return DEFAULT_CHAT_INTERVAL_SECONDS;

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > MAX_TIMER_MS) {
    console.warn(
      `CHAT_INTERVAL_SECONDS non valida ("${raw}"): uso il valore predefinito di ${DEFAULT_CHAT_INTERVAL_SECONDS} secondi.`,
    );
    return DEFAULT_CHAT_INTERVAL_SECONDS;
  }
  return seconds;
}

const CHAT_INTERVAL_SECONDS = getChatIntervalSeconds();
const CHAT_INTERVAL_MS = CHAT_INTERVAL_SECONDS * 1000;

function startChatLoop() {
  if (chatInterval || [...spawnedBots.values()].filter((bot) => bot.loggedIn).length < 2) return;

  const dialogue = getChatMessages();
  let turn = 0;

  console.log(`Chat di prova avviata: un messaggio ogni ${CHAT_INTERVAL_SECONDS} secondi.`);
  chatInterval = setInterval(() => {
    const participants = [...spawnedBots.entries()].filter(([, bot]) => bot.loggedIn);
    if (participants.length < 2) {
      clearInterval(chatInterval);
      chatInterval = undefined;
      return;
    }

    const speakerIndex = turn % participants.length;
    const [username, bot] = participants[speakerIndex];
    const [target] = participants[(speakerIndex + 1) % participants.length];
    const line = dialogue[turn % dialogue.length].replace('{target}', target);
    try {
      bot.chat(`[Test] ${line}`);
      console.log(`[${username}] [Test] ${line}`);
    } catch (error) {
      console.error(`[${username}] Invio chat fallito: ${error.message}`);
    }
    turn += 1;
  }, CHAT_INTERVAL_MS);
}

function generateBotNames(count) {
  const width = count > 99 ? 3 : 2;
  return Array.from({ length: count }, (_, index) => `Bot${String(index + 1).padStart(width, '0')}`);
}

function printableReason(reason) {
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

async function askPort() {
  while (true) {
    const answer = (await rl.question('Porta del server [25565]: ')).trim();
    if (answer === '') return 25565;

    const port = Number(answer);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
    console.log('Inserisci una porta intera tra 1 e 65535.');
  }
}

async function askBotCount() {
  while (true) {
    const answer = (await rl.question('Numero di bot [minimo 1, predefinito 2]: ')).trim();
    if (answer === '') return 2;
    const count = Number(answer);
    if (Number.isInteger(count) && count >= 1) return count;
    console.log('Inserisci un numero intero maggiore o uguale a 1.');
  }
}

function getEnvironmentConfig() {
  const host = process.env.MINECRAFT_HOST?.trim();
  const portValue = process.env.MINECRAFT_PORT || '25565';
  const countValue = process.env.BOT_COUNT || '2';
  const versionValue = process.env.MINECRAFT_VERSION?.trim();
  const port = Number(portValue);
  const count = Number(countValue);

  if (!host) throw new Error('Imposta la variabile MINECRAFT_HOST con l’host del server.');
  if (!BOT_PASSWORD) throw new Error('Imposta BOT_PASSWORD con la password dei bot.');
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MINECRAFT_PORT deve essere un intero tra 1 e 65535.');
  }
  if (!/^\d+$/.test(countValue) || !Number.isInteger(count) || count < 1) {
    throw new Error('BOT_COUNT deve essere un intero maggiore o uguale a 1.');
  }
  if (process.env.ALLOW_SERVER_CONNECTIONS?.toLowerCase() !== 'true') {
    throw new Error('Per confermare l’autorizzazione imposta ALLOW_SERVER_CONNECTIONS=true.');
  }

  return { host, port, count, version: versionValue || undefined };
}

function startBot(username, host, port, version) {
  let bot;
  try {
    const options = { username, host, port };
    if (version && version.toLowerCase() !== 'auto') options.version = version;
    bot = mineflayer.createBot(options);
    bots.push(bot);
  } catch (error) {
    console.error(`[${username}] Errore durante l'avvio: ${error.message}`);
    return;
  }

  let antiAfkInterval;
  let jumpTimeout;
  let authDelayTimeout;
  let authConfirmTimeout;
  let commandsReady = false;
  let registerAttempted = false;
  let loginAfterRegisterSent = false;
  let loginAfterRegisterTimeout;
  bot.loggedIn = false;

  const markLoggedIn = () => {
    if (bot.loggedIn) return;
    bot.loggedIn = true;
    clearTimeout(authConfirmTimeout);
    spawnedBots.set(username, bot);
    startChatLoop();
  };

  const sendCommand = (command, logMessage) => {
    try {
      bot.chat(command);
      if (logMessage) console.log(`[${username}] ${logMessage}`);
    } catch (error) {
      console.error(`[${username}] Errore di autenticazione: invio comando fallito (${error.message}).`);
    }
  };

  bot.on('messagestr', (message) => {
    if (!BOT_PASSWORD || !commandsReady || bot.loggedIn) return;
    const text = String(message).toLowerCase();

    if (text.includes('successo') || text.includes('logged in') || text.includes('accesso effettuato')) {
      console.log(`[${username}] Autenticazione riuscita.`);
      markLoggedIn();
      return;
    }

    if (
      text.includes('password errata') ||
      text.includes('wrong password') ||
      text.includes('incorrect password') ||
      text.includes('password non corretta')
    ) {
      console.error(`[${username}] Errore di autenticazione: password rifiutata dal server.`);
      return;
    }

    const alreadyRegistered = text.includes('già registrat') || text.includes('gia registrat') || text.includes('already registered');
    if (!registerAttempted && !alreadyRegistered && (text.includes('/register') || text.includes('registrat'))) {
      registerAttempted = true;
      sendCommand(`/register ${BOT_PASSWORD} ${BOT_PASSWORD}`, 'Account non registrato: invio /register.');
      if (!loginAfterRegisterSent) {
        loginAfterRegisterSent = true;
        loginAfterRegisterTimeout = setTimeout(() => {
          sendCommand(`/login ${BOT_PASSWORD}`, 'Invio /login dopo la registrazione.');
        }, LOGIN_AFTER_REGISTER_DELAY_MS);
      }
    }
  });

  bot.once('spawn', () => {
    console.log(`[${username}] Connesso a ${host}:${port}.`);
    if (BOT_PASSWORD) {
      authDelayTimeout = setTimeout(() => {
        commandsReady = true;
        sendCommand(`/login ${BOT_PASSWORD}`, 'Invio /login.');
        authConfirmTimeout = setTimeout(() => {
          if (bot.loggedIn) return;
          console.warn(`[${username}] Nessuna conferma di autenticazione dopo ${AUTH_CONFIRM_TIMEOUT_MS / 1000} secondi: si procede comunque.`);
          markLoggedIn();
        }, AUTH_CONFIRM_TIMEOUT_MS);
      }, AUTH_COMMAND_DELAY_MS);
    } else {
      console.warn(`[${username}] BOT_PASSWORD non impostata: autenticazione saltata.`);
      markLoggedIn();
    }
    antiAfkInterval = setInterval(() => {
      if (bot.entity) {
        bot.setControlState('jump', true);
        jumpTimeout = setTimeout(() => bot.setControlState('jump', false), ANTI_AFK_JUMP_MS);
      }
    }, ANTI_AFK_INTERVAL_MS);
  });

  bot.on('kicked', (reason) => {
    console.warn(`[${username}] Espulso dal server: ${printableReason(reason)}`);
  });

  bot.on('error', (error) => {
    console.error(`[${username}] Errore di connessione: ${error.message}`);
  });

  bot.once('end', (reason) => {
    clearInterval(antiAfkInterval);
    clearTimeout(jumpTimeout);
    clearTimeout(authDelayTimeout);
    clearTimeout(authConfirmTimeout);
    clearTimeout(loginAfterRegisterTimeout);
    bot.loggedIn = false;
    spawnedBots.delete(username);
    if (spawnedBots.size < 2 && chatInterval) {
      clearInterval(chatInterval);
      chatInterval = undefined;
    }
    console.log(`[${username}] Disconnesso${reason ? `: ${reason}` : '.'}`);
  });
}

async function main() {
  console.log('Usa questo programma solo su server tuoi o per cui hai autorizzazione.');
  let config;
  if (process.env.MINECRAFT_HOST || !input.isTTY) {
    config = getEnvironmentConfig();
  } else {
    const hostAnswer = (await rl.question('Indirizzo IP o host del server [127.0.0.1]: ')).trim();
    const host = hostAnswer || '127.0.0.1';

    const port = await askPort();
    const count = await askBotCount();
    config = { host, port, count };
    if (count < 2) {
      console.log('Con un solo bot la conversazione tra bot non viene avviata.');
    }

    const confirmation = (await rl.question('Confermi di avere l’autorizzazione? (s/N): '))
      .trim()
      .toLowerCase();
    if (confirmation !== 's' && confirmation !== 'si') {
      console.log('Operazione annullata.');
      return;
    }
  }

  if (config.count < 2 && process.env.MINECRAFT_HOST) {
    console.log('Con un solo bot la conversazione tra bot non viene avviata.');
  }

  const usernames = generateBotNames(config.count);
  console.log(`Avvio di ${config.count} bot verso ${config.host}:${config.port}, uno ogni ${CONNECT_DELAY_MS / 1000} secondi.`);
  if (config.version) console.log(`Versione Minecraft: ${config.version}`);
  for (let index = 1; index <= config.count; index += 1) {
    startBot(usernames[index - 1], config.host, config.port, config.version);
    if (index < config.count) await sleep(CONNECT_DELAY_MS);
  }

  if (input.isTTY) console.log('Premi Ctrl+C per disconnettere i bot e terminare.');
}

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal}: disconnessione dei bot...`);
  if (chatInterval) clearInterval(chatInterval);
  for (const bot of bots) bot.quit('Client terminato');
  const exitTimer = setTimeout(() => process.exit(0), 1000);
  exitTimer.unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

main()
  .catch((error) => {
    console.error(`Errore: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());