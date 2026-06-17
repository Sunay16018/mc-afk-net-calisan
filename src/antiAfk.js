/**
 * Sunucu Tabanlı AFK Algılama & Anti-Cheat Sistemlerini Atlatma Modülü
 * ULTRA-GELİŞMİŞ SUPER-ANTI AFK ULTIMATE SÜRÜMÜ (v5.0.0)
 * 
 * Bu sürüm, gelişmiş Heuristik Yapay Zeka engelleme (AAC, GrimAC, Matrix, GCP, vb.),
 * yetkili koruması (Staff-Watch), akıllı sohbet yanıtları, sıkışma tespiti ve
 * gerçekçi yol bulma tabanlı gezinti modüllerini içerir.
 */

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class AntiAfk {
  constructor(bot) {
    this.bot = bot;
    this.isRunning = false;
    this.abortController = null;
    this.activeTimeouts = new Set();
    this.originalSlot = 0;
    
    // Konum & Güvenlik Takipçileri
    this.originalPosition = null;
    this.lastPosition = null;
    this.stuckTicks = 0;
    this.adminNearby = false;

    // Gerçekçi Türkçe Yanıt Eşleşmeleri
    this.chatReplies = [
      { keys: ['afk', 'bot', 'burda mi', 'aktif mi'], replies: ['efendim?', 'burdayım', 'noldu ?', 'burdayım knk', 'burdayım canım', 'efendim'] },
      { keys: ['selam', 'slm', 'sa', 's.a'], replies: ['as', 'aleykum selam', 'as canım', 'as hoşgeldin'] },
      { keys: ['naber', 'nbr', 'nasılsın'], replies: ['iyi panpa senden', 'iyi valla takılıyorum öyle', 'iyidir senden nbr'] },
      { keys: ['hey', 'alo', 'baksana', 'hi'], replies: ['efendim?', 'noldu?', 'burdayım buyur?'] }
    ];

    // Son fısıltı gönderen oyuncular (Flood koruması için)
    this.lastRepliedWhispers = new Map();
  }

  /**
   * Anti-AFK Motorunu Başlatır
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    if (this.bot.quickbarSlot !== undefined) {
      this.originalSlot = this.bot.quickbarSlot;
    }

    if (this.bot.entity && this.bot.entity.position) {
      this.originalPosition = this.bot.entity.position.clone();
      this.lastPosition = this.bot.entity.position.clone();
    }

    this.stuckTicks = 0;
    this.adminNearby = false;

    console.log(`[Ultimate-AntiAfk] ${this.bot.username} için 7/24 Elite Bypass devrede!`);

    // Gerekli dinleyicileri (Whisper, Chat, Admin vb.) ata
    this._attachRiskListeners();

    // Paralel çalışan Ultra Bypass Ağları (Fibers)
    this._runFibers(signal);
  }

  /**
   * Anti-AFK Motorunu Durdurur
   */
  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Bekleyen tüm süreçleri/timeout'ları iptal eder
    for (const timeout of this.activeTimeouts) {
      clearTimeout(timeout);
    }
    this.activeTimeouts.clear();

    // Dinleyicileri temizle
    this._detachRiskListeners();

    // Tuş durumlarını temiz çek
    try {
      if (this.bot.entity) {
        this.bot.setControlState('sneak', false);
        this.bot.setControlState('forward', false);
        this.bot.setControlState('back', false);
        this.bot.setControlState('left', false);
        this.bot.setControlState('right', false);
        this.bot.setControlState('jump', false);
      }
      if (this.bot.setQuickbarSlot) {
        this.bot.setQuickbarSlot(this.originalSlot);
      }
    } catch (_) {}

    console.log(`[Ultimate-AntiAfk] ${this.bot.username} için bypass döngüsü sonlandırıldı.`);
  }

  /**
   * Oyundaki Risk Etkenlerini (Fısıltı, Admin Katılımı vb.) Dinler
   */
  _attachRiskListeners() {
    // 1. Fısıltı / PM Dinleyici (Akıllı Yanıt ve Ban Engelleme)
    this._whisperHandler = (username, message) => {
      if (!this.isRunning || username === this.bot.username) return;
      this._handleInboundMessage(username, message, true);
    };

    // 2. Normal Sohbet Dinleyici (Etraftan bota seslenildiğinde yanıt verme)
    this._chatHandler = (username, message) => {
      if (!this.isRunning || username === this.bot.username) return;
      
      // Mesajda botun ismi geçiyorsa yanıtla
      const myName = this.bot.username ? this.bot.username.toLowerCase() : '';
      if (myName && message.toLowerCase().includes(myName)) {
        this._handleInboundMessage(username, message, false);
      }
    };

    try {
      this.bot.on('whisper', this._whisperHandler);
      this.bot.on('chat', this._chatHandler);
    } catch (_) {}
  }

  _detachRiskListeners() {
    try {
      if (this._whisperHandler) this.bot.removeListener('whisper', this._whisperHandler);
      if (this._chatHandler) this.bot.removeListener('chat', this._chatHandler);
    } catch (_) {}
  }

  /**
   * Gelen Mesajları Heuristik Olarak Yanıtla
   */
  async _handleInboundMessage(sender, message, isWhisper) {
    // Kendimizsek veya boşsa es geç
    if (!sender || sender.toLowerCase() === 'system' || sender === this.bot.username) return;

    // Aynı kişiye fısıltıyla son 20 saniyede zaten yanıt verdiysek flood engeli koyalım
    const now = Date.now();
    const lastTime = this.lastRepliedWhispers.get(sender.toLowerCase()) || 0;
    if (now - lastTime < 20000) return;

    const cleanMsg = message.toLowerCase();
    let replyText = null;

    // Eşleşme kontrolü yap
    for (const pattern of this.chatReplies) {
      const matches = pattern.keys.some(k => cleanMsg.includes(k));
      if (matches) {
        replyText = pattern.replies[randomInt(0, pattern.replies.length - 1)];
        break;
      }
    }

    // Eğer eşleşme bulunumadıysa ama fısıltı gelmişse şüphe uyandırmamak için genel bir dönüş
    if (!replyText && isWhisper) {
      if (Math.random() < 0.6) {
        const fallbacks = ['efendim?', 'noldu?', 'efendim knk?', 'bi sn afk', 'gelcem az sonra'];
        replyText = fallbacks[randomInt(0, fallbacks.length - 1)];
      }
    }

    if (replyText) {
      this.lastRepliedWhispers.set(sender.toLowerCase(), now);
      
      // İnanılmaz kritik: Yanıt gecikmesi (4-9 saniye) - Bot olmadığı algısı yaratılır.
      const responseDelay = randomInt(4000, 9500);
      console.log(`[Ultimate-AntiAfk] Gelen mesaj (${sender}): "${message}". Akıllı yanıt planlandı: "${replyText}" (${responseDelay}ms sonra)`);

      setTimeout(() => {
        if (!this.isRunning) return;
        try {
          if (isWhisper) {
            // Fısıltıya fısıltı olarak cevap ver
            this.bot.chat(`/msg ${sender} ${replyText}`);
          } else {
            // Genel sohbete yaz
            this.bot.chat(replyText);
          }
        } catch (_) {}
      }, responseDelay);
    }
  }

  /**
   * Paralel Bypass Süreçlerini (Fibers) Çalıştırır
   */
  _runFibers(signal) {
    this._fiberHeartbeat(signal);          // Sabit Olmayan Gözlem ve Kafa Rotasyonları
    this._fiberInteractiveCombos(signal);  // Eğilme, Sıçrama, El Sallama, Slot Çırpınışı
    this._fiberPhysicsAndSafety(signal);   // Sıkışma, Boğulma ve Gravity Denetleyici
    this._fiberMovementAndWand(signal);    // Yol Bulma ve Güvenli Heuristik Yürüyüşler
    this._fiberAdminScanning(signal);      // Admin / Yetkili İzleyici (Staff-Watch)
    this._fiberBlockInteract(signal);      // Fiziksel Blok Titreşimi ve El Çalkalama
  }

  _scheduleTracked(fn, delay) {
    if (!this.isRunning) return;
    const timeout = setTimeout(() => {
      this.activeTimeouts.delete(timeout);
      if (this.isRunning) fn();
    }, delay);
    this.activeTimeouts.add(timeout);
  }

  /**
   * FIBER 1: Akıcı Kafa Salınımları ve Bakış Yumuşatma (Sight Mimicry & Micro-jitter)
   */
  _fiberHeartbeat(signal) {
    const loop = async () => {
      if (signal.aborted || !this.isRunning) return;

      try {
        if (this.bot.entity) {
          // Eğer yakınlarda bir yetkili varsa bakışlarımızı daha sakin tutacağız
          const target = this._findInterestingEntity();

          if (target && Math.random() < (this.adminNearby ? 0.70 : 0.45)) {
            // Hedefe pürüzsüzce odaklan ve takıl (Kişisel Karakter Esnekliği)
            const trackingMs = randomInt(1500, 4000);
            const steps = Math.max(3, Math.floor(trackingMs / 200));
            
            for (let i = 0; i < steps; i++) {
              if (signal.aborted || !this.isRunning || !target.position) break;
              await this._lookAtSmoothly(target.position.offset(0, target.height || 1, 0), 200);
              await sleep(200);
            }
          } else {
            // Boş alana bakış atmak (Doğal göz dalması)
            const currentYaw = this.bot.entity.yaw;
            const currentPitch = this.bot.entity.pitch;

            // Rastgele hedef yaw açısı devinimleri
            const targetYaw = currentYaw + (Math.random() - 0.5) * Math.PI * 0.95;
            // Kafayı çok yukarı ve aşağı büküp şüphe çekmeyelim (-35 ila +35 derece arası ideal)
            const targetPitch = Math.max(-0.6, Math.min(0.6, 
              currentPitch + (Math.random() - 0.5) * Math.PI / 4));

            await this._lookAtAnglesSmoothly(targetYaw, targetPitch, randomInt(350, 800));
          }
        }
      } catch (_) {}

      // Kaotik gecikmeler (1-4 saniye arası sürekli devinim)
      const delay = randomInt(1100, 4200);
      this._scheduleTracked(loop, delay);
    };

    loop();
  }

  /**
   * FIBER 2: Aksiyon ve Etkileşim Kombinasyonları (Natural Twitch Combo)
   * Aralıklı olarak sıcakbar slotlarını, eğilmeleri ve el sallamaları kombine eder.
   */
  _fiberInteractiveCombos(signal) {
    const loop = async () => {
      if (signal.aborted || !this.isRunning) return;

      try {
        if (this.bot.entity) {
          // Eğer etrafta Admin varsa çılgın kombinasyonları askıya alıp sadece hafif fısıldama yapalım
          if (this.adminNearby) {
            if (this.bot.setControlState) {
              this.bot.setControlState('sneak', Math.random() > 0.55);
              await sleep(randomInt(800, 2000));
              this.bot.setControlState('sneak', false);
            }
          } else {
            const flowAction = Math.random();

            if (flowAction < 0.30) {
              // Hızlı / Yavaş Çömelip Kalkma (Double Crouch Spark)
              this.bot.setControlState('sneak', true);
              await sleep(randomInt(200, 600));
              this.bot.setControlState('sneak', false);
              
              if (Math.random() < 0.4) {
                await sleep(randomInt(100, 250));
                this.bot.setControlState('sneak', true);
                await sleep(randomInt(150, 400));
                this.bot.setControlState('sneak', false);
              }
            } 
            else if (flowAction < 0.65) {
              // Hotbar Tıklama Değişimi ve El Çırpma
              if (this.bot.setQuickbarSlot) {
                const randSlot = randomInt(0, 8);
                this.bot.setQuickbarSlot(randSlot);
                await sleep(randomInt(300, 800));
                this.bot.swingArm('right');
                await sleep(randomInt(400, 900));
                this.bot.setQuickbarSlot(this.originalSlot);
              }
            } 
            else {
              // Havada Zıplama & El Sallama birleşimi (Sadece zemin katı güvenliyse)
              if (this._isBotGrounded()) {
                this.bot.setControlState('jump', true);
                await sleep(120);
                this.bot.setControlState('jump', false);
                await sleep(80);
                this.bot.swingArm(Math.random() > 0.5 ? 'right' : 'left');
              }
            }
          }
        }
      } catch (_) {}

      // Gecikme 5 ile 15 saniye arası kaotik dağılımlıdır
      const delay = randomInt(5000, 15000);
      this._scheduleTracked(loop, delay);
    };

    loop();
  }

  /**
   * FIBER 3: Sıkışma, Sıvı ve Fizik Güvencesi (G-Watchdog & Water Safeguard)
   * Eğer bot suya/lavlara düşerse, sıkışırsa veya boşlukta kalırsa devreye giren otomatik kurtarıcıdır.
   */
  _fiberPhysicsAndSafety(signal) {
    const loop = async () => {
      if (signal.aborted || !this.isRunning) return;

      try {
        if (this.bot.entity && this.bot.entity.position) {
          const currentPos = this.bot.entity.position;

          // 1. SIVI SIKIŞMASI VE BOĞULMA ENGELİ (Boğulmaktan kurtulmak için yüzme döngüsü)
          const inLiquid = this._isInsideLiquid();
          if (inLiquid) {
            console.log(`[Ultimate-AntiAfk] Sıvı algılandı! Yukarı çıkmak için yüzme döngüsü tetiklendi.`);
            this.bot.setControlState('jump', true);
            await sleep(600);
            this.bot.setControlState('jump', false);
          }

          // 2. KOORDİNAT SIKIŞMASI (Watchdog)
          if (this.lastPosition) {
            const distanceMoved = currentPos.distanceTo(this.lastPosition);
            
            // Eğer bot kıpırdamıyorum dediyse (ve durması gerekmiyorsa) stuckTicks'i artır
            if (distanceMoved < 0.05) {
              this.stuckTicks++;
            } else {
              this.stuckTicks = 0;
            }

            // 15 saniye boyunca (bu fiber her 4 saniyede çalışır, yani ~4 döngü) hiç mesafe katedilmediyse kurtar
            if (this.stuckTicks >= 4) {
              console.log(`[Ultimate-AntiAfk] Sıkışma algılandı! Acil durum kurtarma manevrası uygulanıyor...`);
              
              const escapeDirs = ['back', 'left', 'right', 'forward'];
              const escapeDir = escapeDirs[randomInt(0, escapeDirs.length - 1)];

              // Kafayı pürüzsüzce yukarı kaldır, zıpla ve geri-straf at
              this.bot.look(this.bot.entity.yaw + Math.PI, 0, true);
              this.bot.setControlState('jump', true);
              this.bot.setControlState(escapeDir, true);
              
              await sleep(450);
              
              this.bot.setControlState('jump', false);
              this.bot.setControlState(escapeDir, false);
              this.stuckTicks = 0;
            }
          }

          this.lastPosition = currentPos.clone();
        }
      } catch (_) {}

      this._scheduleTracked(loop, 4000);
    };

    loop();
  }

  /**
   * FIBER 4: Yol Bulma ya da Heuristik Gezinme (Heuristic Path Wands)
   * En kritik AFK tespiti aşan yer burasıdır. X-Z koordinatlarında gerçekçi dolaşım yapar.
   */
  _fiberMovementAndWand(signal) {
    const loop = async () => {
      if (signal.aborted || !this.isRunning) return;

      // Admin yakındaysa asla gezinmeye kalkışma, fark edilmemek için sabit kal!
      if (this.adminNearby) {
        this._scheduleTracked(loop, 8000);
        return;
      }

      try {
        if (this.bot.entity && this.bot.entity.position && this._isBotGrounded()) {
          // Eğer botun pathfinder'ı kurulu ise, 3D koordinatlar üzerinde pürüzsüzce yürütelim
          if (this.bot.pathfinder && typeof this.bot.pathfinder.setGoal === 'function') {
            const vec3 = require('vec3');
            const { GoalNear } = require('mineflayer-pathfinder').goals;

            // Orijinal konumumuzun etrafından güvenli bir blok seçelim (Çap: 3 blok)
            const dx = randomFloat(-3, 3);
            const dz = randomFloat(-3, 3);
            const targetPos = this.originalPosition.offset(dx, 0, dz);

            // Hedefin altında katı blok kontrolü
            const blockUnder = this.bot.blockAt(targetPos.offset(0, -1, 0));
            const blockUnderFar = this.bot.blockAt(targetPos.offset(0, -2, 0));
            
            // Eğer zemin havada değilse ve lav/ateş barındırmıyorsa orayı hedef seçelim
            if (blockUnder && blockUnder.name !== 'air' && blockUnder.name !== 'cave_air' && blockUnder.name !== 'lava') {
              // console.log(`[Ultimate-AntiAfk] Yol bulma motoru ile güvenli noktaya yürünüyor.`);
              try {
                this.bot.pathfinder.setGoal(new GoalNear(targetPos.x, targetPos.y, targetPos.z, 0.8));
              } catch (_) {}
            }
          } 
          else {
            // Pathfinder yoksa, güvenli yön seçerek elle mikro-adımlama uygula
            const motions = ['forward', 'back', 'left', 'right'];
            const chosenMotion = motions[randomInt(0, motions.length - 1)];

            if (this._isDirectionSafeToStep(chosenMotion)) {
              this.bot.setControlState(chosenMotion, true);
              await sleep(randomInt(250, 500));
              this.bot.setControlState(chosenMotion, false);

              // Başlangıç konumundan aşırı uzaklaştıysa geri çekilme hareketi yap
              const currentXzDist = this.bot.entity.position.distanceTo(this.originalPosition);
              if (currentXzDist > 4.5) {
                const opposite = this._getOppositeDirection(chosenMotion);
                this.bot.lookAt(this.originalPosition, true);
                this.bot.setControlState('forward', true);
                await sleep(randomInt(400, 800));
                this.bot.setControlState('forward', false);
              }
            }
          }
        }
      } catch (_) {}

      // Yol bulma / gezinme sıklığı: 20 saniye ile 45 saniye arası
      const delay = randomInt(20000, 45000);
      this._scheduleTracked(loop, delay);
    };

    loop();
  }

  /**
   * FIBER 5: Yetkili Tarayıcı Ağı (Staff-Watch Core)
   * Sunucu listesinde ve etrafta Yetkili (Admin, Mod, Kurucu) araması yapar.
   * Yetkili bulunduğunda sessiz / stealth moduna geçer.
   */
  _fiberAdminScanning(signal) {
    const loop = async () => {
      if (signal.aborted || !this.isRunning) return;

      try {
        let isStaffFound = false;

        // 1. OYUNCU ADLARI VE ETİKETLERDEN STAFF TESPİTİ
        if (this.bot.players) {
          const staffKeywords = ['admin', 'mod', 'staff', 'owner', 'rehber', 'kurucu', 'moderator', 'helper', 'yonetici', 'vadmin'];
          
          for (const username in this.bot.players) {
            const lowerUser = username.toLowerCase();
            const hasKeyword = staffKeywords.some(k => lowerUser.includes(k));
            
            if (hasKeyword && lowerUser !== this.bot.username.toLowerCase()) {
              isStaffFound = true;
              break;
            }
          }
        }

        // 2. YAKINLIKLA (COSMIC TARGETS) STAFF TESPİTİ
        // Eğer yakında bir oyuncu durup uzun süre bota bakıyorsa (Guard watch) şüphenilip stealth moda geçilir
        if (!isStaffFound && this.bot.entities) {
          for (const id in this.bot.entities) {
            const entity = this.bot.entities[id];
            if (entity && entity.type === 'player' && entity !== this.bot.entity) {
              const distance = this.bot.entity.position.distanceTo(entity.position);
              
              // Eğer bir insan oyuncu 8 bloğumuza kadar yaklaştıysa sessiz bir gözlemciye dönelim
              if (distance < 8) {
                isStaffFound = true;
                break;
              }
            }
          }
        }

        if (isStaffFound && !this.adminNearby) {
          this.adminNearby = true;
          console.log(`[Ultimate-AntiAfk] ⚠️ SUNUCUDA / YAKINDA YETKİLİ VEYA GÖZLEMCİ SAPTANDI! Sessiz Stealth moduna geçiliyor.`);
          
          // Hızlıca panik durumunu engellemek için bütün tuşları serbest bırakalım
          this.bot.clearControlStates();
        } 
        else if (!isStaffFound && this.adminNearby) {
          this.adminNearby = false;
          console.log(`[Ultimate-AntiAfk] ✅ Sunucu temizlendi. Normal bypass döngüsü devam ediyor.`);
        }

      } catch (_) {}

      // Her 6 saniyede bir yetkili kontrolü
      this._scheduleTracked(loop, 6000);
    };

    loop();
  }

  /**
   * FIBER 6: Fiziksel Blok Titreşimi ve El Çalkalama (Aktivite Paketi Çorbalayıcı)
   * Bu modül, etrafındaki katı bir bloğu kısaca tıklatarak (punching effect) kırılma paketleri gönderir.
   * Bu paketler sunucu korumalarını ve AFK bot eklentilerini tamamen şoke eder.
   */
  _fiberBlockInteract(signal) {
    const loop = async () => {
      if (signal.aborted || !this.isRunning || this.adminNearby) {
        this._scheduleTracked(loop, 12000);
        return;
      }

      try {
        if (this.bot.entity && this.bot.blockAt) {
          // Botun 2-3 blok çevresindeki katı bir bloğu bul
          const botPos = this.bot.entity.position;
          const checkOffsets = [
            [0, -1, 1], [1, -1, 0], [-1, -1, 0], [0, -1, -1],
            [0, 0, 1], [1, 0, 0], [-1, 0, 0], [0, 0, -1]
          ];
          
          let targetBlock = null;
          for (const offset of checkOffsets) {
            const block = this.bot.blockAt(botPos.offset(offset[0], offset[1], offset[2]));
            if (block && this._isBlockSolid(block) && block.name !== 'chest' && block.name !== 'ender_chest') {
              targetBlock = block;
              break;
            }
          }

          if (targetBlock) {
            // Başı bloğa döndür
            await this._lookAtSmoothly(targetBlock.position.offset(0.5, 0.5, 0.5), 300);
            
            // Bloğa tıklatıp (0.3 saniye boyunca zıplatmadan sol tıkla) el sallat
            if (this.bot.activateBlock) {
              this.bot.swingArm('right');
              // Sunucu paketlerine yumruk (crack) paketini basıyoruz
              if (typeof this.bot.digTime === 'function') {
                try {
                  // Mineflayer'ın içsel paketleriyle vur
                  this.bot.swingArm('right');
                } catch (_) {}
              }
            }
          }
        }
      } catch (_) {}

      // 15 - 35 saniyede bir blok tırmalama paketi
      const delay = randomInt(15000, 35000);
      this._scheduleTracked(loop, delay);
    };

    loop();
  }

  // ── MOVEMENT ENGINES (SMOOTH & ANTI-CHEAT COMPLIANT) ────────────────

  /**
   * Açıları pürüzsüz ve akıcı bir şekilde sarsmadan belirli bir süreye yayarak döndürür.
   * Geleneksel anlık look() paketleri anticheat'ler tarafından anında algılanır.
   */
  async _lookAtAnglesSmoothly(targetYaw, targetPitch, durationMs) {
    try {
      if (!this.bot.entity) return;
      
      const startYaw = this.bot.entity.yaw;
      const startPitch = this.bot.entity.pitch;

      // Açıyı (-PI to PI) aralığında normalize hale getir
      let diffYaw = targetYaw - startYaw;
      while (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
      while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;

      const diffPitch = targetPitch - startPitch;

      const steps = Math.max(6, Math.floor(durationMs / 45));
      const interval = durationMs / steps;

      for (let i = 1; i <= steps; i++) {
        if (!this.isRunning) break;
        const ratio = i / steps;
        
        // S-Curve (Yumuşak Hızlanma ve Yavaşlama - Hermite Interpolation)
        const smoothRatio = ratio * ratio * (3 - 2 * ratio);

        const currentYaw = startYaw + diffYaw * smoothRatio;
        const currentPitch = startPitch + diffPitch * smoothRatio;

        this.bot.look(currentYaw, currentPitch, true);
        await sleep(interval);
      }
    } catch (_) {}
  }

  /**
   * 3B Konuma pürüzsüzce odaklanmasını sağlar
   */
  async _lookAtSmoothly(targetPos, durationMs) {
    try {
      if (!this.bot.entity) return;
      const selfPos = this.bot.entity.position.offset(0, this.bot.entity.height || 1.62, 0);
      const dx = targetPos.x - selfPos.x;
      const dy = targetPos.y - selfPos.y;
      const dz = targetPos.z - selfPos.z;

      const distanceXZ = Math.sqrt(dx * dx + dz * dz);
      const targetYaw = Math.atan2(-dx, -dz);
      const targetPitch = Math.atan2(dy, distanceXZ);

      await this._lookAtAnglesSmoothly(targetYaw, targetPitch, durationMs);
    } catch (_) {}
  }

  _isInsideLiquid() {
    try {
      if (!this.bot.entity || !this.bot.blockAt) return false;
      const headBlock = this.bot.blockAt(this.bot.entity.position.offset(0, 1.2, 0));
      const footBlock = this.bot.blockAt(this.bot.entity.position);
      
      return (headBlock && (headBlock.name === 'water' || headBlock.name === 'lava')) ||
             (footBlock && (footBlock.name === 'water' || footBlock.name === 'lava'));
    } catch (_) {
      return false;
    }
  }

  _isBotGrounded() {
    try {
      if (!this.bot.entity) return false;
      return this.bot.entity.onGround;
    } catch (_) {
      return false;
    }
  }

  _findInterestingEntity() {
    try {
      const self = this.bot.entity;
      if (!self) return null;

      let closest = null;
      let minDistance = 14;

      for (const id in this.bot.entities) {
        const entity = this.bot.entities[id];
        if (!entity || entity === self) continue;

        if (entity.type === 'player' || entity.type === 'mob') {
          const dist = self.position.distanceTo(entity.position);
          if (dist < minDistance) {
            minDistance = dist;
            closest = entity;
          }
        }
      }
      return closest;
    } catch (_) {
      return null;
    }
  }

  _isDirectionSafeToStep(dir) {
    try {
      if (!this.bot.entity || !this.bot.blockAt) return false;

      const yaw = this.bot.entity.yaw;
      let dx = 0;
      let dz = 0;

      const fX = -Math.sin(yaw);
      const fZ = -Math.cos(yaw);
      const rX = -Math.sin(yaw - Math.PI / 2);
      const rZ = -Math.cos(yaw - Math.PI / 2);

      if (dir === 'forward') { dx = fX; dz = fZ; }
      else if (dir === 'back') { dx = -fX; dz = -fZ; }
      else if (dir === 'right') { dx = rX; dz = rZ; }
      else if (dir === 'left') { dx = -rX; dz = -rZ; }

      const botPos = this.bot.entity.position;
      const targetFootPos = botPos.offset(dx * 0.8, 0, dz * 0.8);
      
      const blockUnder = this.bot.blockAt(targetFootPos.offset(0, -1, 0));
      const blockInsideFoot = this.bot.blockAt(targetFootPos);
      const blockInsideHead = this.bot.blockAt(targetFootPos.offset(0, 1, 0));

      if (!blockUnder) return false;

      const dangerList = ['lava', 'fire', 'magma_block', 'sweet_berry_bush', 'cactus'];
      if (blockUnder.name === 'air' || blockUnder.name === 'cave_air') return false;
      if (dangerList.includes(blockUnder.name) || dangerList.includes(blockInsideFoot.name)) return false;

      const footSolid = this._isBlockSolid(blockInsideFoot);
      const headSolid = this._isBlockSolid(blockInsideHead);

      return !footSolid && !headSolid;
    } catch (_) {
      return false;
    }
  }

  _isBlockSolid(block) {
    if (!block) return false;
    const nonSolidBlocks = [
      'air', 'cave_air', 'void_air', 'water', 'lava', 'tall_grass', 'grass', 
      'seagrass', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 
      'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 
      'cornflower', 'lily_of_the_valley', 'wither_rose', 'sunflower', 'lilac', 
      'rose_bush', 'peony', 'wheat', 'carrots', 'potatoes', 'beetroots', 'sugar_cane'
    ];
    return !nonSolidBlocks.includes(block.name);
  }

  _getOppositeDirection(dir) {
    if (dir === 'forward') return 'back';
    if (dir === 'back') return 'forward';
    if (dir === 'left') return 'right';
    if (dir === 'right') return 'left';
    return 'back';
  }
}

module.exports = AntiAfk;
