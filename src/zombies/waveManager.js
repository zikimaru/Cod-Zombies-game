/**
 * WaveManager - Controls the round/wave system for a CoD WaW-style zombies game.
 *
 * Manages round progression, zombie spawn timing, between-round delays,
 * and per-round zombie count/health/speed scaling. Coordinates with ZombieManager
 * to spawn zombies at map-defined spawn points.
 */
export class WaveManager {
  /**
   * @param {object} eventBus - Event emitter for game-wide events
   * @param {import('./zombieManager.js').ZombieManager} zombieManager - ZombieManager instance
   * @param {object} map - Map/level reference with spawnPoints array
   */
  constructor(eventBus, zombieManager, map) {
    /** @type {object} */
    this.eventBus = eventBus;
    /** @type {import('./zombieManager.js').ZombieManager} */
    this.zombieManager = zombieManager;
    /** @type {object} */
    this.map = map;

    /** @type {number} Current round number (0 = not started) */
    this.currentRound = 0;
    /** @type {number} Zombies still alive this round (spawned but not yet killed) */
    this.zombiesRemaining = 0;
    /** @type {number} How many zombies have been spawned so far this round */
    this.zombiesSpawned = 0;
    /** @type {number} Total zombies to spawn this round */
    this.zombiesToSpawn = 0;
    /** @type {number} Time accumulator for spawn interval */
    this.spawnTimer = 0;
    /** @type {number} Seconds between consecutive zombie spawns */
    this.spawnInterval = 2.0;
    /** @type {number} Timer counting down between rounds */
    this.betweenRoundsTimer = 0;
    /** @type {boolean} Whether we are in the pause between rounds */
    this.isBetweenRounds = true;
    /** @type {number} Seconds to wait between rounds */
    this.roundStartDelay = 5;
    /** @type {boolean} Whether the wave system is active (game is running) */
    this.isActive = false;

    // Listen for zombie kill events to track remaining count
    this._bindEvents();
  }

  // ---------------------------------------------------------------------------
  // EVENT BINDING
  // ---------------------------------------------------------------------------

  /**
   * Bind to eventBus events for tracking zombie kills.
   * @private
   */
  _bindEvents() {
    if (!this.eventBus) return;

    const handler = () => {
      if (this.zombiesRemaining > 0) {
        this.zombiesRemaining--;
      }
    };

    if (typeof this.eventBus.on === 'function') {
      this.eventBus.on('zombieKilled', handler);
    } else if (typeof this.eventBus.addEventListener === 'function') {
      this.eventBus.addEventListener('zombieKilled', (e) => handler(e.detail || e));
    }

    this._killHandler = handler;
  }

  // ---------------------------------------------------------------------------
  // ROUND START
  // ---------------------------------------------------------------------------

  /**
   * Start the next round: increment round counter, calculate zombie count,
   * set spawn interval, and emit the roundStart event.
   */
  startNextRound() {
    this.currentRound++;

    this.zombiesToSpawn = this.getZombiesForRound(this.currentRound);
    this.zombiesSpawned = 0;
    this.zombiesRemaining = this.zombiesToSpawn;
    this.spawnTimer = 0;
    this.isBetweenRounds = false;

    // Spawn interval gets faster in later rounds (min 0.5s)
    this.spawnInterval = Math.max(2.0 - this.currentRound * 0.15, 0.5);

    this._emit('roundStart', {
      round: this.currentRound,
      zombieCount: this.zombiesToSpawn,
      zombieHealth: this.getZombieHealth(this.currentRound),
      zombieSpeed: this.getZombieSpeed(this.currentRound),
    });
  }

  // ---------------------------------------------------------------------------
  // MAIN UPDATE
  // ---------------------------------------------------------------------------

  /**
   * Update the wave system. Called once per frame from the game loop.
   *
   * Handles:
   * - Between-rounds countdown timer
   * - Spawning zombies at intervals during active rounds
   * - Detecting round completion (all zombies killed)
   *
   * @param {number} deltaTime - Seconds since last frame
   */
  update(deltaTime) {
    if (!this.isActive) return;

    // ---- Between rounds: countdown to next round ----
    if (this.isBetweenRounds) {
      this.betweenRoundsTimer += deltaTime;

      if (this.betweenRoundsTimer >= this.roundStartDelay) {
        this.betweenRoundsTimer = 0;
        this.startNextRound();
      }
      return;
    }

    // ---- Active round: spawn zombies at intervals ----
    if (this.zombiesSpawned < this.zombiesToSpawn) {
      this.spawnTimer += deltaTime;

      if (this.spawnTimer >= this.spawnInterval) {
        this.spawnTimer -= this.spawnInterval;
        this._spawnNextZombie();
      }
    }

    // ---- Check round completion ----
    // All zombies spawned AND all killed (remaining === 0) AND no active zombies in scene
    if (
      this.zombiesSpawned >= this.zombiesToSpawn &&
      this.zombiesRemaining <= 0 &&
      this.zombieManager.getActiveCount() === 0
    ) {
      this._endRound();
    }
  }

  // ---------------------------------------------------------------------------
  // SPAWNING
  // ---------------------------------------------------------------------------

  /**
   * Spawn a single zombie at a random active spawn point from the map.
   * @private
   */
  _spawnNextZombie() {
    // Get spawn points from the map
    const spawnPoints = this._getSpawnPoints();
    if (spawnPoints.length === 0) {
      // Fallback: spawn at a default position if no spawn points defined
      const fallback = {
        position: {
          x: (Math.random() - 0.5) * 20,
          y: 0,
          z: -15 + (Math.random() - 0.5) * 10,
        },
        barricade: null,
      };
      spawnPoints.push(fallback);
    }

    // Pick a random spawn point
    const spawnPoint = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

    // Spawn via the zombie manager
    const zombie = this.zombieManager.spawnZombie(spawnPoint, this.currentRound);

    if (zombie) {
      this.zombiesSpawned++;
    } else {
      // Pool exhausted - we'll try again next interval
      // Don't increment zombiesSpawned so it retries
    }
  }

  /**
   * Get available spawn points from the map. Supports various map formats.
   * @returns {Array<{position:{x:number,y:number,z:number}, barricade:object|null}>}
   * @private
   */
  _getSpawnPoints() {
    if (!this.map) return [];

    // Try common map property names
    if (this.map.spawnPoints && Array.isArray(this.map.spawnPoints)) {
      return this.map.spawnPoints;
    }

    if (this.map.zombieSpawns && Array.isArray(this.map.zombieSpawns)) {
      return this.map.zombieSpawns;
    }

    if (this.map.windows && Array.isArray(this.map.windows)) {
      // Convert window objects to spawn point format
      return this.map.windows.map((w) => ({
        position: w.outsidePosition || w.position || { x: 0, y: 0, z: 0 },
        barricade: w.barricade || w,
      }));
    }

    // If map has a getSpawnPoints function
    if (typeof this.map.getSpawnPoints === 'function') {
      return this.map.getSpawnPoints();
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // ROUND END
  // ---------------------------------------------------------------------------

  /**
   * Handle end of a round: emit event and start between-rounds timer.
   * @private
   */
  _endRound() {
    this.isBetweenRounds = true;
    this.betweenRoundsTimer = 0;

    this._emit('roundEnd', {
      round: this.currentRound,
      nextRound: this.currentRound + 1,
      delay: this.roundStartDelay,
    });
  }

  // ---------------------------------------------------------------------------
  // ROUND SCALING FORMULAS
  // ---------------------------------------------------------------------------

  /**
   * Calculate how many zombies to spawn for a given round.
   * Formula: 6 + round * 2, capped at 24 (the pool size).
   *
   * @param {number} round - Round number
   * @returns {number} Number of zombies
   */
  getZombiesForRound(round) {
    return Math.min(6 + round * 2, 24);
  }

  /**
   * Calculate zombie health for a given round.
   * Formula: 100 + round * 50, capped at 1000.
   *
   * @param {number} round - Round number
   * @returns {number} Health points
   */
  getZombieHealth(round) {
    return Math.min(100 + round * 50, 1000);
  }

  /**
   * Calculate zombie speed for a given round.
   * Formula: 1.5 + round * 0.15, capped at 4.0.
   *
   * @param {number} round - Round number
   * @returns {number} Speed in units/second
   */
  getZombieSpeed(round) {
    return Math.min(1.5 + round * 0.15, 4.0);
  }

  // ---------------------------------------------------------------------------
  // CONTROL
  // ---------------------------------------------------------------------------

  /**
   * Start the wave system. Begins the between-rounds timer leading to round 1.
   */
  start() {
    this.isActive = true;
    this.isBetweenRounds = true;
    this.betweenRoundsTimer = 0;
  }

  /**
   * Pause the wave system. Zombies already spawned continue to act,
   * but no new zombies are spawned and round timers freeze.
   */
  pause() {
    this.isActive = false;
  }

  /**
   * Resume the wave system after a pause.
   */
  resume() {
    this.isActive = true;
  }

  /**
   * Fully reset the wave system to initial state (round 0).
   * Also resets the zombie manager.
   */
  reset() {
    this.currentRound = 0;
    this.zombiesRemaining = 0;
    this.zombiesSpawned = 0;
    this.zombiesToSpawn = 0;
    this.spawnTimer = 0;
    this.spawnInterval = 2.0;
    this.betweenRoundsTimer = 0;
    this.isBetweenRounds = true;
    this.isActive = false;

    this.zombieManager.reset();
  }

  // ---------------------------------------------------------------------------
  // STATUS
  // ---------------------------------------------------------------------------

  /**
   * Get a snapshot of the current wave/round status for UI display.
   * @returns {object}
   */
  getStatus() {
    return {
      round: this.currentRound,
      zombiesRemaining: this.zombiesRemaining,
      zombiesSpawned: this.zombiesSpawned,
      zombiesToSpawn: this.zombiesToSpawn,
      isBetweenRounds: this.isBetweenRounds,
      isActive: this.isActive,
      nextRoundIn: this.isBetweenRounds
        ? Math.max(0, this.roundStartDelay - this.betweenRoundsTimer)
        : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // EVENT HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Emit an event through the event bus.
   * @param {string} eventName
   * @param {object} data
   * @private
   */
  _emit(eventName, data) {
    if (!this.eventBus) return;

    if (typeof this.eventBus.emit === 'function') {
      this.eventBus.emit(eventName, data);
    } else if (typeof this.eventBus.dispatchEvent === 'function') {
      this.eventBus.dispatchEvent(new CustomEvent(eventName, { detail: data }));
    } else if (typeof this.eventBus.fire === 'function') {
      this.eventBus.fire(eventName, data);
    }
  }
}
