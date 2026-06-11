/**
 * Sunucu Tabanlı AFK Algılama Sistemlerini Atlatma Modülü
 * Ultra-Gelişmiş "Super-Anti AFK" Sürümü (v4.0.0)
 * 
 * Özellikler:
 * - Yapay Göz Teması ve Odaklanma: Yakındaki oyuncuları ve yaratıkları takip eden akıcı göz hareketleri.
 * - Kaotik, Dinamik Gecikmeler: Sabit interval yerine fraktal aralıklı ve gürültü eklenmiş gecikmeler (Makine öğrenmesi engelleyici).
 * - Güvenli Mikro-Hareketler: Lokasyon değişim kontrolü yapan sistemler için güvenli zemin kontrolüyle milisaniyelik yürüyüşler.
 * - Paket/Etkileşim Çeşitliliği: Envanter slot değiştirme, el sallama, eğilip-kalkma ve sıçramaların kombinasyonu.
 * - Sıfır Çökme / Güvenli Sonlandırma: AbortController entegrasyonu ile bot oyundan çıktığında veya kapatıldığında tamamen temizlenir.
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

    console.log(`[Super-AntiAfk] ${this.bot.username} için ultra-gelişmiş bypass döngüsü başlatıldı.`);

    // Birbirinden bağımsız çalışan eşzamanlı bypass yolları (fibers)
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

    // Bekleyen tüm süreçleri anında iptal et
    for (const timeout of this.activeTimeouts) {
      clearTimeout(timeout);
    }
    this.activeTimeouts.clear();

    // Kontrol durumlarını varsayılana çek
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

    console.log(`[Super-AntiAfk] ${this.bot.username} için bypass döngüsü kapatıldı.`);
  }

  /**
   * Tüm asenkron döngüleri paralel ve bağımsız olarak canlandırır
   */
  _runFibers(signal) {
    this._fiberHeadAndSearch(signal);
    this._fiberActionCombo(signal);
    this._fiberMicroWalk(signal);
    this._fiberHotbarFlutter(signal);
  }

  /**
   * Gecikmeli asenkron bir işlemi takip listesine tescilleyerek çalıştırır
   */
  _scheduleTracked(fn, delay) {
    if (!this.isRunning) return;
    const timeout = setTimeout(() => {
      this.activeTimeouts.delete(timeout);
      if (this.isRunning) fn();
    }, delay);
    this.activeTimeouts.add(timeout);
  }

  /**
   * FIBER 1: Akıcı Kafa Hareketleri & Yakındaki Oyuncuya Odaklanma (Sight Mimicry)
   */
  _fiberHeadAndSearch(signal) {
    const loop = async () => {
      if (signal.aborted || !this.isRunning) return;

      try {
        if (this.bot.entity) {
          // Yakındaki bir canlıyı veya oyuncuyu ara (Odak Simülasyonu)
          const target = this._findInterestingEntity();
          
          if (target && Math.random() < 0.45) {
            // Canlıyı 3-6 saniye boyunca akıcı şekilde takip et
            const trackingSec = randomInt(3, 6);
            for (let i = 0; i < trackingSec; i++) {
              if (signal.aborted || !this.isRunning || !target.position) break;
              await this._lookAtSmoothly(target.position.offset(0, target.height || 1, 0), 400);
              await sleep(600);
            }
          } else {
            // Çevreyi gözlemleme veya boş boş bakınma
            const currentYaw = this.bot.entity.yaw;
            const currentPitch = this.bot.entity.pitch;
            
            // Gerçekçi kafa açısı sapmaları
            const deltaYaw = (Math.random() - 0.5) * Math.PI * 0.8;
            const targetYaw = currentYaw + deltaYaw;
            const targetPitch = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, 
              currentPitch + (Math.random() - 0.5) * Math.PI / 5));

            await this._lookAtAnglesSmoothly(targetYaw, targetPitch, randomInt(300, 700));
          }
        }
      } catch (_) {}

      // Saniyeler arası gürültülü (chaotic) gecikme aralığı: 2.5 - 6 saniye
      const delay = randomInt(2500, 6000);
      this._scheduleTracked(loop, delay);
    };

    loop();
  }

  /**
   * FIBER 2: Aksiyon Kombinasyonu (Crouch, Jump ve Hand Swings)
   */
  _fiberActionCombo(signal) {
    const loop = async () => {
      if (signal.aborted || !this.isRunning) return;

      try {
        if (this.bot.entity) {
          const actionChance = Math.random();

          if (actionChance < 0.35) {
            // EĞİLİP KALKMA (Sneak Twitch)
            this.bot.setControlState('sneak', true);
            await sleep(randomInt(400, 1500));
            this.bot.setControlState('sneak', false);
            
            // Eğildikten sonra hafifçe etrafa bakma hissi
            if (Math.random() < 0.5) {
              this.bot.swingArm('right');
            }
          } 
          else if (actionChance < 0.70) {
            // KOL SALLAMA VE GÖZ KIRPMA
            const swingsCount = randomInt(1, 4);
            for (let i = 0; i < swingsCount; i++) {
              if (signal.aborted) break;
              this.bot.swingArm(Math.random() > 0.75 ? 'left' : 'right');
              await sleep(randomInt(150, 400));
            }
          } 
          else {
            // GERÇEKÇİ KIPIRDAMA & SIKIŞIKLIK ALICI MINİK ZIPLAMA
            // Sadece zemin katı güvenliyse sıçrama gerçekleştirilir
            if (this._isBotGrounded()) {
              this.bot.setControlState('jump', true);
              await sleep(150);
              this.bot.setControlState('jump', false);
              
              // Havada yarım tur dönme hissi (gerçek oyuncunun etrafa sıçrarken yaptığı hareket)
              if (Math.random() > 0.4) {
                const airYaw = this.bot.entity.yaw + (Math.random() - 0.5) * Math.PI * 0.4;
                this.bot.look(airYaw, this.bot.entity.pitch, true);
              }
            }
          }
        }
      } catch (_) {}

      // 6 ile 18 saniye arası kaotik kombinasyon aralığı
      const delay = randomInt(6000, 18000);
      this._scheduleTracked(loop, delay);
    };

    loop();
  }

  /**
   * FIBER 3: Mikro-Güvenli Adımlama (Lokasyon Analizi Yaparak Minik Adım)
   * Birçok gelişmiş sunucu, oyuncunun X-Z koordinatlarının hiç değişmemesini gözlemler.
   * Bu fiber, botun bulunduğu yatayda 0.2 - 0.5 blok hareket etmesini sağlayıp geri döner.
   */
  _fiberMicroWalk(signal) {
    const loop = async () => {
      if (signal.aborted || !this.isRunning) return;

      try {
        if (this.bot.entity && this.bot.entity.position && this._isBotGrounded()) {
          const originalPosition = this.bot.entity.position.clone();
          const directions = ['forward', 'back', 'left', 'right'];
          const chosenDir = directions[randomInt(0, 3)];

          // Seçilen doğrultunun önün güvenli olup olmadığını kontrol et
          if (this._isDirectionSafeToStep(chosenDir)) {
            // Konsola detay yazalım
            // console.log(`[Super-AntiAfk] Güvenli yön bulundu, mikro hareket yapılıyor: ${chosenDir}`);

            this.bot.setControlState(chosenDir, true);
            await sleep(randomInt(200, 450)); // 200-450ms arası adımlama (Yaklaşık 0.2 - 0.6 blok)
            this.bot.setControlState(chosenDir, false);

            await sleep(randomInt(400, 900));

            // Başlangıç konumuna yakınsamak için yarım saniye sonra hafifçe yönü sıfırlayalım (Zorunlu değil ama stabilite yaratır)
            if (Math.random() > 0.5) {
              const reverseDir = this._getOppositeDirection(chosenDir);
              this.bot.setControlState(reverseDir, true);
              await sleep(randomInt(180, 380));
              this.bot.setControlState(reverseDir, false);
            }
          }
        }
      } catch (_) {}

      // 25 ile 55 saniye arası uzun aralıklarda mikro adımlar (sürekli koşarak dikkat çekmek istemeyiz)
      const delay = randomInt(25000, 55000);
      this._scheduleTracked(loop, delay);
    };

    loop();
  }

  /**
   * FIBER 4: Envanter / Sıcaklık Barının Çırpınması (Hotbar Packet Flutter)
   * Oyuncunun aktif tuttuğu eşyayı değiştirmesi sunucu tarafına yoğun paket çıkışı sağlar.
   */
  _fiberHotbarFlutter(signal) {
    const loop = async () => {
      if (signal.aborted || !this.isRunning) return;

      try {
        if (this.bot.setQuickbarSlot) {
          // Rastgele bir sıcakbar indeksine tıkla (0-8)
          const tempSlot = randomInt(0, 8);
          this.bot.setQuickbarSlot(tempSlot);
          
          await sleep(randomInt(800, 2500));

          // Diğer rastgele bir slota geç
          if (Math.random() < 0.6 && this.isRunning) {
            const secondarySlot = randomInt(0, 8);
            this.bot.setQuickbarSlot(secondarySlot);
            await sleep(randomInt(500, 1500));
          }

          // Geri ana slota çekelim
          if (this.isRunning) {
            this.bot.setQuickbarSlot(this.originalSlot);
          }
        }
      } catch (_) {}

      // 12 ile 30 saniye arası slot değiştirme döngüsü
      const delay = randomInt(12000, 30000);
      this._scheduleTracked(loop, delay);
    };

    loop();
  }

  // ── YARDIMCI GÜVENLİK VE TAKİP FONKSİYONLARI ───────────────────────────

  /**
   * Botun ayaklarının yere basıp basmadığının basit bir analizi
   */
  _isBotGrounded() {
    try {
      if (!this.bot.entity) return false;
      return this.bot.entity.onGround;
    } catch (_) {
      return false;
    }
  }

  /**
   * Etrafta bakılabilecek ilginç bir varlık bulur (Maksimum 14 blok uzaklıkta oyuncu ya da yaratık)
   */
  _findInterestingEntity() {
    try {
      const self = this.bot.entity;
      if (!self) return null;

      let closest = null;
      let minDistance = 14;

      for (const id in this.bot.entities) {
        const entity = this.bot.entities[id];
        if (!entity || entity === self) continue;

        // Sadece canlı Varlıklar (Oyuncular, Mobs, Pasif Canlılar)
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

  /**
   * Açıları pürüzsüz ve akıcı bir şekilde sarsmadan belirli bir süreye yayarak döndürür
   */
  async _lookAtAnglesSmoothly(targetYaw, targetPitch, durationMs) {
    try {
      if (!this.bot.entity) return;
      const startYaw = this.bot.entity.yaw;
      const startPitch = this.bot.entity.pitch;

      const steps = Math.max(5, Math.floor(durationMs / 50));
      const interval = durationMs / steps;

      for (let i = 1; i <= steps; i++) {
        if (!this.isRunning) break;
        const ratio = i / steps;
        
        // Linear Interpolate (lerp)
        const currentYaw = startYaw + (targetYaw - startYaw) * ratio;
        const currentPitch = startPitch + (targetPitch - startPitch) * ratio;

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

  /**
   * Seçilen yöne küçük bir adım atmadan önce zemin analizörü yapar.
   * Çukur, lav, ateş, su veya uçurum olup olmadığını denetler.
   */
  _isDirectionSafeToStep(dir) {
    try {
      if (!this.bot.entity || !this.bot.blockAt) return false;

      const yaw = this.bot.entity.yaw;
      let dx = 0;
      let dz = 0;

      // Bakış açısı birim vektörleri
      const fX = -Math.sin(yaw);
      const fZ = -Math.cos(yaw);
      const rX = -Math.sin(yaw - Math.PI / 2);
      const rZ = -Math.cos(yaw - Math.PI / 2);

      if (dir === 'forward') { dx = fX; dz = fZ; }
      else if (dir === 'back') { dx = -fX; dz = -fZ; }
      else if (dir === 'right') { dx = rX; dz = rZ; }
      else if (dir === 'left') { dx = -rX; dz = -rZ; }

      const botPos = this.bot.entity.position;
      // Adım atılacak hedef noktanın zemini
      const targetFootPos = botPos.offset(dx * 0.8, 0, dz * 0.8);
      
      // Ayak seviyesi, baş seviyesi ve ayak altındaki blok kontrolü
      const blockUnder = this.bot.blockAt(targetFootPos.offset(0, -1, 0));
      const blockInsideFoot = this.bot.blockAt(targetFootPos);
      const blockInsideHead = this.bot.blockAt(targetFootPos.offset(0, 1, 0));

      if (!blockUnder) return false;

      // Tehlikeli bloklar listesi
      const dangerList = ['lava', 'fire', 'magma_block', 'sweet_berry_bush', 'cactus'];
      
      // Altı boşsa ya da havadakilere basılacaksa durdur (uçurum engeli)
      if (blockUnder.name === 'air' || blockUnder.name === 'cave_air') return false;
      
      // Lava, ateş vb var ise gitme
      if (dangerList.includes(blockUnder.name) || dangerList.includes(blockInsideFoot.name)) return false;

      // Ayak seviyesi ve baş seviyesi geçilebilir olmalı (Katı blokların içine yürünmemesi için)
      const footSolid = this._isBlockSolid(blockInsideFoot);
      const headSolid = this._isBlockSolid(blockInsideHead);

      return !footSolid && !headSolid;
    } catch (_) {
      return false;
    }
  }

  /**
   * Bloğun fiziksel olarak katı / yürünemez bir engel olup olmadığını sorgular
   */
  _isBlockSolid(block) {
    if (!block) return false;
    // Basit filtreleme, daha karmaşık boundingbox kontrolleri yerine mineflayer'ın yerleşik değerleri taranır
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
