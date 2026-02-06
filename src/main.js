import * as THREE from 'three';
import { GameRenderer } from './engine/renderer.js';
import { InputManager } from './engine/input.js';
import { Player } from './player/player.js';
import { ZombieManager } from './zombies/zombieManager.js';
import { WeaponSystem } from './weapons/weaponSystem.js';
import { BunkerMap } from './map/bunkerMap.js';
import { HUD } from './ui/hud.js';
import { AudioManager } from './audio/audioManager.js';
import { WaveManager } from './zombies/waveManager.js';
import { WallBuySystem } from './weapons/wallBuySystem.js';

// ---------------------------------------------------------------------------
// EventBus - Simple pub/sub for cross-system communication
// ---------------------------------------------------------------------------

export class EventBus {
  constructor() {
    /** @type {Object<string, Set<Function>>} */
    this.listeners = {};
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} Unsubscribe function for convenience
   */
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set();
    }
    this.listeners[event].add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    const callbacks = this.listeners[event];
    if (!callbacks) return;
    for (const cb of callbacks) {
      try {
        cb(data);
      } catch (err) {
        console.error(`EventBus: Error in listener for "${event}":`, err);
      }
    }
  }

  /**
   * Unsubscribe from an event.
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    const callbacks = this.listeners[event];
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        delete this.listeners[event];
      }
    }
  }

  /**
   * Remove all listeners, optionally for a specific event.
   * @param {string} [event]
   */
  clear(event) {
    if (event) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
  }
}

// ---------------------------------------------------------------------------
// Global instances
// ---------------------------------------------------------------------------

/** @type {EventBus} Global event bus for cross-system communication */
export const eventBus = new EventBus();

/** @type {Game} Global game instance (set after DOMContentLoaded) */
export let game = null;

// ---------------------------------------------------------------------------
// Game - Core engine that ties every system together
// ---------------------------------------------------------------------------

export class Game {
  constructor() {
    // ---- Core game state ----
    this.state = {
      round: 1,
      points: 500, // Starting points, classic Zombies
      isRunning: false,
      isPaused: false,
      gameOver: false,
      killCount: 0,
      startTime: 0,
    };

    // ---- System references (populated in init) ----
    /** @type {THREE.Clock} */
    this.clock = null;
    /** @type {GameRenderer} */
    this.gameRenderer = null;
    /** @type {InputManager} */
    this.input = null;
    /** @type {BunkerMap} */
    this.map = null;
    /** @type {Player} */
    this.player = null;
    /** @type {WeaponSystem} */
    this.weaponSystem = null;
    /** @type {ZombieManager} */
    this.zombieManager = null;
    /** @type {WaveManager} */
    this.waveManager = null;
    /** @type {WallBuySystem} */
    this.wallBuySystem = null;
    /** @type {HUD} */
    this.hud = null;
    /** @type {AudioManager} */
    this.audio = null;

    /** @type {number|null} requestAnimationFrame ID */
    this._rafId = null;

    // Bind the game loop so we can use it as a RAF callback
    this._boundGameLoop = this.gameLoop.bind(this);
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  /**
   * Asynchronous initialization of all game systems.
   * Shows a loading screen with progress updates.
   */
  async init() {
    const loadingScreen = document.getElementById('loading-screen');
    const progressBar = document.getElementById('loading-progress');
    const loadingText = document.getElementById('loading-text');

    const totalSteps = 10;
    let currentStep = 0;

    /**
     * Update the loading UI.
     * @param {string} message
     */
    const progress = (message) => {
      currentStep++;
      const pct = Math.round((currentStep / totalSteps) * 100);
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (loadingText) loadingText.textContent = message;
      console.log(`[Load ${pct}%] ${message}`);
    };

    try {
      // Clock
      this.clock = new THREE.Clock(false); // Don't auto-start

      // 1. Renderer (scene, camera, lighting)
      progress('Initializing renderer...');
      this.gameRenderer = new GameRenderer();
      this.gameRenderer.init();

      // 2. Input
      progress('Setting up input...');
      this.input = new InputManager();

      // 3. Map
      progress('Building bunker map...');
      this.map = new BunkerMap(this.gameRenderer.getScene());
      if (typeof this.map.init === 'function') {
        await this.map.init();
      }

      // 4. Player
      progress('Spawning player...');
      this.player = new Player(
        this.gameRenderer.getCamera(),
        this.input,
        this.gameRenderer.getScene()
      );
      if (typeof this.player.init === 'function') {
        await this.player.init();
      }

      // 5. Weapon system
      progress('Loading weapons...');
      this.weaponSystem = new WeaponSystem(
        this.gameRenderer.getScene(),
        this.gameRenderer.getCamera(),
        this.input,
        this.player
      );
      if (typeof this.weaponSystem.init === 'function') {
        await this.weaponSystem.init();
      }

      // 6. Zombie manager
      progress('Preparing zombie hordes...');
      this.zombieManager = new ZombieManager(
        this.gameRenderer.getScene(),
        this.player
      );
      if (typeof this.zombieManager.init === 'function') {
        await this.zombieManager.init();
      }

      // 7. Wave manager
      progress('Configuring waves...');
      this.waveManager = new WaveManager(this.zombieManager, this);
      if (typeof this.waveManager.init === 'function') {
        await this.waveManager.init();
      }

      // 8. Wall buy system
      progress('Scanning wall buys...');
      this.wallBuySystem = new WallBuySystem(
        this.gameRenderer.getScene(),
        this.player,
        this.weaponSystem,
        this
      );
      if (typeof this.wallBuySystem.init === 'function') {
        await this.wallBuySystem.init();
      }

      // 9. HUD
      progress('Building HUD...');
      this.hud = new HUD(this);
      if (typeof this.hud.init === 'function') {
        await this.hud.init();
      }

      // 10. Audio
      progress('Loading audio...');
      this.audio = new AudioManager(this.gameRenderer.getCamera());
      if (typeof this.audio.init === 'function') {
        await this.audio.init();
      }

      // Wire up core events
      this._setupEvents();

      // Hide loading, show start screen
      if (loadingScreen) loadingScreen.style.display = 'none';

      const startScreen = document.getElementById('start-screen');
      if (startScreen) {
        startScreen.style.display = 'flex';
        startScreen.addEventListener('click', () => this.start(), { once: true });
      } else {
        // No start screen in DOM - start immediately
        this.start();
      }

      console.log('[Game] Initialization complete.');
    } catch (err) {
      console.error('[Game] Initialization failed:', err);
      if (loadingText) loadingText.textContent = `Error: ${err.message}`;
    }
  }

  /**
   * Wire up EventBus listeners for cross-system communication.
   * @private
   */
  _setupEvents() {
    eventBus.on('zombie:killed', (zombie) => this.onZombieKilled(zombie));
    eventBus.on('player:death', () => this.onPlayerDeath());
    eventBus.on('points:add', (amount) => this.addPoints(amount));
    eventBus.on('points:spend', (amount) => this.spendPoints(amount));
    eventBus.on('wave:complete', () => this._onWaveComplete());
    eventBus.on('game:pause', () => this.pause());
    eventBus.on('game:resume', () => this.resume());
  }

  // -----------------------------------------------------------------------
  // Game lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the game. Hides the start screen, locks the pointer, and begins
   * the first wave and game loop.
   */
  start() {
    const startScreen = document.getElementById('start-screen');
    if (startScreen) startScreen.style.display = 'none';

    this.input.requestPointerLock();

    this.state.isRunning = true;
    this.state.isPaused = false;
    this.state.gameOver = false;
    this.state.startTime = performance.now();

    // Start the first wave
    if (this.waveManager && typeof this.waveManager.startWave === 'function') {
      this.waveManager.startWave(this.state.round);
    }

    eventBus.emit('game:started', { round: this.state.round });

    // Start the clock and game loop
    this.clock.start();
    this._rafId = requestAnimationFrame(this._boundGameLoop);

    console.log('[Game] Started.');
  }

  /**
   * Pause the game.
   */
  pause() {
    if (!this.state.isRunning || this.state.gameOver) return;
    this.state.isPaused = true;
    this.clock.stop();
    eventBus.emit('game:paused');
  }

  /**
   * Resume from pause.
   */
  resume() {
    if (!this.state.isRunning || this.state.gameOver) return;
    this.state.isPaused = false;
    this.clock.start();
    eventBus.emit('game:resumed');
  }

  // -----------------------------------------------------------------------
  // Main loop
  // -----------------------------------------------------------------------

  /**
   * The requestAnimationFrame game loop.
   */
  gameLoop() {
    this._rafId = requestAnimationFrame(this._boundGameLoop);

    const deltaTime = this.clock.getDelta();
    // Clamp deltaTime to prevent spiral of death after tab-away
    const clampedDelta = Math.min(deltaTime, 0.1);

    this.update(clampedDelta);

    // Renderer flicker light update + render
    this.gameRenderer.update(clampedDelta);
    this.gameRenderer.render();
  }

  /**
   * Main per-frame update. Ticks every game system in the correct order.
   * @param {number} deltaTime - Clamped frame delta in seconds
   */
  update(deltaTime) {
    if (this.state.isPaused || this.state.gameOver) return;

    // 1. Input (flush per-frame buffers)
    this.input.update();

    // Pause toggle (Escape while running)
    if (this.input.isKeyPressed('Escape')) {
      if (this.state.isPaused) {
        this.resume();
      } else {
        this.pause();
      }
      return;
    }

    // 2. Player (movement, camera look)
    if (this.player && typeof this.player.update === 'function') {
      this.player.update(deltaTime);
    }

    // 3. Weapon system (shooting, reloading, animations)
    if (this.weaponSystem && typeof this.weaponSystem.update === 'function') {
      this.weaponSystem.update(deltaTime);
    }

    // 4. Zombie manager (AI, pathfinding, attacks)
    if (this.zombieManager && typeof this.zombieManager.update === 'function') {
      this.zombieManager.update(deltaTime);
    }

    // 5. Wave manager (check wave completion, next wave timer)
    if (this.waveManager && typeof this.waveManager.update === 'function') {
      this.waveManager.update(deltaTime);
    }

    // 6. Wall buy system (proximity detection)
    if (this.wallBuySystem && typeof this.wallBuySystem.update === 'function') {
      this.wallBuySystem.update(deltaTime);
    }

    // 7. HUD (refresh displays)
    if (this.hud && typeof this.hud.update === 'function') {
      this.hud.update(deltaTime);
    }

    // 8. Audio manager (spatial audio, ambient updates)
    if (this.audio && typeof this.audio.update === 'function') {
      this.audio.update(deltaTime);
    }

    // 9. Check game over condition
    if (this.player && typeof this.player.getHealth === 'function') {
      if (this.player.getHealth() <= 0) {
        this.onPlayerDeath();
      }
    }
  }

  // -----------------------------------------------------------------------
  // Points
  // -----------------------------------------------------------------------

  /**
   * Award points to the player.
   * @param {number} amount - Points to add (positive)
   */
  addPoints(amount) {
    if (amount <= 0) return;
    this.state.points += amount;
    eventBus.emit('points:updated', this.state.points);

    if (this.hud && typeof this.hud.updatePoints === 'function') {
      this.hud.updatePoints(this.state.points);
    }
  }

  /**
   * Spend points. Returns true if the player had enough.
   * @param {number} amount
   * @returns {boolean}
   */
  spendPoints(amount) {
    if (amount <= 0) return true;
    if (this.state.points < amount) return false;

    this.state.points -= amount;
    eventBus.emit('points:updated', this.state.points);

    if (this.hud && typeof this.hud.updatePoints === 'function') {
      this.hud.updatePoints(this.state.points);
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Combat events
  // -----------------------------------------------------------------------

  /**
   * Called when a zombie is killed. Awards points and increments kill count.
   * @param {object} zombie - The zombie instance that was killed
   */
  onZombieKilled(zombie) {
    const basePoints = 100;
    const roundBonus = this.state.round * 10;
    const totalPoints = basePoints + roundBonus;

    this.addPoints(totalPoints);
    this.state.killCount++;

    eventBus.emit('kill:confirmed', {
      zombie,
      points: totalPoints,
      totalKills: this.state.killCount,
    });
  }

  /**
   * Handle wave completion. Advance round and start next wave after delay.
   * @private
   */
  _onWaveComplete() {
    this.state.round++;

    eventBus.emit('round:changed', this.state.round);

    if (this.hud && typeof this.hud.updateRound === 'function') {
      this.hud.updateRound(this.state.round);
    }

    console.log(`[Game] Round ${this.state.round} starting...`);
  }

  // -----------------------------------------------------------------------
  // Game over / restart
  // -----------------------------------------------------------------------

  /**
   * Handle player death. Stops the game and shows the game over screen.
   */
  onPlayerDeath() {
    if (this.state.gameOver) return; // Prevent double-fire
    this.state.gameOver = true;
    this.state.isRunning = false;

    this.clock.stop();

    // Release pointer lock
    this.input.releasePointerLock();

    const elapsedMs = performance.now() - this.state.startTime;
    const elapsedSec = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(elapsedSec / 60);
    const seconds = elapsedSec % 60;

    const stats = {
      round: this.state.round,
      kills: this.state.killCount,
      points: this.state.points,
      survived: `${minutes}m ${seconds.toString().padStart(2, '0')}s`,
    };

    eventBus.emit('game:over', stats);

    // Show game over screen
    const gameOverScreen = document.getElementById('game-over-screen');
    if (gameOverScreen) {
      gameOverScreen.style.display = 'flex';

      const statsEl = document.getElementById('game-over-stats');
      if (statsEl) {
        statsEl.innerHTML = `
          <p>Round Survived: <strong>${stats.round}</strong></p>
          <p>Zombies Killed: <strong>${stats.kills}</strong></p>
          <p>Points: <strong>${stats.points}</strong></p>
          <p>Time Survived: <strong>${stats.survived}</strong></p>
        `;
      }

      const restartBtn = document.getElementById('restart-button');
      if (restartBtn) {
        restartBtn.addEventListener('click', () => this.restart(), { once: true });
      }
    }

    console.log('[Game] Game Over.', stats);
  }

  /**
   * Reset all systems and restart the game from round 1.
   */
  restart() {
    // Cancel running loop
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    // Reset state
    this.state.round = 1;
    this.state.points = 500;
    this.state.isRunning = false;
    this.state.isPaused = false;
    this.state.gameOver = false;
    this.state.killCount = 0;
    this.state.startTime = 0;

    // Reset each system that supports it
    const systems = [
      this.player,
      this.weaponSystem,
      this.zombieManager,
      this.waveManager,
      this.wallBuySystem,
      this.hud,
      this.audio,
    ];

    for (const system of systems) {
      if (system && typeof system.reset === 'function') {
        try {
          system.reset();
        } catch (err) {
          console.error('[Game] Error resetting system:', err);
        }
      }
    }

    // Hide game over screen
    const gameOverScreen = document.getElementById('game-over-screen');
    if (gameOverScreen) gameOverScreen.style.display = 'none';

    eventBus.emit('game:restarted');

    // Re-start
    this.start();

    console.log('[Game] Restarted.');
  }

  // -----------------------------------------------------------------------
  // Getters for other systems
  // -----------------------------------------------------------------------

  /** @returns {THREE.Scene} */
  getScene() {
    return this.gameRenderer.getScene();
  }

  /** @returns {THREE.PerspectiveCamera} */
  getCamera() {
    return this.gameRenderer.getCamera();
  }

  /** @returns {object} Current game state snapshot */
  getState() {
    return { ...this.state };
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Tear down the game and release all resources.
   */
  dispose() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    const disposableSystems = [
      this.input,
      this.weaponSystem,
      this.zombieManager,
      this.waveManager,
      this.wallBuySystem,
      this.hud,
      this.audio,
      this.gameRenderer,
    ];

    for (const system of disposableSystems) {
      if (system && typeof system.dispose === 'function') {
        try {
          system.dispose();
        } catch (err) {
          console.error('[Game] Error disposing system:', err);
        }
      }
    }

    eventBus.clear();
    console.log('[Game] Disposed.');
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const instance = new Game();
    game = instance;

    // Expose globally for debugging in dev
    if (import.meta.env?.DEV) {
      window.__game = instance;
      window.__eventBus = eventBus;
    }

    await instance.init();
  } catch (err) {
    console.error('[Game] Fatal error during bootstrap:', err);
  }
});
