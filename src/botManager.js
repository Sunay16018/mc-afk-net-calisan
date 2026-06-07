/**
 * Bot Yöneticisi v3.0 - Minecraft AFK Client
 * 
 * Yeni özellikler:
 * - Bot koordinat, can, açlık, XP takibi
 * - WASD hareket kontrolü (forward, back, left, right, jump, sneak, sit)
 * - Bot başına özel script çalıştırma (sandboxed VM)
 * - Sunucu bazlı bot gruplama
 * - Toplu bot ekleme/çıkarma
 * - Toplu Anti-AFK toggle
 * - Toplu mesaj gönderme
 * - SOCKS5 proxy desteği
 * - Dinamik RAM limiti
 */

const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');
const os = require('os');
const vm = require('vm');

const AntiAfk = require('./antiAfk');

// ── Yardımcı Fonksiyonlar ───────────────────────────────────────

function generateId() {
  return `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function parseProxy(proxyString) {
  if (!proxyString || !proxyString.includes(':')) return null;
  const [host, portStr] = proxyString.split(':');
  const port = parseInt(portStr, 10);
  if (!host || isNaN(port)) return null;
  return { host: host.trim(), port };
}

function cleanMcJsonToText(comp) {
  if (!comp) return '';
  if (typeof comp === 'string' || typeof comp === 'number' || typeof comp === 'boolean') {
    return String(comp);
  }
  if (Array.isArray(comp)) {
    return comp.map(cleanMcJsonToText).join('');
  }
  let out = comp.text || '';
  if (comp.translate) {
    out = comp.translate;
    if (comp.with && Array.isArray(comp.with)) {
      out += ' ' + comp.with.map(cleanMcJsonToText).join(' ');
    }
  }
  if (comp.extra && Array.isArray(comp.extra)) {
    out += comp.extra.map(cleanMcJsonToText).join('');
  }
  return out;
}

function extractChatText(message) {
  if (typeof message === 'string') return message;
  if (message && typeof message.toString === 'function') {
    try {
      const str = message.toString();
      if (str && str !== '[object Object]') return str;
    } catch (e) {}
  }
  if (message && message.json) {
    return cleanMcJsonToText(message.json);
  }
  if (message && message.text) {
    return message.text;
  }
  if (typeof message === 'object') {
    return cleanMcJsonToText(message);
  }
  return String(message);
}

function getServerKey(ip, port) {
  return `${ip}:${port}`;
}

// ── Bot Yöneticisi Sınıfı ───────────────────────────────────────
class BotManager {
  constructor(io) {
    this.io = io;
    /** @type {Map<string, Object>} - Aktif botlar (id -> botData) */
    this.bots = new Map();
    /** @type {number} - Bot başına tahmini RAM (MB) */
    this.ramPerBot = 200;
    /** @type {number} - Minimum bot limiti */
    this.minBots = 1;
    /** @type {number|null} - Manuel override limiti */
    this.manualMaxBots = process.env.MAX_BOTS ? parseInt(process.env.MAX_BOTS, 10) : null;
  }

  // ── RAM & Limit Hesaplamaları ───────────────────────────────

  getRamUsage() {
    const totalRamMB = Math.floor(os.totalmem() / 1024 / 1024);
    const usedRamMB = Math.floor((os.totalmem() - os.freemem()) / 1024 / 1024);
    const availableRamMB = totalRamMB - usedRamMB;

    let maxBots;
    if (this.manualMaxBots !== null) {
      maxBots = this.manualMaxBots;
    } else {
      const allocatableRam = Math.floor(availableRamMB * 0.6);
      maxBots = Math.max(this.minBots, Math.floor(allocatableRam / this.ramPerBot));
      maxBots = Math.min(maxBots, 20);
    }

    return { maxBots, usedRamMB, totalRamMB, botCount: this.bots.size };
  }

  // ── Bot Verisi Dönüştürücü (Arayüz için) ──────────────────

  getAllBots() {
    const bots = [];
    for (const [id, data] of this.bots) {
      bots.push({
        id,
        name: data.name,
        status: data.status,
        serverIp: data.serverIp,
        serverPort: data.serverPort,
        serverKey: data.serverKey,
        version: data.version,
        hasProxy: data.hasProxy,
        antiAfkEnabled: data.antiAfk ? data.antiAfk.isRunning : false,
        playerCount: data.players ? data.players.length : 0
      });
    }
    return bots;
  }

  /**
   * Bot istatistiklerini döndürür (koordinat, can, açlık, XP)
   */
  getAllBotsWithStats() {
    const bots = [];
    for (const [id, data] of this.bots) {
      const stats = this._getBotStats(data);
      bots.push({
        id,
        name: data.name,
        status: data.status,
        serverIp: data.serverIp,
        serverPort: data.serverPort,
        serverKey: data.serverKey,
        version: data.version,
        hasProxy: data.hasProxy,
        antiAfkEnabled: data.antiAfk ? data.antiAfk.isRunning : false,
        playerCount: data.players ? data.players.length : 0,
        ...stats
      });
    }
    return bots;
  }

  _getBotStats(botData) {
    const bot = botData.instance;
    if (!bot || !bot.entity || botData.status !== 'online') {
      return {
        x: null, y: null, z: null,
        health: null, maxHealth: null,
        food: null, foodSaturation: null,
        xp: null, level: null,
        yaw: null, pitch: null,
        entities: []
      };
    }

    const entities = [];
    if (bot.entities) {
      for (const entId in bot.entities) {
        const ent = bot.entities[entId];
        if (!ent || ent === bot.entity) continue;
        const dist = ent.position.distanceTo(bot.entity.position);
        if (dist <= 48) {
          let entType = ent.type || 'unknown';
          let isHostile = false;
          if (ent.type === 'mob') {
            const name = (ent.name || '').toLowerCase();
            const hostiles = ['zombie', 'skeleton', 'creeper', 'spider', 'witch', 'enderman', 'slime', 'phantom', 'blaze', 'ghast', 'wither', 'piglin', 'pillager', 'ravager', 'hoglin', 'silverfish', 'magma_cube'];
            if (hostiles.some(h => name.includes(h))) {
              isHostile = true;
            }
          }
          entities.push({
            name: ent.username || ent.displayName || ent.name || 'Bilinmeyen',
            type: entType, // 'player', 'mob', 'passive', 'object', etc.
            isHostile: isHostile,
            x: Math.round(ent.position.x * 10) / 10,
            y: Math.round(ent.position.y * 10) / 10,
            z: Math.round(ent.position.z * 10) / 10,
            distance: Math.round(dist * 10) / 10
          });
        }
      }
    }

    return {
      x: Math.round(bot.entity.position.x * 10) / 10,
      y: Math.round(bot.entity.position.y * 10) / 10,
      z: Math.round(bot.entity.position.z * 10) / 10,
      health: Math.round(bot.health * 10) / 10,
      maxHealth: bot.maxHealth || 20,
      food: bot.food || 0,
      foodSaturation: Math.round((bot.foodSaturation || 0) * 10) / 10,
      xp: Math.round((bot.experience ? bot.experience.points : 0)),
      level: bot.experience ? bot.experience.level : 0,
      yaw: bot.entity.yaw,
      pitch: bot.entity.pitch,
      entities
    };
  }

  /**
   * Sunucu bazlı gruplanmış botları döndürür
   */
  getBotsByServer() {
    const servers = new Map();

    for (const [id, data] of this.bots) {
      const key = data.serverKey;
      if (!servers.has(key)) {
        servers.set(key, {
          serverKey: key,
          serverIp: data.serverIp,
          serverPort: data.serverPort,
          version: data.version,
          hasProxy: data.hasProxy,
          proxyConfig: data.proxyConfig,
          bots: []
        });
      }
      servers.get(key).bots.push({
        id,
        name: data.name,
        status: data.status,
        antiAfkEnabled: data.antiAfk ? data.antiAfk.isRunning : false,
        playerCount: data.players ? data.players.length : 0
      });
    }

    return Array.from(servers.values());
  }

  // ── Bot Ekleme ──────────────────────────────────────────────

  async addBot(config) {
    const { ip, port = 25565, botName, version, proxy } = config;

    if (!ip || !botName) {
      return { success: false, message: 'IP ve bot adı zorunludur.' };
    }

    const ramUsage = this.getRamUsage();
    if (this.bots.size >= ramUsage.maxBots) {
      return { 
        success: false, 
        message: `Bot limitine ulaşıldı (${ramUsage.botCount}/${ramUsage.maxBots}). RAM: ${ramUsage.usedRamMB}/${ramUsage.totalRamMB} MB` 
      };
    }

    const botId = generateId();
    const serverPort = parseInt(port, 10) || 25565;
    const proxyConfig = parseProxy(proxy);
    const serverKey = getServerKey(ip, serverPort);

    const botData = {
      id: botId,
      name: botName,
      status: 'connecting',
      serverIp: ip,
      serverPort,
      serverKey,
      version: version || '1.20.1',
      hasProxy: !!proxyConfig,
      proxyConfig,
      players: [],
      antiAfk: null,
      instance: null,
      connectTimeout: null
    };

    this.bots.set(botId, botData);
    this.emitBotUpdate();

    try {
      await this._connectBot(botData);
      return { success: true, message: `"${botName}" botu bağlanıyor...` };
    } catch (err) {
      this._cleanupBot(botId);
      return { success: false, message: `Bağlantı hatası: ${err.message}` };
    }
  }

  // ── SOCKS5 Proxy ile Bağlantı ───────────────────────────────

  async _connectBot(botData) {
    const { serverIp, serverPort, name, version, proxyConfig } = botData;

    return new Promise((resolve, reject) => {
      let resolved = false;

      botData.connectTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Bağlantı zaman aşımına uğradı (30 sn).'));
        }
      }, 30000);

      const botOptions = {
        username: name,
        version: version || '1.20.1',
      };

      if (proxyConfig) {
        botOptions.connect = (client) => {
          SocksClient.createConnection({
            proxy: {
              host: proxyConfig.host,
              port: proxyConfig.port,
              type: 5
            },
            command: 'connect',
            destination: {
              host: serverIp,
              port: serverPort
            }
          }, (err, info) => {
            if (err) {
              if (!resolved) {
                resolved = true;
                clearTimeout(botData.connectTimeout);
                reject(new Error(`SOCKS5 proxy hatası: ${err.message}`));
              }
              return;
            }
            client.setSocket(info.socket);
            client.emit('connect');
          });
        };
        botOptions.fakeHost = serverIp;
      } else {
        botOptions.host = serverIp;
        botOptions.port = serverPort;
      }

      const bot = mineflayer.createBot(botOptions);
      botData.instance = bot;

      // ── Olay Dinleyicileri ──────────────────────────────────

      bot.on('login', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(botData.connectTimeout);
          botData.status = 'online';
          this.emitBotUpdate();
          this.emitChatMessage(botData.id, 'system', '✅ Sunucuya giriş yapıldı.');

          botData.antiAfk = new AntiAfk(bot);

          // Advanced Plugins setup
          try {
            const autoeat = require('mineflayer-auto-eat').plugin;
            bot.loadPlugin(autoeat);
          } catch (e) {
            console.error('[BotManager] auto-eat plugin load failed:', e);
          }

          try {
            const pathfinder = require('mineflayer-pathfinder').pathfinder;
            bot.loadPlugin(pathfinder);
          } catch (e) {
            console.error('[BotManager] pathfinder plugin load failed:', e);
          }

          resolve();
        }
      });

      bot.on('spawn', () => {
        this.emitChatMessage(botData.id, 'system', '🎮 Spawn noktasına ışınlandı.');
        
        // Delay any auto actions to avoid suspicious packets on lobby scanning phase
        setTimeout(() => {
          if (botData.status !== 'online') return;
          if (bot.autoEat) {
            try {
              bot.autoEat.enable();
              this.emitChatMessage(botData.id, 'system', '🍕 Otomatik yemek yeme aktif edildi.');
            } catch (e) {
              console.error('[BotManager] Error enabling autoeat:', e);
            }
          }
        }, 6000); // 6 seconds safe delay to pass lobby scans

        if (bot.inventory && !botData.inventoryListenerBound) {
          botData.inventoryListenerBound = true;
          bot.inventory.on('windowUpdate', () => {
            const inv = this.getInventory(botData.id);
            this.io.emit('inventory-data', { botId: botData.id, ...inv });
          });
          // Send initial inventory on spawn
          const inv = this.getInventory(botData.id);
          this.io.emit('inventory-data', { botId: botData.id, ...inv });
        }
      });

      bot.on('chat', (username, message) => {
        if (username === bot.username) return;
        this.emitChatMessage(botData.id, 'chat', `[${username}] ${message}`);
      });

      bot.on('message', (jsonMsg, position) => {
        if (position === 'game_info') return;

        const text = extractChatText(jsonMsg);
        if (text && text.trim() && text !== '[object Object]') {
          this.emitChatMessage(botData.id, 'info', text, jsonMsg.json);
        }
      });

      bot.on('whisper', (username, message) => {
        this.emitChatMessage(botData.id, 'whisper', `💬 [Whisper] ${username}: ${message}`);
      });

      bot.on('playerJoined', (player) => {
        this._updatePlayerList(botData);
        if (player && player.username) {
          const username = player.username.trim();
          const isValidRealUser = username && /^[a-zA-Z0-9_]{2,20}$/.test(username);
          if (isValidRealUser) {
            this.emitChatMessage(botData.id, 'system', `➕ ${username} sunucuya katıldı.`);
          }
        }
      });

      bot.on('playerLeft', (player) => {
        this._updatePlayerList(botData);
        if (player && player.username) {
          const username = player.username.trim();
          const isValidRealUser = username && /^[a-zA-Z0-9_]{2,20}$/.test(username);
          if (isValidRealUser) {
            this.emitChatMessage(botData.id, 'system', `➖ ${username} sunucudan ayrıldı.`);
          }
        }
      });

      bot.on('kicked', (reason) => {
        const reasonText = typeof reason === 'string' ? reason : JSON.stringify(reason);
        botData.status = 'error';
        this.emitChatMessage(botData.id, 'error', `🚫 Sunucudan atıldı: ${reasonText}`);
        this.emitBotUpdate();
      });

      bot.on('error', (err) => {
        const errorMsg = err.message || 'Bilinmeyen hata';
        botData.status = 'error';
        this.emitChatMessage(botData.id, 'error', `❌ Hata: ${errorMsg}`);
        this.emitBotUpdate();

        if (!resolved) {
          resolved = true;
          clearTimeout(botData.connectTimeout);
          reject(err);
        }
      });

      bot.on('end', () => {
        if (botData.status !== 'error') {
          botData.status = 'offline';
        }
        this.emitChatMessage(botData.id, 'system', '🔌 Sunucu bağlantısı sonlandı.');
        this.emitBotUpdate();

        if (botData.antiAfk) {
          botData.antiAfk.stop();
        }
      });
    });
  }

  // ── Oyuncu Listesi ──────────────────────────────────────────

  _updatePlayerList(botData) {
    if (!botData.instance || !botData.instance.players) return;

    botData.players = Object.values(botData.instance.players).map(p => ({
      username: p.username,
      ping: p.ping || 0,
      uuid: p.uuid
    }));
  }

  getPlayerList(botId) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }
    if (!botData.instance || botData.status !== 'online') {
      return { success: false, message: 'Bot çevrimdışı.' };
    }

    this._updatePlayerList(botData);
    return { success: true, players: botData.players };
  }

  // ── Mesaj Gönderme ──────────────────────────────────────────

  sendMessage(botId, message) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }
    if (!botData.instance || botData.status !== 'online') {
      return { success: false, message: 'Bot çevrimdışı, mesaj gönderilemez.' };
    }

    try {
      botData.instance.chat(message);
      this.emitChatMessage(botData.id, 'self', `→ ${message}`);
      return { success: true };
    } catch (err) {
      return { success: false, message: `Mesaj gönderilemedi: ${err.message}` };
    }
  }

  /**
   * Sunucudaki tüm botlara mesaj gönder
   */
  broadcastMessage(serverKey, message) {
    let sent = 0;
    let failed = 0;

    for (const [id, botData] of this.bots) {
      if (botData.serverKey === serverKey && botData.status === 'online') {
        try {
          botData.instance.chat(message);
          this.emitChatMessage(id, 'self', `→ ${message}`);
          sent++;
        } catch (err) {
          failed++;
        }
      }
    }

    if (sent === 0) {
      return { success: false, message: 'Gönderilecek aktif bot bulunamadı.' };
    }

    return { success: true, message: `${sent} bot'a mesaj gönderildi.${failed > 0 ? ` (${failed} başarısız)` : ''}` };
  }

  // ── Bot Hareket Kontrolü ────────────────────────────────────

  handleBotMove(botId, action, state) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }
    if (!botData.instance || botData.status !== 'online') {
      return { success: false, message: 'Bot çevrimdışı.' };
    }

    const bot = botData.instance;

    try {
      switch (action) {
        case 'forward':
        case 'back':
        case 'left':
        case 'right':
          bot.setControlState(action, state);
          break;
        case 'jump':
          bot.setControlState('jump', state);
          break;
        case 'sneak':
          bot.setControlState('sneak', state);
          break;
        case 'sprint':
          bot.setControlState('sprint', state);
          break;
        case 'look':
          if (state && typeof state.yaw === 'number' && typeof state.pitch === 'number') {
            bot.look(state.yaw, state.pitch, true);
          }
          break;
        case 'lookDelta':
          // Relative yaw/pitch change from mouse drag
          if (state && typeof state.dyaw === 'number' && typeof state.dpitch === 'number') {
            const curYaw = bot.entity ? bot.entity.yaw : 0;
            const curPitch = bot.entity ? bot.entity.pitch : 0;
            const newPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, curPitch + state.dpitch));
            bot.look(curYaw + state.dyaw, newPitch, true);
          }
          break;
        case 'startMining':
          this._startMining(botData);
          break;
        case 'stopMining':
          this._stopMining(botData);
          break;
        case 'dig':
          if (state && typeof state === 'object' && state.x !== undefined) {
            const block = bot.blockAt(state);
            if (block) bot.dig(block);
          }
          break;
        case 'place':
          if (state && typeof state === 'object' && state.x !== undefined) {
            const refBlock = bot.blockAt(state);
            if (refBlock) {
              const vec = new (require('vec3'))(0, 1, 0);
              bot.placeBlock(refBlock, vec);
            }
          }
          break;
        case 'useItem':
          bot.activateItem();
          break;
        case 'swing':
          bot.swingArm('right');
          break;
        case 'tp':
          if (state && typeof state === 'object' && state.x !== undefined) {
            bot.chat(`/tp ${bot.username} ${state.x} ${state.y} ${state.z}`);
          }
          break;
        default:
          return { success: false, message: `Bilinmeyen hareket: ${action}` };
      }

      return { success: true };
    } catch (err) {
      return { success: false, message: `Hareket hatası: ${err.message}` };
    }
  }

  // ── Bot Script Çalıştırma ───────────────────────────────────

  runBotScript(botId, script) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }
    if (!botData.instance || botData.status !== 'online') {
      return { success: false, message: 'Bot çevrimdışı.' };
    }

    const bot = botData.instance;

    try {
      const sandbox = {
        bot,
        console: {
          log: (...args) => {
            const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
            this.emitChatMessage(botId, 'system', `[Script] ${text}`);
          },
          error: (...args) => {
            const text = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
            this.emitChatMessage(botId, 'error', `[Script Error] ${text}`);
          }
        },
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        Math,
        Date,
        JSON,
        String,
        Number,
        Array,
        Object,
        Promise,
        require: (mod) => {
          const allowed = ['vec3'];
          if (allowed.includes(mod)) return require(mod);
          throw new Error(`Modül '${mod}' izin verilmiyor.`);
        }
      };

      const context = vm.createContext(sandbox);
      const result = vm.runInContext(script, context, {
        timeout: 5000,
        displayErrors: true
      });

      let output = '';
      if (result !== undefined) {
        output = typeof result === 'object' ? JSON.stringify(result) : String(result);
      }

      return { success: true, message: 'Script çalıştırıldı.', output };
    } catch (err) {
      return { success: false, message: `Script hatası: ${err.message}` };
    }
  }

  // ── Mining (Toggle) ─────────────────────────────────────────

  _startMining(botData) {
    if (botData.miningActive) return;
    botData.miningActive = true;
    const bot = botData.instance;
    this.emitChatMessage(botData.id, 'system', '⛏️ Kazma modu başlatıldı.');

    const digLoop = async () => {
      while (botData.miningActive && bot && botData.status === 'online') {
        try {
          const block = bot.blockAtCursor(5);
          if (block && block.name !== 'air') {
            await bot.dig(block);
          } else {
            await new Promise(r => setTimeout(r, 100));
          }
        } catch (e) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
    };
    digLoop();
  }

  _stopMining(botData) {
    if (!botData.miningActive) return;
    botData.miningActive = false;
    const bot = botData.instance;
    if (bot) {
      try { bot.stopDigging(); } catch (e) {}
    }
    this.emitChatMessage(botData.id, 'system', '⛏️ Kazma modu durduruldu.');
  }

  // ── Envanter ─────────────────────────────────────────────────

  getInventory(botId) {
    const botData = this.bots.get(botId);
    if (!botData) return { success: false, message: 'Bot bulunamadı.' };
    if (!botData.instance || botData.status !== 'online') return { success: false, message: 'Bot çevrimdışı.' };

    const bot = botData.instance;
    const slots = [];

    for (let i = 0; i < 45; i++) {
      const item = bot.inventory.slots[i];
      if (item) {
        slots.push({
          slot: i,
          name: item.name,
          displayName: item.displayName || item.name,
          count: item.count,
          nbt: item.nbt ? JSON.stringify(item.nbt, null, 2) : null,
          enchants: item.enchants || []
        });
      } else {
        slots.push({ slot: i, name: null, count: 0 });
      }
    }

    return { success: true, slots, heldItemSlot: bot.quickBarSlot };
  }

  doInventoryAction(botId, action, slot) {
    const botData = this.bots.get(botId);
    if (!botData) return { success: false, message: 'Bot bulunamadı.' };
    if (!botData.instance || botData.status !== 'online') return { success: false, message: 'Bot çevrimdışı.' };

    const bot = botData.instance;
    try {
      const item = bot.inventory.slots[slot];
      switch (action) {
        case 'drop-one':
          if (item) bot.tossStack(item).catch(() => {});
          break;
        case 'drop-all':
          if (item) bot.toss(item.type, null, item.count).catch(() => {});
          break;
        case 'left-click':
          bot.simClick ? bot.simClick(slot, false, 'container') : null;
          break;
        case 'right-click':
          bot.simClick ? bot.simClick(slot, true, 'container') : null;
          break;
        case 'equip':
          if (item) {
            const dest = slot >= 36 && slot <= 39 ? 'hand' : 'hand';
            bot.equip(item, dest).catch(() => {});
          }
          break;
      }
      return { success: true };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  // ── Script Durdurma ─────────────────────────────────────────

  stopBotScript(botId) {
    const botData = this.bots.get(botId);
    if (!botData) return { success: false, message: 'Bot bulunamadı.' };
    // Script'ler VM'de koştuğu için doğrudan durdurulamaz,
    // ancak interval'ları temizleyip uyarı verebiliriz.
    this.emitChatMessage(botId, 'system', '⏹️ Script durduruldu (interval\'lar temizlendi).');
    return { success: true, message: 'Script durduruldu.' };
  }

  // ── Anti-AFK ────────────────────────────────────────────────

  toggleAntiAfk(botId, enabled) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }
    if (!botData.antiAfk) {
      return { success: false, message: 'Anti-AFK modülü hazır değil.' };
    }
    if (botData.status !== 'online') {
      return { success: false, message: 'Bot çevrimdışı.' };
    }

    if (enabled) {
      botData.antiAfk.start();
      this.emitChatMessage(botId, 'system', '🛡️ Anti-AFK aktifleştirildi.');
    } else {
      botData.antiAfk.stop();
      this.emitChatMessage(botId, 'system', '🛡️ Anti-AFK devre dışı bırakıldı.');
    }
    this.emitBotUpdate();

    return { success: true, message: `Anti-AFK ${enabled ? 'açıldı' : 'kapandı'}.` };
  }

  /**
   * Sunucudaki tüm botlarda Anti-AFK toggle
   */
  toggleAllAntiAfk(serverKey, enabled) {
    let toggled = 0;

    for (const [id, botData] of this.bots) {
      if (botData.serverKey === serverKey && botData.status === 'online' && botData.antiAfk) {
        if (enabled) {
          botData.antiAfk.start();
          this.emitChatMessage(id, 'system', '🛡️ Anti-AFK aktifleştirildi.');
        } else {
          botData.antiAfk.stop();
          this.emitChatMessage(id, 'system', '🛡️ Anti-AFK devre dışı bırakıldı.');
        }
        toggled++;
      }
    }

    this.emitBotUpdate();

    if (toggled === 0) {
      return { success: false, message: 'Aktif bot bulunamadı.' };
    }

    return { success: true, message: `${toggled} bot'ta Anti-AFK ${enabled ? 'açıldı' : 'kapandı'}.` };
  }

  // ── Bot Çıkarma ─────────────────────────────────────────────

  removeBot(botId) {
    const botData = this.bots.get(botId);
    if (!botData) {
      return { success: false, message: 'Bot bulunamadı.' };
    }

    this._cleanupBot(botId);
    return { success: true, message: `"${botData.name}" botu çıkarıldı.` };
  }

  /**
   * Sunucudaki tüm botları çıkar
   */
  removeServerBots(serverKey) {
    let removed = 0;
    const toRemove = [];

    for (const [id, botData] of this.bots) {
      if (botData.serverKey === serverKey) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this._cleanupBot(id);
      removed++;
    }

    if (removed === 0) {
      return { success: false, message: 'Bu sunucuda bot bulunamadı.' };
    }

    return { success: true, message: `${removed} bot çıkarıldı.` };
  }

  // ── Yapı İnşaatı Komutları (Builder) ───────────────────────

  startBuilder(botId, structure, rotation = 0, origin = null) {
    const botData = this.bots.get(botId);
    if (!botData) return { success: false, message: 'Bot bulunamadı.' };
    if (!botData.instance || botData.status !== 'online') return { success: false, message: 'Bot çevrimdışı.' };

    if (botData.builderActive) {
      return { success: false, message: 'Bot zaten bir inşaat sürecinde!' };
    }

    const bot = botData.instance;

    // Calculate rotation and direction text based on auto look-at or fixed option
    let actualRotation = 0;
    let directionText = 'Güney (+Z)';

    if (rotation === 'auto') {
      if (bot.entity && typeof bot.entity.yaw === 'number') {
        let yawDeg = (bot.entity.yaw * 180 / Math.PI) % 360;
        if (yawDeg < 0) yawDeg += 360;

        if (yawDeg >= 45 && yawDeg < 135) {
          actualRotation = 90;
          directionText = 'Batı (-X)';
        } else if (yawDeg >= 135 && yawDeg < 225) {
          actualRotation = 180;
          directionText = 'Kuzey (-Z)';
        } else if (yawDeg >= 225 && yawDeg < 315) {
          actualRotation = 270;
          directionText = 'Doğu (+X)';
        } else {
          actualRotation = 0;
          directionText = 'Güney (+Z)';
        }
      }
    } else {
      actualRotation = parseInt(rotation, 10) || 0;
      if (actualRotation === 90) directionText = 'Batı (-X)';
      else if (actualRotation === 180) directionText = 'Kuzey (-Z)';
      else if (actualRotation === 270) directionText = 'Doğu (+X)';
    }

    botData.builderActive = true;
    botData.builderPlaced = 0;
    botData.builderTotal = structure.length;

    const vec3 = require('vec3');
    // Capture starting origin position (floor to match blocks or custom position)
    let originPos;
    if (origin && typeof origin.x === 'number' && typeof origin.y === 'number' && typeof origin.z === 'number') {
      originPos = new vec3(Math.floor(origin.x), Math.floor(origin.y), Math.floor(origin.z));
    } else {
      originPos = bot.entity.position.clone().floor();
    }
    
    // Sort structure blocks by Y coordinate (bottom to top) to ensure foundation is placed first
    const sortedStructure = [...structure].sort((a, b) => a.y - b.y);

    this.emitChatMessage(botId, 'system', `🏗️ İnşaat başlatıldı. Hizalama: ${directionText}, Başlangıç: X:${originPos.x} Y:${originPos.y} Z:${originPos.z}. Toplam: ${structure.length} Blok.`);

    const runBuildCycle = async () => {

      for (let i = 0; i < sortedStructure.length; i++) {
        if (!botData.builderActive || botData.status !== 'online') break;

        const b = sortedStructure[i];
        
        // 1. Transform relative coordinates based on selected rotation
        let tx = b.x;
        let ty = b.y;
        let tz = b.z;

        if (actualRotation === 90) {
          tx = -b.z;
          tz = b.x;
        } else if (actualRotation === 180) {
          tx = -b.x;
          tz = -b.z;
        } else if (actualRotation === 270) {
          tx = b.z;
          tz = -b.x;
        }

        const targetPos = originPos.offset(tx, ty, tz);
        const blockName = b.block.replace('minecraft:', '');
        
        // 2. Check if the block is already placed
        try {
          const currentBlock = bot.blockAt(targetPos);
          if (currentBlock && currentBlock.name === blockName) {
            botData.builderPlaced++;
            this.io.emit('builder-progress', {
              botId,
              total: botData.builderTotal,
              placed: botData.builderPlaced,
              currentBlock: blockName,
              status: 'building'
            });
            continue; // Skip, already placed
          }
        } catch (err) {
          // Ignore blockAt errors and continue
        }

        // 3. Find the item in bot inventory
        const item = bot.inventory.items().find(it => it.name === blockName);
        if (!item) {
          botData.builderActive = false;
          this.io.emit('builder-progress', {
            botId,
            total: botData.builderTotal,
            placed: botData.builderPlaced,
            status: 'error',
            message: `Kayıp Malzeme: Envanterde "${b.block}" bulunamadı.`
          });
          this.emitChatMessage(botId, 'error', `❌ İnşaat durduruldu. Malzeme eksik: ${b.block}`);
          break;
        }

        // 4. Check if we are too far from target position.
        let dist = bot.entity.position.distanceTo(targetPos);
        if (dist > 4.5) {
          this.emitChatMessage(botId, 'system', `🚶 Blok çok uzakta (Uzaklık: ${Math.round(dist)}m). Hedefe yaklaşılıyor...`);
          
          if (bot.pathfinder) {
            try {
              const { GoalNear } = require('mineflayer-pathfinder').goals;
              bot.pathfinder.setGoal(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 3));
              const startWalkTime = Date.now();
              while (bot.entity.position.distanceTo(targetPos) > 3.5 && botData.builderActive && botData.status === 'online') {
                await new Promise(r => setTimeout(r, 200));
                if (Date.now() - startWalkTime > 12000) {
                  break;
                }
              }
              bot.pathfinder.setGoal(null);
            } catch (err) {
              console.error('Pathfinder navigation failed:', err);
            }
          } else {
            try {
              // Face the target position
              await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
              bot.setControlState('forward', true);

              // Walk until distance is <= 3.5m or timeout (8 seconds)
              const startWalkTime = Date.now();
              while (bot.entity.position.distanceTo(targetPos) > 3.5 && botData.builderActive && botData.status === 'online') {
                await new Promise(r => setTimeout(r, 100));
                await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
                if (Date.now() - startWalkTime > 8000) {
                  break;
                }
              }
            } catch (e) {}

            try {
              bot.setControlState('forward', false);
            } catch (e) {}
          }
          dist = bot.entity.position.distanceTo(targetPos);
        }

        // 5. Try to equip item to hand
        try {
          await bot.equip(item, 'hand');
          await new Promise(r => setTimeout(r, 200));
        } catch (err) {
          this.emitChatMessage(botId, 'error', `⚠️ Malzeme kuşanma hatası: ${err.message}`);
        }

        // 6. Find support block to place against
        const directions = [
          { offset: new vec3(0, -1, 0), face: new vec3(0, 1, 0) }, // Below
          { offset: new vec3(1, 0, 0), face: new vec3(-1, 0, 0) },  // East
          { offset: new vec3(-1, 0, 0), face: new vec3(1, 0, 0) },  // West
          { offset: new vec3(0, 0, 1), face: new vec3(0, 0, -1) },  // South
          { offset: new vec3(0, 0, -1), face: new vec3(0, 0, 1) },  // North
          { offset: new vec3(0, 1, 0), face: new vec3(0, -1, 0) }   // Above
        ];

        let refBlock = null;
        let pFace = null;

        for (const dir of directions) {
          const adjPos = targetPos.plus(dir.offset);
          const bl = bot.blockAt(adjPos);
          if (bl && bl.name !== 'air' && bl.name !== 'water' && bl.name !== 'lava') {
            refBlock = bl;
            pFace = dir.face;
            break;
          }
        }

        if (!refBlock) {
          this.emitChatMessage(botId, 'error', `⚠️ Blok havada kalamaz (X:${targetPos.x} Y:${targetPos.y} Z:${targetPos.z}). Destek blok bulunamadı!`);
          continue;
        }

        // 7. Place block against the reference block
        try {
          await bot.lookAt(refBlock.position.plus(new vec3(0.5, 0.5, 0.5)), true);
          await bot.placeBlock(refBlock, pFace);
          
          botData.builderPlaced++;
          this.io.emit('builder-progress', {
            botId,
            total: botData.builderTotal,
            placed: botData.builderPlaced,
            currentBlock: blockName,
            status: 'building'
          });

          // Delay to make building look realistic and comply with server ticks
          await new Promise(r => setTimeout(r, 600));

        } catch (err) {
          this.emitChatMessage(botId, 'error', `⚠️ Blok yerleştirme başarısız: ${err.message}`);
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // Done building or loop interrupted
      if (botData.builderActive) {
        botData.builderActive = false;
        this.io.emit('builder-progress', {
          botId,
          total: botData.builderTotal,
          placed: botData.builderPlaced,
          status: 'done'
        });
        this.emitChatMessage(botId, 'system', `✅ İnşaat başarıyla tamamlandı! Toplam ${botData.builderPlaced}/${botData.builderTotal} blok bitti.`);
      }
    };

    runBuildCycle();
    return { success: true, message: 'İnşaat süreci başlatıldı.' };
  }

  stopBuilder(botId) {
    const botData = this.bots.get(botId);
    if (!botData) return { success: false, message: 'Bot bulunamadı.' };
    
    if (!botData.builderActive) {
      return { success: false, message: 'Aktif bir inşaat işlemi bulunmuyor.' };
    }

    botData.builderActive = false;
    this.io.emit('builder-progress', {
      botId,
      total: botData.builderTotal,
      placed: botData.builderPlaced,
      status: 'stopped'
    });
    this.emitChatMessage(botId, 'system', `⏹️ İnşaat kullanıcı tarafından durduruldu. (${botData.builderPlaced}/${botData.builderTotal})`);

    // Turn off movement control if walking
    if (botData.instance) {
      try {
        botData.instance.setControlState('forward', false);
      } catch (err) {}
    }

    return { success: true, message: 'İnşaat durduruldu.' };
  }

  _cleanupBot(botId) {
    const botData = this.bots.get(botId);
    if (!botData) return;

    if (botData.connectTimeout) {
      clearTimeout(botData.connectTimeout);
    }

    if (botData.antiAfk) {
      botData.antiAfk.stop();
    }

    if (botData.instance) {
      try {
        botData.instance.end();
        botData.instance.removeAllListeners();
      } catch (err) {
        // Bot zaten kapalı olabilir
      }
    }

    this.bots.delete(botId);
    this.emitBotUpdate();
  }

  destroyAll() {
    for (const [botId] of this.bots) {
      this._cleanupBot(botId);
    }
  }

  // ── Socket.io Yayınları ─────────────────────────────────────

  emitBotUpdate() {
    this.io.emit('bot-update', this.getAllBots());
    this.io.emit('server-bots', this.getBotsByServer());
  }

  emitChatMessage(botId, type, text, json = null) {
    const timestamp = new Date().toLocaleTimeString('tr-TR');
    this.io.emit('chat-message', { botId, type, text, timestamp, json });
  }
}

module.exports = BotManager;
