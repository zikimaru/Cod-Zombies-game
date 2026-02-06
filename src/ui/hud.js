import { eventBus } from '../main.js';

/**
 * HUD - Heads-Up Display for CoD World at War Zombies.
 *
 * Manages all in-game UI using HTML/DOM overlays on top of the Three.js canvas.
 * Handles points, round counter, ammo, health vignette, crosshair, hitmarkers,
 * damage direction indicators, interaction prompts, kill feed, weapon swap UI,
 * wave transitions, and the game-over screen.
 *
 * All visual elements use pointer-events: none so they never block game input.
 */
export class HUD {
  /**
   * @param {import('../main.js').Game} game - The core Game instance
   */
  constructor(game) {
    this.game = game;
    this.eventBus = eventBus;
    this.container = document.getElementById('game-container');

    /** Cached references to static and dynamic DOM elements */
    this.elements = {};

    /** Tracked state to detect changes and avoid redundant DOM writes */
    this._lastPoints = -1;
    this._lastAmmo = -1;
    this._lastReserve = -1;
    this._lastMagSize = -1;
    this._lastHealth = -1;
    this._lastMaxHealth = -1;
    this._lastRound = -1;
    this._lastWeaponName = '';
    this._lastWeaponIndex = -1;

    /** Active damage-direction indicator timers */
    this._damageIndicators = [];

    /** Kill feed entries waiting to be cleaned up */
    this._killFeedEntries = [];
    this._killFeedMax = 5;

    /** Current crosshair spread in pixels */
    this._crosshairSpread = 18;
    this._crosshairTargetSpread = 18;

    /** Hitmarker timeout handle */
    this._hitmarkerTimeout = null;

    /** Round splash timeout handles */
    this._roundSplashTimeouts = [];

    /** Health pulse animation frame id */
    this._healthPulseRAF = null;
    this._healthPulseActive = false;

    /** Track injected style element for cleanup */
    this._styleElement = null;

    /** Floating point text counter for unique ids */
    this._floatCounter = 0;

    /** Wave transition timer */
    this._waveTransitionTimeout = null;

    /** Reload flash interval */
    this._reloadFlashInterval = null;

    /** Weapon swap display timeout */
    this._weaponSwapTimeout = null;

    this.init();
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  /**
   * Create all DOM elements, append to container, set initial styles,
   * inject dynamic CSS keyframes, and wire up eventBus listeners.
   */
  init() {
    this._injectStyles();
    this._cacheStaticElements();
    this._createDynamicElements();
    this._wireEvents();
  }

  /**
   * Inject a <style> block with all HUD-specific keyframe animations and
   * dynamic class rules that are not in the main style.css.
   * @private
   */
  _injectStyles() {
    const style = document.createElement('style');
    style.id = 'hud-dynamic-styles';
    style.textContent = /* css */ `
      /* ---- Floating point gain text ---- */
      .hud-float-points {
        position: fixed;
        pointer-events: none;
        z-index: 85;
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 22px;
        font-weight: bold;
        color: #ffd700;
        text-shadow:
          0 0 6px rgba(255, 215, 0, 0.6),
          1px 1px 3px rgba(0, 0, 0, 0.9);
        opacity: 1;
        white-space: nowrap;
        animation: hudFloatUp 1.2s ease-out forwards;
      }
      .hud-float-points.headshot {
        color: #ff4444;
        font-size: 26px;
        text-shadow:
          0 0 8px rgba(255, 50, 50, 0.7),
          1px 1px 3px rgba(0, 0, 0, 0.9);
      }
      @keyframes hudFloatUp {
        0%   { opacity: 1; transform: translateY(0) scale(1.1); }
        20%  { opacity: 1; transform: translateY(-15px) scale(1); }
        100% { opacity: 0; transform: translateY(-60px) scale(0.8); }
      }

      /* ---- Hitmarker ---- */
      .hud-hitmarker {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 24px;
        height: 24px;
        pointer-events: none;
        z-index: 101;
        opacity: 0;
        transition: opacity 0.05s;
      }
      .hud-hitmarker.visible {
        opacity: 1;
      }
      .hud-hitmarker-line {
        position: absolute;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 1px;
      }
      .hud-hitmarker.kill .hud-hitmarker-line {
        background: rgba(255, 50, 50, 1);
      }
      /* Top-left to center */
      .hud-hitmarker-line.tl {
        width: 2px;
        height: 9px;
        top: 0;
        left: 4px;
        transform: rotate(45deg);
        transform-origin: bottom right;
      }
      /* Top-right to center */
      .hud-hitmarker-line.tr {
        width: 2px;
        height: 9px;
        top: 0;
        right: 4px;
        transform: rotate(-45deg);
        transform-origin: bottom left;
      }
      /* Bottom-left to center */
      .hud-hitmarker-line.bl {
        width: 2px;
        height: 9px;
        bottom: 0;
        left: 4px;
        transform: rotate(-45deg);
        transform-origin: top right;
      }
      /* Bottom-right to center */
      .hud-hitmarker-line.br {
        width: 2px;
        height: 9px;
        bottom: 0;
        right: 4px;
        transform: rotate(45deg);
        transform-origin: top left;
      }

      /* ---- Damage direction indicator ---- */
      .hud-damage-dir {
        position: fixed;
        top: 50%;
        left: 50%;
        width: 160px;
        height: 160px;
        margin-left: -80px;
        margin-top: -80px;
        pointer-events: none;
        z-index: 89;
        opacity: 0;
        transition: opacity 0.15s ease-in;
      }
      .hud-damage-dir.active {
        opacity: 1;
        transition: opacity 0.05s;
      }
      .hud-damage-dir-arrow {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 10px solid transparent;
        border-right: 10px solid transparent;
        border-bottom: 28px solid rgba(200, 0, 0, 0.75);
        filter: blur(0.5px);
      }

      /* ---- Kill feed ---- */
      .hud-kill-feed {
        position: fixed;
        top: 60px;
        left: 24px;
        pointer-events: none;
        z-index: 85;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .hud-kill-feed-entry {
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 14px;
        color: rgba(255, 255, 255, 0.85);
        text-shadow: 1px 1px 3px rgba(0, 0, 0, 0.9);
        white-space: nowrap;
        opacity: 1;
        transform: translateX(0);
        transition: opacity 0.4s ease-out, transform 0.4s ease-out;
        letter-spacing: 1px;
      }
      .hud-kill-feed-entry.headshot {
        color: #ff4444;
        font-weight: bold;
      }
      .hud-kill-feed-entry.fade-out {
        opacity: 0;
        transform: translateX(-20px);
      }

      /* ---- Reload flash ---- */
      .hud-reload-text {
        position: absolute;
        bottom: 105px;
        right: 30px;
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 18px;
        font-weight: bold;
        color: #ff3333;
        letter-spacing: 4px;
        text-transform: uppercase;
        text-shadow: 0 0 10px rgba(255, 50, 50, 0.6);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.1s;
      }
      .hud-reload-text.visible {
        animation: reloadBlink 0.6s ease-in-out infinite;
      }
      @keyframes reloadBlink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.2; }
      }

      /* ---- Wave transition banner ---- */
      .hud-wave-banner {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        pointer-events: none;
        z-index: 86;
        opacity: 0;
        transition: opacity 0.5s ease;
      }
      .hud-wave-banner.visible {
        opacity: 1;
      }
      .hud-wave-banner-text {
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 18px;
        color: rgba(255, 255, 255, 0.6);
        letter-spacing: 4px;
        text-transform: uppercase;
        text-shadow: 0 0 10px rgba(0, 0, 0, 0.8);
      }

      /* ---- Weapon swap indicator ---- */
      .hud-weapon-swap {
        position: fixed;
        bottom: 140px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 16px;
        align-items: center;
        pointer-events: none;
        z-index: 85;
        opacity: 0;
        transition: opacity 0.25s ease;
      }
      .hud-weapon-swap.visible {
        opacity: 1;
      }
      .hud-weapon-slot {
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.35);
        letter-spacing: 2px;
        text-transform: uppercase;
        text-shadow: 1px 1px 4px rgba(0, 0, 0, 0.8);
        padding: 6px 14px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        transition: all 0.2s ease;
      }
      .hud-weapon-slot.active {
        color: rgba(255, 255, 255, 0.9);
        border-color: rgba(255, 215, 0, 0.5);
        background: rgba(255, 215, 0, 0.06);
        text-shadow:
          0 0 8px rgba(255, 215, 0, 0.3),
          1px 1px 4px rgba(0, 0, 0, 0.8);
      }

      /* ---- Health desaturation overlay ---- */
      .hud-desat-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 88;
        background: rgba(0, 0, 0, 0);
        mix-blend-mode: saturation;
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      /* ---- Health heartbeat overlay ---- */
      .hud-heartbeat-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: none;
        z-index: 87;
        border: 0px solid rgba(139, 0, 0, 0);
        opacity: 0;
        transition: opacity 0.2s;
      }
      .hud-heartbeat-overlay.active {
        opacity: 1;
        animation: heartbeat 1.0s ease-in-out infinite;
      }
      @keyframes heartbeat {
        0%   { border-width: 0px; border-color: rgba(139, 0, 0, 0); }
        8%   { border-width: 12px; border-color: rgba(180, 0, 0, 0.25); }
        16%  { border-width: 4px; border-color: rgba(139, 0, 0, 0.08); }
        24%  { border-width: 16px; border-color: rgba(200, 0, 0, 0.3); }
        40%  { border-width: 2px; border-color: rgba(139, 0, 0, 0.02); }
        100% { border-width: 0px; border-color: rgba(139, 0, 0, 0); }
      }

      /* ---- Points pop animation override ---- */
      .points-pop {
        animation: hudPointsPop 0.3s ease-out !important;
      }
      @keyframes hudPointsPop {
        0%   { transform: scale(1.25); color: #ffffff; }
        50%  { transform: scale(1.1); }
        100% { transform: scale(1); color: #ffd700; }
      }

      /* ---- Round splash (dramatic center reveal) ---- */
      .hud-round-splash {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(2.5);
        text-align: center;
        pointer-events: none;
        z-index: 95;
        opacity: 0;
      }
      .hud-round-splash-label {
        font-family: 'Trebuchet MS', 'Impact', 'Arial Black', sans-serif;
        font-size: 40px;
        color: rgba(255, 255, 255, 0.7);
        letter-spacing: 14px;
        text-transform: uppercase;
        text-shadow: 0 0 20px rgba(0, 0, 0, 0.8);
        display: block;
        margin-bottom: 8px;
      }
      .hud-round-splash-number {
        font-family: 'Trebuchet MS', 'Impact', 'Arial Black', sans-serif;
        font-size: 120px;
        font-weight: bold;
        color: #cc0000;
        text-shadow:
          0 0 40px rgba(204, 0, 0, 0.7),
          0 0 80px rgba(204, 0, 0, 0.35),
          0 0 120px rgba(139, 0, 0, 0.2),
          4px 4px 10px rgba(0, 0, 0, 0.95);
        display: block;
        line-height: 1;
      }
      .hud-round-splash.animate-in {
        animation: roundSplashIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      .hud-round-splash.animate-hold {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      .hud-round-splash.animate-out {
        animation: roundSplashOut 0.8s ease-in forwards;
      }
      @keyframes roundSplashIn {
        0%   { opacity: 0; transform: translate(-50%, -50%) scale(2.5); }
        100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }
      @keyframes roundSplashOut {
        0%   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(0.85); }
      }

      /* ---- Interaction prompt smooth entrance ---- */
      #interaction-prompt.visible {
        display: block !important;
        animation: promptSlideIn 0.25s ease-out forwards;
      }
      @keyframes promptSlideIn {
        from { opacity: 0; transform: translateX(-50%) translateY(8px); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `;
    document.head.appendChild(style);
    this._styleElement = style;
  }

  /**
   * Cache references to all static DOM elements from index.html.
   * @private
   */
  _cacheStaticElements() {
    this.elements.hud = document.getElementById('hud');
    this.elements.pointsDisplay = document.getElementById('points-display');
    this.elements.pointsValue = document.getElementById('points-value');
    this.elements.roundDisplay = document.getElementById('round-display');
    this.elements.roundValue = document.getElementById('round-value');
    this.elements.ammoDisplay = document.getElementById('ammo-display');
    this.elements.ammoCurrent = document.getElementById('ammo-current');
    this.elements.ammoReserve = document.getElementById('ammo-reserve');
    this.elements.weaponName = document.getElementById('weapon-name');
    this.elements.healthIndicator = document.getElementById('health-indicator');
    this.elements.bloodOverlay = document.getElementById('blood-overlay');
    this.elements.crosshair = document.getElementById('crosshair');
    this.elements.crosshairTop = this.elements.crosshair
      ? this.elements.crosshair.querySelector('.crosshair-top')
      : null;
    this.elements.crosshairBottom = this.elements.crosshair
      ? this.elements.crosshair.querySelector('.crosshair-bottom')
      : null;
    this.elements.crosshairLeft = this.elements.crosshair
      ? this.elements.crosshair.querySelector('.crosshair-left')
      : null;
    this.elements.crosshairRight = this.elements.crosshair
      ? this.elements.crosshair.querySelector('.crosshair-right')
      : null;
    this.elements.wallBuyPrompt = document.getElementById('wall-buy-prompt');
    this.elements.interactionPrompt = document.getElementById('interaction-prompt');
    this.elements.roundAnnouncement = document.getElementById('round-announcement');
    this.elements.roundAnnounceNumber = this.elements.roundAnnouncement
      ? this.elements.roundAnnouncement.querySelector('.round-announce-number')
      : null;
    this.elements.gameOverScreen = document.getElementById('game-over-screen');
    this.elements.finalRound = document.getElementById('final-round');
    this.elements.finalKills = document.getElementById('final-kills');
    this.elements.finalHeadshots = document.getElementById('final-headshots');
    this.elements.finalPoints = document.getElementById('final-points');
    this.elements.finalShots = document.getElementById('final-shots');
    this.elements.finalAccuracy = document.getElementById('final-accuracy');
    this.elements.restartButton = document.getElementById('restart-button');
  }

  /**
   * Create all dynamic HUD elements that are not in the static HTML.
   * @private
   */
  _createDynamicElements() {
    // --- Hitmarker (X shape) ---
    const hitmarker = document.createElement('div');
    hitmarker.className = 'hud-hitmarker';
    hitmarker.innerHTML =
      '<div class="hud-hitmarker-line tl"></div>' +
      '<div class="hud-hitmarker-line tr"></div>' +
      '<div class="hud-hitmarker-line bl"></div>' +
      '<div class="hud-hitmarker-line br"></div>';
    document.body.appendChild(hitmarker);
    this.elements.hitmarker = hitmarker;

    // --- Kill feed container ---
    const killFeed = document.createElement('div');
    killFeed.className = 'hud-kill-feed';
    document.body.appendChild(killFeed);
    this.elements.killFeed = killFeed;

    // --- Reload text ---
    const reloadText = document.createElement('div');
    reloadText.className = 'hud-reload-text';
    reloadText.textContent = 'RELOAD';
    if (this.elements.hud) {
      this.elements.hud.appendChild(reloadText);
    } else {
      document.body.appendChild(reloadText);
    }
    this.elements.reloadText = reloadText;

    // --- Wave transition banner ---
    const waveBanner = document.createElement('div');
    waveBanner.className = 'hud-wave-banner';
    waveBanner.innerHTML = '<span class="hud-wave-banner-text">Preparing next wave...</span>';
    document.body.appendChild(waveBanner);
    this.elements.waveBanner = waveBanner;

    // --- Weapon swap indicator ---
    const weaponSwap = document.createElement('div');
    weaponSwap.className = 'hud-weapon-swap';
    weaponSwap.innerHTML =
      '<div class="hud-weapon-slot" data-slot="0">---</div>' +
      '<div class="hud-weapon-slot" data-slot="1">---</div>';
    document.body.appendChild(weaponSwap);
    this.elements.weaponSwap = weaponSwap;
    this.elements.weaponSlots = weaponSwap.querySelectorAll('.hud-weapon-slot');

    // --- Desaturation overlay (low health) ---
    const desatOverlay = document.createElement('div');
    desatOverlay.className = 'hud-desat-overlay';
    document.body.appendChild(desatOverlay);
    this.elements.desatOverlay = desatOverlay;

    // --- Heartbeat overlay (critical health) ---
    const heartbeatOverlay = document.createElement('div');
    heartbeatOverlay.className = 'hud-heartbeat-overlay';
    document.body.appendChild(heartbeatOverlay);
    this.elements.heartbeatOverlay = heartbeatOverlay;

    // --- Dramatic round splash (center screen) ---
    const roundSplash = document.createElement('div');
    roundSplash.className = 'hud-round-splash';
    roundSplash.innerHTML =
      '<span class="hud-round-splash-label">ROUND</span>' +
      '<span class="hud-round-splash-number">1</span>';
    document.body.appendChild(roundSplash);
    this.elements.roundSplash = roundSplash;
    this.elements.roundSplashNumber = roundSplash.querySelector('.hud-round-splash-number');
  }

  /**
   * Subscribe to eventBus events for reactive HUD updates.
   * @private
   */
  _wireEvents() {
    this._unsubs = [];

    this._unsubs.push(
      this.eventBus.on('points:updated', (points) => {
        this.updatePoints(points);
      })
    );

    this._unsubs.push(
      this.eventBus.on('round:changed', (round) => {
        this.updateRound(round);
        this.showRoundStart(round);
      })
    );

    this._unsubs.push(
      this.eventBus.on('kill:confirmed', (data) => {
        const isHeadshot = !!(data && data.headshot);
        const points = (data && data.points) || 100;
        this.showHitmarker(true, isHeadshot);
        this._addKillFeedEntry(isHeadshot, points);
      })
    );

    this._unsubs.push(
      this.eventBus.on('zombie:hit', (data) => {
        this.showHitmarker(false, false);
        if (data && typeof data.angle === 'number') {
          // Not needed on hit, but available
        }
      })
    );

    this._unsubs.push(
      this.eventBus.on('player:damaged', (data) => {
        if (data && typeof data.angle === 'number') {
          this.showDamageDirection(data.angle);
        } else {
          // If no angle provided, show generic top damage
          this.showDamageDirection(0);
        }
      })
    );

    this._unsubs.push(
      this.eventBus.on('game:over', (stats) => {
        this.showGameOver(stats);
      })
    );

    this._unsubs.push(
      this.eventBus.on('game:restarted', () => {
        this.hideGameOver();
      })
    );

    this._unsubs.push(
      this.eventBus.on('game:started', () => {
        const round = this.game ? this.game.state.round : 1;
        this.showRoundStart(round);
      })
    );

    this._unsubs.push(
      this.eventBus.on('wave:complete', () => {
        this._showWaveTransition();
      })
    );

    this._unsubs.push(
      this.eventBus.on('weapon:swapped', (data) => {
        this._showWeaponSwap(data);
      })
    );

    this._unsubs.push(
      this.eventBus.on('weapon:hitmarker', (data) => {
        const isKill = !!(data && data.kill);
        const isHeadshot = !!(data && data.headshot);
        this.showHitmarker(isKill, isHeadshot);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  /**
   * Called every frame from the game loop. Polls current game state and
   * pushes changes to the DOM only when values have changed.
   * @param {number} _deltaTime - Frame delta (unused directly, kept for API compat)
   */
  update(_deltaTime) {
    if (!this.game) return;

    const state = this.game.state;
    const player = this.game.player;
    const weaponSystem = this.game.weaponSystem;

    // Build a gameState snapshot from available systems
    const gameState = {
      points: state.points || 0,
      round: state.round || 1,
      health: 100,
      maxHealth: 100,
      ammo: 0,
      reserveAmmo: 0,
      magazineSize: 1,
      weaponName: '',
      isReloading: false,
      weapons: [],
      currentWeaponIndex: 0,
    };

    // Pull health from player
    if (player) {
      if (typeof player.getHealth === 'function') {
        gameState.health = player.getHealth();
      } else if (typeof player.health === 'number') {
        gameState.health = player.health;
      }
      if (typeof player.getMaxHealth === 'function') {
        gameState.maxHealth = player.getMaxHealth();
      } else if (typeof player.maxHealth === 'number') {
        gameState.maxHealth = player.maxHealth;
      }
    }

    // Pull weapon data from weapon system
    if (weaponSystem) {
      if (typeof weaponSystem.getCurrentAmmo === 'function') {
        gameState.ammo = weaponSystem.getCurrentAmmo();
      } else if (typeof weaponSystem.ammo === 'number') {
        gameState.ammo = weaponSystem.ammo;
      }
      if (typeof weaponSystem.getReserveAmmo === 'function') {
        gameState.reserveAmmo = weaponSystem.getReserveAmmo();
      } else if (typeof weaponSystem.reserveAmmo === 'number') {
        gameState.reserveAmmo = weaponSystem.reserveAmmo;
      }
      if (typeof weaponSystem.getMagazineSize === 'function') {
        gameState.magazineSize = weaponSystem.getMagazineSize();
      } else if (typeof weaponSystem.magazineSize === 'number') {
        gameState.magazineSize = weaponSystem.magazineSize;
      }
      if (typeof weaponSystem.getCurrentWeaponName === 'function') {
        gameState.weaponName = weaponSystem.getCurrentWeaponName();
      } else if (typeof weaponSystem.weaponName === 'string') {
        gameState.weaponName = weaponSystem.weaponName;
      }
      if (typeof weaponSystem.isReloading === 'function') {
        gameState.isReloading = weaponSystem.isReloading();
      } else if (typeof weaponSystem.reloading === 'boolean') {
        gameState.isReloading = weaponSystem.reloading;
      }
      if (typeof weaponSystem.getWeapons === 'function') {
        gameState.weapons = weaponSystem.getWeapons();
      } else if (Array.isArray(weaponSystem.weapons)) {
        gameState.weapons = weaponSystem.weapons;
      }
      if (typeof weaponSystem.getCurrentWeaponIndex === 'function') {
        gameState.currentWeaponIndex = weaponSystem.getCurrentWeaponIndex();
      } else if (typeof weaponSystem.currentWeaponIndex === 'number') {
        gameState.currentWeaponIndex = weaponSystem.currentWeaponIndex;
      }
    }

    // Only push DOM writes when values change
    if (gameState.points !== this._lastPoints) {
      this.updatePoints(gameState.points);
    }
    if (
      gameState.ammo !== this._lastAmmo ||
      gameState.reserveAmmo !== this._lastReserve ||
      gameState.magazineSize !== this._lastMagSize
    ) {
      this.updateAmmo(gameState.ammo, gameState.reserveAmmo, gameState.magazineSize);
    }
    if (
      gameState.health !== this._lastHealth ||
      gameState.maxHealth !== this._lastMaxHealth
    ) {
      this.updateHealth(gameState.health, gameState.maxHealth);
    }
    if (gameState.weaponName !== this._lastWeaponName) {
      this.updateWeaponName(gameState.weaponName);
    }
    if (gameState.round !== this._lastRound) {
      this.updateRound(gameState.round);
    }

    // Handle reload flash
    if (gameState.isReloading || gameState.ammo === 0) {
      this._showReloadFlash(true);
    } else {
      this._showReloadFlash(false);
    }

    // Smooth crosshair interpolation
    if (this._crosshairSpread !== this._crosshairTargetSpread) {
      this._crosshairSpread += (this._crosshairTargetSpread - this._crosshairSpread) * 0.15;
      if (Math.abs(this._crosshairSpread - this._crosshairTargetSpread) < 0.5) {
        this._crosshairSpread = this._crosshairTargetSpread;
      }
      this._applyCrosshairSpread(this._crosshairSpread);
    }

    // Clean expired damage indicators
    this._cleanDamageIndicators();
  }

  // ---------------------------------------------------------------------------
  // Points
  // ---------------------------------------------------------------------------

  /**
   * Update the points display. Triggers pop animation on change.
   * @param {number} points - Current point total
   */
  updatePoints(points) {
    if (points === this._lastPoints) return;

    const gained = points > this._lastPoints && this._lastPoints >= 0;
    const amount = points - (this._lastPoints >= 0 ? this._lastPoints : 0);
    this._lastPoints = points;

    const el = this.elements.pointsValue;
    if (!el) return;

    el.textContent = points.toLocaleString();

    // Pop animation
    el.classList.remove('points-added', 'points-pop');
    // Force reflow to restart animation
    void el.offsetWidth;
    el.classList.add('points-added', 'points-pop');

    // Show floating gain text
    if (gained && amount > 0) {
      this.showPointGain(amount);
    }
  }

  /**
   * Display a floating "+X" point gain near the points display.
   * @param {number} amount - Points gained
   * @param {{ x: number, y: number }} [position] - Optional screen position
   */
  showPointGain(amount, position) {
    const el = document.createElement('div');
    el.className = 'hud-float-points';
    el.textContent = `+${amount}`;

    if (position && typeof position.x === 'number' && typeof position.y === 'number') {
      el.style.left = `${position.x}px`;
      el.style.top = `${position.y}px`;
    } else {
      // Position near the points display
      const pointsEl = this.elements.pointsValue;
      if (pointsEl) {
        const rect = pointsEl.getBoundingClientRect();
        el.style.left = `${rect.left + rect.width + 10}px`;
        el.style.top = `${rect.top + rect.height * 0.3}px`;
      } else {
        el.style.left = '140px';
        el.style.top = '28px';
      }
    }

    this._floatCounter++;
    document.body.appendChild(el);

    // Remove after animation completes
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 1250);
  }

  // ---------------------------------------------------------------------------
  // Ammo
  // ---------------------------------------------------------------------------

  /**
   * Update the ammo counter display.
   * @param {number} current - Rounds in magazine
   * @param {number} reserve - Reserve ammo
   * @param {number} magazineSize - Magazine capacity
   */
  updateAmmo(current, reserve, magazineSize) {
    this._lastAmmo = current;
    this._lastReserve = reserve;
    this._lastMagSize = magazineSize;

    const curEl = this.elements.ammoCurrent;
    const resEl = this.elements.ammoReserve;
    const container = this.elements.ammoDisplay;

    if (curEl) curEl.textContent = current;
    if (resEl) resEl.textContent = reserve;

    // Low ammo warning (< 25% of magazine)
    if (container) {
      const threshold = Math.max(1, Math.floor(magazineSize * 0.25));
      if (current <= threshold && current > 0) {
        container.classList.add('low-ammo');
      } else {
        container.classList.remove('low-ammo');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Health / Damage overlay
  // ---------------------------------------------------------------------------

  /**
   * Update health-related screen effects: blood vignette, desaturation,
   * heartbeat at critical health.
   * @param {number} health - Current health
   * @param {number} maxHealth - Maximum health
   */
  updateHealth(health, maxHealth) {
    this._lastHealth = health;
    this._lastMaxHealth = maxHealth;

    const ratio = maxHealth > 0 ? Math.max(0, Math.min(1, health / maxHealth)) : 1;

    // Blood vignette intensity: 0 at full health, 1 at 0 health
    // Starts becoming visible below 70% health
    let vignetteIntensity = 0;
    if (ratio < 0.7) {
      vignetteIntensity = 1 - (ratio / 0.7);
    }
    this.setDamageOverlay(vignetteIntensity);

    // Screen desaturation at low health (below 40%)
    const desatEl = this.elements.desatOverlay;
    if (desatEl) {
      if (ratio < 0.4) {
        const desatAmount = 1 - (ratio / 0.4);
        desatEl.style.opacity = (desatAmount * 0.6).toFixed(2);
        desatEl.style.background = `rgba(80, 80, 80, ${(desatAmount * 0.35).toFixed(2)})`;
      } else {
        desatEl.style.opacity = '0';
      }
    }

    // Heartbeat / critical health pulse (below 25%)
    const heartbeatEl = this.elements.heartbeatOverlay;
    if (heartbeatEl) {
      if (ratio < 0.25 && ratio > 0) {
        if (!this._healthPulseActive) {
          this._healthPulseActive = true;
          heartbeatEl.classList.add('active');
        }
      } else {
        if (this._healthPulseActive) {
          this._healthPulseActive = false;
          heartbeatEl.classList.remove('active');
        }
      }
    }

    // Blood overlay critical pulsing
    const bloodEl = this.elements.bloodOverlay;
    if (bloodEl) {
      if (ratio < 0.25 && ratio > 0) {
        bloodEl.classList.add('critical');
        bloodEl.classList.remove('active');
      } else if (vignetteIntensity > 0) {
        bloodEl.classList.add('active');
        bloodEl.classList.remove('critical');
      } else {
        bloodEl.classList.remove('active', 'critical');
      }
    }
  }

  /**
   * Directly set the blood vignette overlay intensity.
   * @param {number} intensity - Overlay intensity from 0 (none) to 1 (max)
   */
  setDamageOverlay(intensity) {
    const bloodEl = this.elements.bloodOverlay;
    if (!bloodEl) return;

    const clamped = Math.max(0, Math.min(1, intensity));
    bloodEl.style.opacity = clamped.toFixed(3);
  }

  // ---------------------------------------------------------------------------
  // Weapon name
  // ---------------------------------------------------------------------------

  /**
   * Update the weapon name text.
   * @param {string} name - Display name of current weapon
   */
  updateWeaponName(name) {
    this._lastWeaponName = name;
    const el = this.elements.weaponName;
    if (el && name) {
      el.textContent = name;
    }
  }

  // ---------------------------------------------------------------------------
  // Round
  // ---------------------------------------------------------------------------

  /**
   * Update the persistent round counter in the corner.
   * @param {number} round
   */
  updateRound(round) {
    if (round === this._lastRound) return;
    this._lastRound = round;

    const el = this.elements.roundValue;
    if (el) {
      el.textContent = round;
    }
  }

  /**
   * Trigger the dramatic round splash animation in the center of the screen.
   * Fades in from scale 2.5x, holds for ~2s, then fades out.
   * @param {number} round
   */
  showRoundStart(round) {
    // Clear any pending round splash timeouts
    for (const t of this._roundSplashTimeouts) {
      clearTimeout(t);
    }
    this._roundSplashTimeouts = [];

    // Also update the static round announcement from the HTML
    const announceEl = this.elements.roundAnnouncement;
    const announceNumEl = this.elements.roundAnnounceNumber;
    if (announceEl && announceNumEl) {
      announceNumEl.textContent = round;
      announceEl.classList.remove('hidden');
      this._roundSplashTimeouts.push(
        setTimeout(() => {
          announceEl.classList.add('hidden');
        }, 3000)
      );
    }

    // Dramatic splash overlay
    const splash = this.elements.roundSplash;
    const splashNum = this.elements.roundSplashNumber;
    if (!splash || !splashNum) return;

    splashNum.textContent = round;

    // Reset classes
    splash.classList.remove('animate-in', 'animate-hold', 'animate-out');
    splash.style.opacity = '0';

    // Force reflow
    void splash.offsetWidth;

    // Phase 1: Scale in (0.6s)
    splash.classList.add('animate-in');

    // Phase 2: Hold (after scale-in completes)
    this._roundSplashTimeouts.push(
      setTimeout(() => {
        splash.classList.remove('animate-in');
        splash.classList.add('animate-hold');
      }, 600)
    );

    // Phase 3: Fade out (after hold ~2s)
    this._roundSplashTimeouts.push(
      setTimeout(() => {
        splash.classList.remove('animate-hold');
        splash.classList.add('animate-out');
      }, 2600)
    );

    // Phase 4: Cleanup
    this._roundSplashTimeouts.push(
      setTimeout(() => {
        splash.classList.remove('animate-out');
        splash.style.opacity = '0';
      }, 3400)
    );
  }

  // ---------------------------------------------------------------------------
  // Crosshair
  // ---------------------------------------------------------------------------

  /**
   * Adjust crosshair spread. Higher values spread lines further from center.
   * @param {number} spread - Target spread in pixels (default resting ~18)
   */
  updateCrosshair(spread) {
    this._crosshairTargetSpread = Math.max(6, Math.min(60, spread));
  }

  /**
   * Apply the current crosshair spread to the DOM elements.
   * @param {number} spread
   * @private
   */
  _applyCrosshairSpread(spread) {
    const { crosshairTop, crosshairBottom, crosshairLeft, crosshairRight } = this.elements;
    if (crosshairTop) crosshairTop.style.top = `-${spread}px`;
    if (crosshairBottom) crosshairBottom.style.bottom = `-${spread}px`;
    if (crosshairLeft) crosshairLeft.style.left = `-${spread}px`;
    if (crosshairRight) crosshairRight.style.right = `-${spread}px`;
  }

  // ---------------------------------------------------------------------------
  // Hitmarker
  // ---------------------------------------------------------------------------

  /**
   * Flash the hitmarker. White for hit, red for kill, and optionally
   * a different visual for headshots.
   * @param {boolean} isKill - True if this hit killed the zombie
   * @param {boolean} isHeadshot - True if headshot
   */
  showHitmarker(isKill = false, isHeadshot = false) {
    const el = this.elements.hitmarker;
    if (!el) return;

    // Clear previous timeout
    if (this._hitmarkerTimeout) {
      clearTimeout(this._hitmarkerTimeout);
      this._hitmarkerTimeout = null;
    }

    // Apply classes
    el.classList.remove('visible', 'kill');
    // Force reflow
    void el.offsetWidth;

    if (isKill) {
      el.classList.add('kill');
    }
    el.classList.add('visible');

    // Duration: kills stay longer
    const duration = isKill ? 350 : 150;

    this._hitmarkerTimeout = setTimeout(() => {
      el.classList.remove('visible', 'kill');
      this._hitmarkerTimeout = null;
    }, duration);

    // If headshot kill, also fire a kill feed entry
    if (isHeadshot) {
      // Headshots handled by kill:confirmed event
    }
  }

  // ---------------------------------------------------------------------------
  // Damage direction indicator
  // ---------------------------------------------------------------------------

  /**
   * Show a directional damage indicator. A red chevron appears on the screen
   * edge pointing toward the angle the damage came from, then fades after 1s.
   * @param {number} angle - Direction in radians (0 = from front/top)
   */
  showDamageDirection(angle) {
    const indicator = document.createElement('div');
    indicator.className = 'hud-damage-dir';
    indicator.innerHTML = '<div class="hud-damage-dir-arrow"></div>';

    // Rotate the entire container so the arrow points toward the source
    // angle=0 => top, angle=PI/2 => right, angle=PI => bottom, etc.
    const degrees = (angle * 180) / Math.PI;
    indicator.style.transform = `rotate(${degrees}deg)`;

    document.body.appendChild(indicator);

    // Force reflow then activate
    void indicator.offsetWidth;
    indicator.classList.add('active');

    const entry = {
      el: indicator,
      startTime: performance.now(),
      duration: 1000,
    };
    this._damageIndicators.push(entry);

    // Start fade-out after most of the duration
    setTimeout(() => {
      indicator.classList.remove('active');
    }, 700);

    // Remove from DOM after full duration + transition time
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    }, 1100);
  }

  /**
   * Clean up expired damage direction indicators from tracking array.
   * @private
   */
  _cleanDamageIndicators() {
    const now = performance.now();
    this._damageIndicators = this._damageIndicators.filter((entry) => {
      return now - entry.startTime < entry.duration + 200;
    });
  }

  // ---------------------------------------------------------------------------
  // Interaction prompt
  // ---------------------------------------------------------------------------

  /**
   * Display an interaction prompt at the bottom-center of the screen.
   * Supports styles like "Press F to buy Thompson [1500]" or
   * "Hold F for Mystery Box [950]".
   * @param {string} text - The prompt text to display
   */
  showInteractionPrompt(text) {
    const el = this.elements.interactionPrompt;
    if (!el) return;

    el.textContent = text;
    el.classList.remove('hidden');
    el.classList.add('visible');
  }

  /**
   * Hide the interaction prompt.
   */
  hideInteractionPrompt() {
    const el = this.elements.interactionPrompt;
    if (!el) return;

    el.classList.remove('visible');
    el.classList.add('hidden');
  }

  // ---------------------------------------------------------------------------
  // Kill feed
  // ---------------------------------------------------------------------------

  /**
   * Add an entry to the kill feed in the upper-left corner.
   * @param {boolean} isHeadshot
   * @param {number} points
   * @private
   */
  _addKillFeedEntry(isHeadshot, points) {
    const container = this.elements.killFeed;
    if (!container) return;

    const entry = document.createElement('div');
    entry.className = 'hud-kill-feed-entry';
    if (isHeadshot) {
      entry.classList.add('headshot');
      entry.textContent = `Headshot +${points}`;
    } else {
      entry.textContent = `Kill +${points}`;
    }

    container.appendChild(entry);
    this._killFeedEntries.push(entry);

    // Cap max entries
    while (this._killFeedEntries.length > this._killFeedMax) {
      const oldest = this._killFeedEntries.shift();
      if (oldest && oldest.parentNode) {
        oldest.parentNode.removeChild(oldest);
      }
    }

    // Fade out after 2 seconds
    setTimeout(() => {
      entry.classList.add('fade-out');
    }, 2000);

    // Remove from DOM after fade completes
    setTimeout(() => {
      if (entry.parentNode) {
        entry.parentNode.removeChild(entry);
      }
      const idx = this._killFeedEntries.indexOf(entry);
      if (idx !== -1) this._killFeedEntries.splice(idx, 1);
    }, 2500);
  }

  // ---------------------------------------------------------------------------
  // Reload flash
  // ---------------------------------------------------------------------------

  /**
   * Show or hide the flashing RELOAD text.
   * @param {boolean} show
   * @private
   */
  _showReloadFlash(show) {
    const el = this.elements.reloadText;
    if (!el) return;

    if (show) {
      el.classList.add('visible');
    } else {
      el.classList.remove('visible');
    }
  }

  // ---------------------------------------------------------------------------
  // Wave transition banner
  // ---------------------------------------------------------------------------

  /**
   * Show "Preparing next wave..." banner between rounds.
   * @private
   */
  _showWaveTransition() {
    const el = this.elements.waveBanner;
    if (!el) return;

    if (this._waveTransitionTimeout) {
      clearTimeout(this._waveTransitionTimeout);
    }

    const textEl = el.querySelector('.hud-wave-banner-text');
    if (textEl) {
      textEl.textContent = 'Preparing next wave...';
    }

    el.classList.add('visible');

    // Hide after a few seconds (wave manager controls actual timing)
    this._waveTransitionTimeout = setTimeout(() => {
      el.classList.remove('visible');
      this._waveTransitionTimeout = null;
    }, 4000);
  }

  /**
   * Hide the wave transition banner (called when next round starts).
   * @private
   */
  _hideWaveTransition() {
    const el = this.elements.waveBanner;
    if (!el) return;

    el.classList.remove('visible');
    if (this._waveTransitionTimeout) {
      clearTimeout(this._waveTransitionTimeout);
      this._waveTransitionTimeout = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Weapon swap indicator
  // ---------------------------------------------------------------------------

  /**
   * Show the weapon swap indicator briefly when switching weapons.
   * @param {object} [data] - Optional data with weapon names and active index
   * @private
   */
  _showWeaponSwap(data) {
    const el = this.elements.weaponSwap;
    const slots = this.elements.weaponSlots;
    if (!el || !slots || slots.length === 0) return;

    if (this._weaponSwapTimeout) {
      clearTimeout(this._weaponSwapTimeout);
    }

    // Update slot text if data available
    if (data && Array.isArray(data.weapons)) {
      slots.forEach((slot, i) => {
        if (data.weapons[i]) {
          slot.textContent = data.weapons[i].name || data.weapons[i];
        } else {
          slot.textContent = '---';
        }
        slot.classList.remove('active');
      });
    }

    // Highlight active slot
    const activeIndex =
      data && typeof data.currentIndex === 'number' ? data.currentIndex : 0;
    if (slots[activeIndex]) {
      slots[activeIndex].classList.add('active');
    }

    el.classList.add('visible');

    this._weaponSwapTimeout = setTimeout(() => {
      el.classList.remove('visible');
      this._weaponSwapTimeout = null;
    }, 2000);
  }

  // ---------------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------------

  /**
   * Display the game over screen with final stats.
   * @param {object} stats - { round, kills, headshots, points, shots, accuracy, survived }
   */
  showGameOver(stats) {
    const screen = this.elements.gameOverScreen;
    if (!screen) return;

    // Populate stats
    if (this.elements.finalRound && stats.round != null) {
      this.elements.finalRound.textContent = stats.round;
    }
    if (this.elements.finalKills && stats.kills != null) {
      this.elements.finalKills.textContent = stats.kills.toLocaleString();
    }
    if (this.elements.finalHeadshots && stats.headshots != null) {
      this.elements.finalHeadshots.textContent = stats.headshots.toLocaleString();
    }
    if (this.elements.finalPoints && stats.points != null) {
      this.elements.finalPoints.textContent = stats.points.toLocaleString();
    }
    if (this.elements.finalShots && stats.shots != null) {
      this.elements.finalShots.textContent = stats.shots.toLocaleString();
    }
    if (this.elements.finalAccuracy) {
      if (stats.accuracy != null) {
        this.elements.finalAccuracy.textContent =
          typeof stats.accuracy === 'string' ? stats.accuracy : `${stats.accuracy}%`;
      } else if (stats.shots > 0 && stats.kills != null) {
        const pct = Math.round((stats.kills / stats.shots) * 100);
        this.elements.finalAccuracy.textContent = `${pct}%`;
      }
    }

    // Show the screen
    screen.classList.remove('hidden', 'fade-out');
    screen.style.display = 'flex';
  }

  /**
   * Hide the game over screen.
   */
  hideGameOver() {
    const screen = this.elements.gameOverScreen;
    if (!screen) return;

    screen.classList.add('fade-out');
    setTimeout(() => {
      screen.style.display = 'none';
      screen.classList.remove('fade-out');
      screen.classList.add('hidden');
    }, 600);
  }

  // ---------------------------------------------------------------------------
  // Reset (for game restart)
  // ---------------------------------------------------------------------------

  /**
   * Reset all HUD state for a new game. Clears all overlays, resets displays
   * to starting values.
   */
  reset() {
    // Reset tracking state
    this._lastPoints = -1;
    this._lastAmmo = -1;
    this._lastReserve = -1;
    this._lastMagSize = -1;
    this._lastHealth = -1;
    this._lastMaxHealth = -1;
    this._lastRound = -1;
    this._lastWeaponName = '';
    this._lastWeaponIndex = -1;

    // Reset visual displays to defaults
    this.updatePoints(500);
    this.updateRound(1);
    this.updateAmmo(0, 0, 1);
    this.updateWeaponName('');
    this.setDamageOverlay(0);

    // Clear blood overlay classes
    const bloodEl = this.elements.bloodOverlay;
    if (bloodEl) {
      bloodEl.classList.remove('active', 'critical');
      bloodEl.style.opacity = '0';
    }

    // Clear desaturation
    const desatEl = this.elements.desatOverlay;
    if (desatEl) {
      desatEl.style.opacity = '0';
    }

    // Clear heartbeat
    const heartbeatEl = this.elements.heartbeatOverlay;
    if (heartbeatEl) {
      heartbeatEl.classList.remove('active');
    }
    this._healthPulseActive = false;

    // Hide hitmarker
    const hitmarker = this.elements.hitmarker;
    if (hitmarker) {
      hitmarker.classList.remove('visible', 'kill');
    }
    if (this._hitmarkerTimeout) {
      clearTimeout(this._hitmarkerTimeout);
      this._hitmarkerTimeout = null;
    }

    // Hide interaction prompt
    this.hideInteractionPrompt();

    // Clear kill feed
    const killFeedContainer = this.elements.killFeed;
    if (killFeedContainer) {
      killFeedContainer.innerHTML = '';
    }
    this._killFeedEntries = [];

    // Clear damage indicators
    for (const entry of this._damageIndicators) {
      if (entry.el && entry.el.parentNode) {
        entry.el.parentNode.removeChild(entry.el);
      }
    }
    this._damageIndicators = [];

    // Hide wave banner
    this._hideWaveTransition();

    // Hide weapon swap
    const weaponSwap = this.elements.weaponSwap;
    if (weaponSwap) {
      weaponSwap.classList.remove('visible');
    }
    if (this._weaponSwapTimeout) {
      clearTimeout(this._weaponSwapTimeout);
      this._weaponSwapTimeout = null;
    }

    // Clear round splash
    const roundSplash = this.elements.roundSplash;
    if (roundSplash) {
      roundSplash.classList.remove('animate-in', 'animate-hold', 'animate-out');
      roundSplash.style.opacity = '0';
    }
    for (const t of this._roundSplashTimeouts) {
      clearTimeout(t);
    }
    this._roundSplashTimeouts = [];

    // Stop reload flash
    this._showReloadFlash(false);

    // Hide game over
    this.hideGameOver();

    // Reset crosshair
    this._crosshairSpread = 18;
    this._crosshairTargetSpread = 18;
    this._applyCrosshairSpread(18);
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  /**
   * Remove all dynamically created elements, unsubscribe events, and clean up.
   */
  dispose() {
    // Unsubscribe all eventBus listeners
    if (this._unsubs) {
      for (const unsub of this._unsubs) {
        if (typeof unsub === 'function') unsub();
      }
      this._unsubs = [];
    }

    // Clear all timeouts
    if (this._hitmarkerTimeout) clearTimeout(this._hitmarkerTimeout);
    if (this._waveTransitionTimeout) clearTimeout(this._waveTransitionTimeout);
    if (this._weaponSwapTimeout) clearTimeout(this._weaponSwapTimeout);
    if (this._reloadFlashInterval) clearInterval(this._reloadFlashInterval);
    for (const t of this._roundSplashTimeouts) {
      clearTimeout(t);
    }
    this._roundSplashTimeouts = [];

    // Remove dynamic DOM elements
    const dynamicElements = [
      this.elements.hitmarker,
      this.elements.killFeed,
      this.elements.reloadText,
      this.elements.waveBanner,
      this.elements.weaponSwap,
      this.elements.desatOverlay,
      this.elements.heartbeatOverlay,
      this.elements.roundSplash,
    ];

    for (const el of dynamicElements) {
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }

    // Remove damage direction indicators
    for (const entry of this._damageIndicators) {
      if (entry.el && entry.el.parentNode) {
        entry.el.parentNode.removeChild(entry.el);
      }
    }
    this._damageIndicators = [];

    // Remove floating point text elements
    const floaters = document.querySelectorAll('.hud-float-points');
    floaters.forEach((f) => {
      if (f.parentNode) f.parentNode.removeChild(f);
    });

    // Remove kill feed entries
    this._killFeedEntries = [];

    // Remove injected styles
    if (this._styleElement && this._styleElement.parentNode) {
      this._styleElement.parentNode.removeChild(this._styleElement);
      this._styleElement = null;
    }

    // Null out element references
    this.elements = {};
    this.game = null;
    this.eventBus = null;
  }
}
