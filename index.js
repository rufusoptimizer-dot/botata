const mineflayer = require('mineflayer');
const { randomInt } = require('node:crypto');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');

const CONNECT_DELAY_MS = 10_000;
const ANTI_AFK_INTERVAL_MS = 60_000;
const ANTI_AFK_JUMP_MS = 300;
const CHAT_INTERVAL_MS = 30_000;

const rl = readline.createInterface({ input, output });
const bots = [];
const spawnedBots = new Map();
let chatInterval;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function startChatLoop() {
  if (chatInterval || spawnedBots.size < 2) return;

  const dialogue = [
    'Ciao {target}, come va?',
    'Bene, grazie! Sto esplorando vicino allo spawn.',
    'Hai trovato qualcosa di interessante?',
    'Sì, sto raccogliendo risorse per costruire una base.',
  ];
  let turn = 0;

  console.log('Chat di prova avviata: un messaggio ogni 30 secondi.');
  chatInterval = setInterval(() => {
    const participants = [...spawnedBots.entries()];
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

function generatePlayerNames(count) {
  const adjectives = ['Misty', 'Pixel', 'Lucky', 'Swift', 'Cozy', 'Brave', 'Frosty', 'Sunny', 'Silent', 'Copper', 'Mellow', 'Dusty', 'Clever', 'Velvet'];
  const nouns = ['Fox', 'Miner', 'Birch', 'Badger', 'Otter', 'Raven', 'Clover', 'Pebble', 'Comet', 'Harbor', 'Moss', 'Panda', 'Maple', 'Waffle'];
  const names = new Set();
  const maxUniqueNames = adjectives.length * nouns.length * 90;

  if (count > maxUniqueNames) {
    throw new Error(`Impossibile generare più di ${maxUniqueNames} nomi univoci.`);
  }

  while (names.size < count) {
    const adjective = adjectives[randomInt(adjectives.length)];
    const noun = nouns[randomInt(nouns.length)];
    const number = randomInt(10, 100);
    names.add(`${adjective}${noun}${number}`);
  }

  return [...names];
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

  bot.once('spawn', () => {
    console.log(`[${username}] Connesso a ${host}:${port}.`);
    spawnedBots.set(username, bot);
    startChatLoop();
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

  const usernames = generatePlayerNames(config.count);
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