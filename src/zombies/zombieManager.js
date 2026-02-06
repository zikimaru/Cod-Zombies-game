import * as THREE from 'three';
import { Zombie } from './zombie.js';

/**
 * ZombieManager - Manages the object pool of zombies, handles spawning,
 * updating, removal, and bullet-hit detection for a CoD WaW-style zombies game.
 *
 * Maintains a pre-allocated pool of ~24 Zombie instances to avoid runtime
 * allocation and GC pressure. Zombies are activated from the pool on spawn
 * and returned on death/reset.
 */

/** Maximum number of zombies that can be active simultaneously */
const MAX_POOL_SIZE = 24;

export class ZombieManager {
  /**
   * @param {THREE.Scene} scene - The Three.js scene
   * @param {object} eventBus - Event emitter for game-wide events
   * @param {object} map - Map/level reference for spawn points, barricades, navPoints
   */
  constructor(scene, eventBus, map) {
    /** @type {THREE.Scene} */
    this.scene = scene;
    /** @type {object} */
    this.eventBus = eventBus;
    /** @type {object} */
    this.map = map;

    /** @type {Zombie[]} Full pool of pre-allocated zombie objects */
    this.pool = [];
    /** @type {Zombie[]} Currently active (alive or dying) zombies */
    this.activeZombies = [];

    /** @type {THREE.Raycaster} Reusable raycaster for hit detection */
    this._raycaster = new THREE.Raycaster();
    /** @type {THREE.Vector3} Reusable temp vector */
    this._tempVec = new THREE.Vector3();

    // Pre-allocate the zombie pool
    this._initPool();
  }

  // ---------------------------------------------------------------------------
  // POOL MANAGEMENT
  // ---------------------------------------------------------------------------

  /**
   * Pre-allocate all zombie instances for the object pool.
   * Each zombie builds its mesh once; subsequent spawns reuse it.
   * @private
   */
  _initPool() {
    for (let i = 0; i < MAX_POOL_SIZE; i++) {
      const zombie = new Zombie(this.scene, i);
      this.pool.push(zombie);
    }
  }

  /**
   * Get an inactive zombie from the pool. Returns null if the pool is exhausted.
   * @returns {Zombie|null}
   * @private
   */
  _getFromPool() {
    for (const zombie of this.pool) {
      if (zombie.state === 'inactive') {
        return zombie;
      }
    }
    return null;
  }

  /**
   * Return a zombie to the inactive pool. Resets it and removes from active list.
   * @param {Zombie} zombie
   * @private
   */
  _returnToPool(zombie) {
    zombie.reset();
    const idx = this.activeZombies.indexOf(zombie);
    if (idx !== -1) {
      this.activeZombies.splice(idx, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // SPAWNING
  // ---------------------------------------------------------------------------

  /**
   * Spawn a single zombie at a given spawn point. The zombie appears outside
   * the window, rises from the ground, tears down the barricade, then enters.
   *
   * @param {object} spawnPoint - Spawn point descriptor:
   *   {
   *     position: {x, y, z},   // Where the zombie appears (outside the window)
   *     barricade: object|null, // Barricade reference with removeBoard(), entryPoint, etc.
   *   }
   * @param {number} round - Current game round (affects health/speed)
   * @returns {Zombie|null} The spawned zombie, or null if pool exhausted
   */
  spawnZombie(spawnPoint, round = 1) {
    const zombie = this._getFromPool();
    if (!zombie) {
      return null; // Pool exhausted
    }

    const position = spawnPoint.position || spawnPoint;
    const barricade = spawnPoint.barricade || null;

    zombie.spawn(position, barricade, round);
    this.activeZombies.push(zombie);

    // Emit spawn event
    this._emit('zombieSpawned', {
      zombieId: zombie.id,
      position: { x: position.x, y: position.y, z: position.z },
      round,
    });

    return zombie;
  }

  // ---------------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------------

  /**
   * Update all active zombies. Called once per frame from the game loop.
   *
   * @param {number} deltaTime - Seconds since last frame
   * @param {THREE.Vector3|{x:number,y:number,z:number}} playerPosition - Current player world position
   * @returns {Array<{damage:number, zombieId:number}>} Array of attack results for this frame
   */
  update(deltaTime, playerPosition) {
    const attackResults = [];
    const navPoints = this.map && this.map.navPoints ? this.map.navPoints : [];

    // Iterate in reverse so we can safely remove during iteration
    for (let i = this.activeZombies.length - 1; i >= 0; i--) {
      const zombie = this.activeZombies[i];

      // Update the zombie state machine
      const result = zombie.update(deltaTime, playerPosition, navPoints, this.activeZombies);

      // If the zombie's attack state returned a hit result
      if (result && result.damage) {
        attackResults.push(result);
      }

      // If zombie has finished its death sequence and reset itself
      if (zombie.state === 'inactive') {
        this.activeZombies.splice(i, 1);
      }
    }

    return attackResults;
  }

  // ---------------------------------------------------------------------------
  // REMOVAL / KILL
  // ---------------------------------------------------------------------------

  /**
   * Remove a specific zombie: trigger death, emit kill event, and eventually
   * return it to the pool (happens automatically after death animation).
   *
   * @param {Zombie} zombie - The zombie to remove
   * @param {boolean} [isHeadshot=false] - Whether the kill was a headshot
   */
  removeZombie(zombie, isHeadshot = false) {
    if (!zombie || (!zombie.isAlive && zombie.state !== 'attacking')) return;

    zombie.die(isHeadshot);

    this._emit('zombieKilled', {
      zombieId: zombie.id,
      position: zombie.getPosition(),
      isHeadshot,
      round: zombie._round,
    });
  }

  // ---------------------------------------------------------------------------
  // QUERIES
  // ---------------------------------------------------------------------------

  /**
   * Get all currently alive (active and not dying/dead) zombies.
   * @returns {Zombie[]}
   */
  getActiveZombies() {
    return this.activeZombies.filter(
      (z) => z.isAlive && z.state !== 'dying' && z.state !== 'dead'
    );
  }

  /**
   * Get count of all zombies that are still active (including dying).
   * @returns {number}
   */
  getActiveCount() {
    return this.activeZombies.length;
  }

  /**
   * Get count of living (not dying/dead) zombies.
   * @returns {number}
   */
  getLivingCount() {
    return this.activeZombies.filter(
      (z) => z.isAlive
    ).length;
  }

  // ---------------------------------------------------------------------------
  // BULLET HIT DETECTION
  // ---------------------------------------------------------------------------

  /**
   * Test a ray (from the player's gun) against all active zombie hitboxes.
   * Checks head hitboxes first for headshot priority, then body hitboxes.
   *
   * @param {THREE.Raycaster} raycaster - Raycaster with origin and direction set
   * @returns {{zombie: Zombie, hitPoint: THREE.Vector3, isHeadshot: boolean}|null}
   *   The closest hit result, or null if no zombie was hit.
   */
  checkBulletHit(raycaster) {
    if (this.activeZombies.length === 0) return null;

    let closestHit = null;
    let closestDist = Infinity;

    for (const zombie of this.activeZombies) {
      if (!zombie.isAlive) continue;
      if (!zombie.mesh || !zombie.mesh.visible) continue;

      // Update world matrices so hitbox positions are current
      zombie.mesh.updateMatrixWorld(true);

      // Test head hitbox first
      const headIntersects = raycaster.intersectObject(zombie.headHitbox, false);
      if (headIntersects.length > 0) {
        const dist = headIntersects[0].distance;
        if (dist < closestDist) {
          closestDist = dist;
          closestHit = {
            zombie,
            hitPoint: headIntersects[0].point.clone(),
            isHeadshot: true,
          };
        }
      }

      // Test body hitbox
      const bodyIntersects = raycaster.intersectObject(zombie.hitbox, false);
      if (bodyIntersects.length > 0) {
        const dist = bodyIntersects[0].distance;
        if (dist < closestDist) {
          closestDist = dist;
          closestHit = {
            zombie,
            hitPoint: bodyIntersects[0].point.clone(),
            isHeadshot: false,
          };
        }
      }
    }

    return closestHit;
  }

  /**
   * Test a ray against zombies and apply damage if hit. Convenience method
   * that combines checkBulletHit and takeDamage.
   *
   * @param {THREE.Raycaster} raycaster - Raycaster with origin and direction set
   * @param {number} damage - Base damage of the weapon
   * @returns {{zombie: Zombie, hitPoint: THREE.Vector3, isHeadshot: boolean, killed: boolean}|null}
   */
  shootRay(raycaster, damage) {
    const hit = this.checkBulletHit(raycaster);
    if (!hit) return null;

    const killed = hit.zombie.takeDamage(damage, hit.hitPoint, hit.isHeadshot);

    if (killed) {
      this._emit('zombieKilled', {
        zombieId: hit.zombie.id,
        position: hit.hitPoint,
        isHeadshot: hit.isHeadshot,
        round: hit.zombie._round,
      });
    } else {
      this._emit('zombieHit', {
        zombieId: hit.zombie.id,
        position: hit.hitPoint,
        isHeadshot: hit.isHeadshot,
        damage: hit.isHeadshot ? damage * 2 : damage,
        remainingHealth: hit.zombie.health,
      });
    }

    return {
      zombie: hit.zombie,
      hitPoint: hit.hitPoint,
      isHeadshot: hit.isHeadshot,
      killed,
    };
  }

  // ---------------------------------------------------------------------------
  // RESET
  // ---------------------------------------------------------------------------

  /**
   * Kill and reset ALL zombies, returning them all to the pool.
   * Used when restarting the game or moving to a new level.
   */
  reset() {
    for (let i = this.activeZombies.length - 1; i >= 0; i--) {
      const zombie = this.activeZombies[i];
      zombie.reset();
    }
    this.activeZombies.length = 0;
  }

  // ---------------------------------------------------------------------------
  // DISPOSAL
  // ---------------------------------------------------------------------------

  /**
   * Fully dispose of all zombies and their resources. Call on game shutdown.
   */
  dispose() {
    this.reset();

    // Dispose all meshes in the pool
    for (const zombie of this.pool) {
      if (zombie.mesh) {
        zombie.mesh.traverse((child) => {
          if (child.geometry && !child.geometry._isShared) {
            child.geometry.dispose();
          }
          if (child.material) {
            if (child.material._isCloned) {
              child.material.dispose();
            }
          }
        });
      }
    }

    this.pool.length = 0;
  }

  // ---------------------------------------------------------------------------
  // EVENT HELPERS
  // ---------------------------------------------------------------------------

  /**
   * Emit an event through the event bus if available.
   * Supports both EventEmitter-style (.emit) and DOM-style (.dispatchEvent)
   * as well as a simple callback map (.on / .listeners).
   *
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
