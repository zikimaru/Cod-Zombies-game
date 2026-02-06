import * as THREE from 'three';

/**
 * Player - Full first-person shooter controller for CoD World at War Zombies.
 *
 * Handles FPS movement with WASD + sprint, mouse look with pointer lock,
 * head bobbing, CoD-style health regeneration, damage feedback (screen flash,
 * camera shake, directional indicators), point economy, collision detection
 * against map geometry, interaction raycasting, and death sequence.
 */
export class Player {
  /**
   * @param {THREE.PerspectiveCamera} camera  - The game camera
   * @param {THREE.Scene}             scene   - The main scene
   * @param {object}                  eventBus - Pub/sub event system
   * @param {object}                  inputManager - Keyboard/mouse input manager
   * @param {object|null}             map     - BunkerMap instance (may have .colliders, .spawnPoint)
   */
  constructor(camera, scene, eventBus, inputManager, map) {
    this.camera = camera;
    this.scene = scene;
    this.eventBus = eventBus;
    this.input = inputManager;
    this.map = map;

    // -----------------------------------------------------------------------
    // Position & Movement
    // -----------------------------------------------------------------------
    this.position = new THREE.Vector3(0, 1.7, 0); // Eye height 1.7 units
    this.velocity = new THREE.Vector3();
    this.moveSpeed = 5.0;          // units per second
    this.sprintMultiplier = 1.5;
    this.isSprinting = false;
    this.isMoving = false;

    // -----------------------------------------------------------------------
    // Look
    // -----------------------------------------------------------------------
    this.pitch = 0;                // X rotation (up/down) in radians
    this.yaw = 0;                  // Y rotation (left/right) in radians
    this.mouseSensitivity = 0.002;
    this._targetPitch = 0;         // For smooth interpolation
    this._targetYaw = 0;
    this._lookSmoothing = 0.85;    // 0 = no smoothing, 1 = max smoothing

    // -----------------------------------------------------------------------
    // Health
    // -----------------------------------------------------------------------
    this.health = 100;
    this.maxHealth = 100;
    this.isRegenerating = false;
    this.regenDelay = 5.0;         // seconds before regen starts
    this.regenTimer = 0;
    this.regenRate = 10;           // HP per second
    this.lastDamageTime = 0;
    this.isDead = false;

    // -----------------------------------------------------------------------
    // Points
    // -----------------------------------------------------------------------
    this.points = 500;             // Starting points (classic Zombies)

    // -----------------------------------------------------------------------
    // Head bob
    // -----------------------------------------------------------------------
    this.headBobTimer = 0;
    this.headBobAmount = 0.04;     // vertical amplitude
    this.headBobSpeed = 10;        // oscillation speed
    this._headBobOffsetY = 0;      // current vertical offset
    this._headBobOffsetX = 0;      // current horizontal sway

    // -----------------------------------------------------------------------
    // Damage feedback
    // -----------------------------------------------------------------------
    this.damageOverlayAlpha = 0;          // Red flash intensity (0..1)
    this.hitDirectionIndicator = null;    // Angle toward last damage source
    this.hitDirectionTimer = 0;           // Fade timer for direction indicator
    this._lowHealthBloodAlpha = 0;        // Persistent blood edges when low HP

    // -----------------------------------------------------------------------
    // Camera shake / recoil
    // -----------------------------------------------------------------------
    this._shakeIntensity = 0;             // Current shake strength
    this._shakeDecay = 8.0;               // Exponential decay rate
    this._shakeOffsetX = 0;
    this._shakeOffsetY = 0;
    this.recoilOffset = 0;                // Upward pitch from weapon recoil
    this._recoilRecoverySpeed = 6.0;      // How fast recoil returns to 0

    // -----------------------------------------------------------------------
    // Player collider
    // -----------------------------------------------------------------------
    this.collisionRadius = 0.4;
    this.height = 1.7;

    // -----------------------------------------------------------------------
    // Interaction
    // -----------------------------------------------------------------------
    this.interactionRange = 2.5;
    this._raycaster = new THREE.Raycaster();
    this._raycaster.far = this.interactionRange;

    // -----------------------------------------------------------------------
    // Death animation state
    // -----------------------------------------------------------------------
    this._deathAnimProgress = 0;
    this._deathCameraStartY = 0;
    this._deathCameraTargetY = 0.3;       // Camera drops near ground
    this._deathRollTarget = Math.PI / 6;  // ~30 degree sideways tilt

    // -----------------------------------------------------------------------
    // Reusable math objects (avoid GC pressure)
    // -----------------------------------------------------------------------
    this._moveDir = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tempVec = new THREE.Vector3();
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  /**
   * Set up the player at the starting position.
   * If the map provides a spawn point, use it; otherwise default to origin.
   */
  init() {
    // Determine spawn position
    let spawnX = 0;
    let spawnZ = 0;

    if (this.map) {
      if (this.map.spawnPoint) {
        spawnX = this.map.spawnPoint.x || 0;
        spawnZ = this.map.spawnPoint.z || 0;
      } else if (this.map.startingRoomCenter) {
        spawnX = this.map.startingRoomCenter.x || 0;
        spawnZ = this.map.startingRoomCenter.z || 0;
      }
    }

    this.position.set(spawnX, this.height, spawnZ);
    this.velocity.set(0, 0, 0);

    // Sync camera immediately
    this.camera.position.copy(this.position);
    this._euler.set(0, 0, 0, 'YXZ');
    this.camera.rotation.copy(this._euler);

    this.pitch = 0;
    this.yaw = 0;
    this._targetPitch = 0;
    this._targetYaw = 0;
  }

  // =========================================================================
  // Main update
  // =========================================================================

  /**
   * Per-frame update. Called from the game loop.
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    if (this.isDead) {
      this._updateDeathAnimation(deltaTime);
      return;
    }

    this.handleMovement(deltaTime);
    this.handleLook(deltaTime);
    this.handleHeadBob(deltaTime);
    this.handleHealthRegen(deltaTime);
    this.updateDamageOverlay(deltaTime);
    this.updateCameraShake(deltaTime);
    this._updateRecoil(deltaTime);

    // --- Sync camera ---
    // Base position + head bob offsets
    this.camera.position.set(
      this.position.x + this._headBobOffsetX,
      this.position.y + this._headBobOffsetY,
      this.position.z
    );

    // Compose final rotation: pitch + yaw + shake + recoil + any roll
    const finalPitch = this.pitch - this.recoilOffset + this._shakeOffsetY;
    const finalYaw = this.yaw + this._shakeOffsetX;

    this._euler.set(finalPitch, finalYaw, 0, 'YXZ');
    this.camera.rotation.copy(this._euler);
  }

  // =========================================================================
  // Movement
  // =========================================================================

  /**
   * Read WASD/arrow keys, compute direction relative to camera yaw,
   * apply sprint, normalize, and move with sliding collision.
   * @param {number} deltaTime
   */
  handleMovement(deltaTime) {
    const input = this.input;
    if (!input) return;

    // Gather raw input axes
    let inputX = 0; // strafe
    let inputZ = 0; // forward/back

    if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp'))    inputZ -= 1;
    if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown'))  inputZ += 1;
    if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft'))  inputX -= 1;
    if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) inputX += 1;

    this.isMoving = (inputX !== 0 || inputZ !== 0);

    // Sprint: only when moving forward (negative Z in our convention)
    this.isSprinting = false;
    if (this.isMoving && inputZ < 0 &&
        (input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight'))) {
      this.isSprinting = true;
    }

    if (!this.isMoving) {
      this.velocity.set(0, 0, 0);
      return;
    }

    // Forward direction on the XZ plane from yaw
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);

    this._forward.set(-sinYaw, 0, -cosYaw);
    this._right.set(cosYaw, 0, -sinYaw);

    // Combine into world-space move direction
    this._moveDir.set(0, 0, 0);
    this._moveDir.addScaledVector(this._forward, -inputZ); // W = forward
    this._moveDir.addScaledVector(this._right, inputX);    // D = right

    // Normalize so diagonal movement is not faster
    if (this._moveDir.lengthSq() > 0) {
      this._moveDir.normalize();
    }

    // Speed calculation
    let speed = this.moveSpeed;
    if (this.isSprinting) {
      speed *= this.sprintMultiplier;
    }

    // Desired displacement this frame
    const dx = this._moveDir.x * speed * deltaTime;
    const dz = this._moveDir.z * speed * deltaTime;

    // --- Sliding collision ---
    this._applyMovementWithCollision(dx, dz);
  }

  /**
   * Attempt to move by (dx, dz). If blocked, try axis-separated sliding.
   * @param {number} dx
   * @param {number} dz
   * @private
   */
  _applyMovementWithCollision(dx, dz) {
    // If there are no colliders, just move freely
    const colliders = this._getColliders();
    if (!colliders || colliders.length === 0) {
      this.position.x += dx;
      this.position.z += dz;
      return;
    }

    // Try full movement first
    const newX = this.position.x + dx;
    const newZ = this.position.z + dz;

    if (!this._isColliding(newX, newZ, colliders)) {
      this.position.x = newX;
      this.position.z = newZ;
      return;
    }

    // Full move blocked -> try X only (slide along Z wall)
    const slideX = this.position.x + dx;
    const slideZForXMove = this.position.z;
    if (!this._isColliding(slideX, slideZForXMove, colliders)) {
      this.position.x = slideX;
      // Z stays
    }

    // Try Z only (slide along X wall)
    const slideXForZMove = this.position.x; // use updated X from above
    const slideZ = this.position.z + dz;
    if (!this._isColliding(slideXForZMove, slideZ, colliders)) {
      this.position.z = slideZ;
    }
  }

  /**
   * Check if the player cylinder at (x, z) overlaps any collider.
   * Supports Box3 (AABB) colliders and simple {min, max} objects.
   * @param {number} x
   * @param {number} z
   * @param {Array} colliders
   * @returns {boolean}
   * @private
   */
  _isColliding(x, z, colliders) {
    const r = this.collisionRadius;

    for (let i = 0; i < colliders.length; i++) {
      const col = colliders[i];

      if (!col) continue;

      // Handle THREE.Box3 or plain {min, max} objects
      let minX, maxX, minZ, maxZ, minY, maxY;

      if (col.isBox3 || (col.min && col.max)) {
        minX = col.min.x;
        maxX = col.max.x;
        minY = col.min.y;
        maxY = col.max.y;
        minZ = col.min.z;
        maxZ = col.max.z;
      } else if (typeof col.x !== 'undefined' && typeof col.width !== 'undefined') {
        // {x, y, z, width, height, depth} style
        minX = col.x - col.width / 2;
        maxX = col.x + col.width / 2;
        minY = col.y - (col.height || this.height * 2) / 2;
        maxY = col.y + (col.height || this.height * 2) / 2;
        minZ = col.z - col.depth / 2;
        maxZ = col.z + col.depth / 2;
      } else {
        continue; // Unknown collider format
      }

      // Vertical overlap check: player occupies Y in [position.y - height, position.y]
      const playerMinY = this.position.y - this.height;
      const playerMaxY = this.position.y;
      if (playerMaxY < minY || playerMinY > maxY) {
        continue; // No vertical overlap
      }

      // Circle vs AABB on XZ plane
      // Find the closest point on the AABB to the player center
      const closestX = Math.max(minX, Math.min(x, maxX));
      const closestZ = Math.max(minZ, Math.min(z, maxZ));

      const distX = x - closestX;
      const distZ = z - closestZ;
      const distSq = distX * distX + distZ * distZ;

      if (distSq < r * r) {
        return true;
      }
    }

    return false;
  }

  /**
   * Retrieve collider array from the map. Supports various map structures.
   * @returns {Array|null}
   * @private
   */
  _getColliders() {
    if (!this.map) return null;

    if (Array.isArray(this.map.colliders)) {
      return this.map.colliders;
    }
    if (typeof this.map.getColliders === 'function') {
      return this.map.getColliders();
    }
    if (Array.isArray(this.map.walls)) {
      return this.map.walls;
    }

    return null;
  }

  // =========================================================================
  // Mouse Look
  // =========================================================================

  /**
   * Apply mouse delta to yaw and pitch with slight smoothing.
   * Pitch is clamped to prevent flipping.
   * @param {number} deltaTime
   */
  handleLook(deltaTime) {
    const input = this.input;
    if (!input || !input.isPointerLocked) return;

    const delta = input.getMouseDelta();

    // Apply sensitivity
    const rawYaw = delta.x * this.mouseSensitivity;
    const rawPitch = delta.y * this.mouseSensitivity;

    // Update target values
    this._targetYaw -= rawYaw;
    this._targetPitch -= rawPitch;

    // Clamp pitch to prevent camera flipping (+-89 degrees = ~1.553 radians)
    const maxPitch = Math.PI * (89 / 180);
    this._targetPitch = Math.max(-maxPitch, Math.min(maxPitch, this._targetPitch));

    // Smooth interpolation toward target
    const smoothFactor = 1.0 - Math.pow(1.0 - this._lookSmoothing, deltaTime * 60);
    this.yaw = this._lerpAngle(this.yaw, this._targetYaw, 1.0 - smoothFactor);
    this.pitch = this._lerpScalar(this.pitch, this._targetPitch, 1.0 - smoothFactor);
  }

  /**
   * Linearly interpolate between two values.
   * @param {number} a
   * @param {number} b
   * @param {number} t
   * @returns {number}
   * @private
   */
  _lerpScalar(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Linearly interpolate between two angles (handles wrapping not needed here
   * since yaw is unlimited, but included for correctness).
   * @param {number} a
   * @param {number} b
   * @param {number} t
   * @returns {number}
   * @private
   */
  _lerpAngle(a, b, t) {
    return a + (b - a) * t;
  }

  // =========================================================================
  // Head Bob
  // =========================================================================

  /**
   * Sinusoidal head bob when moving. Intensified during sprint.
   * Smoothly returns to zero when stationary.
   * @param {number} deltaTime
   */
  handleHeadBob(deltaTime) {
    if (this.isMoving) {
      let speed = this.headBobSpeed;
      let amount = this.headBobAmount;

      if (this.isSprinting) {
        speed *= 1.4;
        amount *= 1.8;
      }

      this.headBobTimer += deltaTime * speed;

      // Vertical bob (sine wave)
      this._headBobOffsetY = Math.sin(this.headBobTimer) * amount;

      // Horizontal sway (cosine at half freq for figure-8 feel)
      this._headBobOffsetX = Math.cos(this.headBobTimer * 0.5) * amount * 0.5;
    } else {
      // Smoothly return to neutral
      this._headBobOffsetY *= Math.pow(0.001, deltaTime);
      this._headBobOffsetX *= Math.pow(0.001, deltaTime);

      // Snap to zero when close enough to avoid perpetual micro-oscillation
      if (Math.abs(this._headBobOffsetY) < 0.0001) this._headBobOffsetY = 0;
      if (Math.abs(this._headBobOffsetX) < 0.0001) this._headBobOffsetX = 0;

      // Slowly reset timer so next walk starts smoothly
      this.headBobTimer *= 0.9;
    }
  }

  // =========================================================================
  // Health / Damage
  // =========================================================================

  /**
   * Apply damage to the player. Triggers screen flash, camera shake,
   * directional indicator, and potentially death.
   * @param {number} amount - Damage amount
   * @param {THREE.Vector3|null} sourcePosition - World position of damage source
   */
  takeDamage(amount, sourcePosition) {
    if (this.isDead || amount <= 0) return;

    this.health -= amount;
    if (this.health < 0) this.health = 0;

    // Red screen flash - more damage = more intense
    const intensityRatio = Math.min(amount / this.maxHealth, 1.0);
    this.damageOverlayAlpha = Math.min(0.6 + intensityRatio * 0.3, 0.9);

    // Directional damage indicator
    if (sourcePosition) {
      this._computeHitDirection(sourcePosition);
      this.hitDirectionTimer = 1.5; // seconds to show indicator
    }

    // Reset regeneration timer
    this.regenTimer = 0;
    this.isRegenerating = false;
    this.lastDamageTime = performance.now() / 1000;

    // Camera shake proportional to damage
    const shakeAmount = Math.min(amount / 50, 1.0) * 0.05;
    this._triggerCameraShake(shakeAmount);

    // Check for death
    if (this.health <= 0) {
      this.die();
    }

    // Emit event
    if (this.eventBus) {
      this.eventBus.emit('playerDamaged', {
        health: this.health,
        maxHealth: this.maxHealth,
        amount,
        sourcePosition: sourcePosition ? sourcePosition.clone() : null,
      });
    }
  }

  /**
   * Compute which direction damage came from relative to the player's facing.
   * Stores the angle (in radians) in hitDirectionIndicator.
   * @param {THREE.Vector3} sourcePos
   * @private
   */
  _computeHitDirection(sourcePos) {
    // Direction from player to source in XZ plane
    const dx = sourcePos.x - this.position.x;
    const dz = sourcePos.z - this.position.z;

    // Angle of the damage source in world space
    const worldAngle = Math.atan2(dx, dz);

    // Relative to player's facing (yaw)
    this.hitDirectionIndicator = worldAngle - this.yaw;
  }

  /**
   * CoD-style health regeneration.
   * After not taking damage for regenDelay seconds, health slowly restores.
   * @param {number} deltaTime
   */
  handleHealthRegen(deltaTime) {
    if (this.isDead) return;
    if (this.health >= this.maxHealth) {
      this.isRegenerating = false;
      return;
    }

    this.regenTimer += deltaTime;

    if (!this.isRegenerating) {
      if (this.regenTimer >= this.regenDelay) {
        this.isRegenerating = true;
      }
      return;
    }

    // Regenerate
    this.health += this.regenRate * deltaTime;
    if (this.health >= this.maxHealth) {
      this.health = this.maxHealth;
      this.isRegenerating = false;
    }

    // Emit update so HUD can reflect changes
    if (this.eventBus) {
      this.eventBus.emit('playerHealthChanged', {
        health: this.health,
        maxHealth: this.maxHealth,
      });
    }
  }

  // =========================================================================
  // Damage Overlay
  // =========================================================================

  /**
   * Manage the red screen flash and persistent low-health blood effect.
   * damageOverlayAlpha fades toward 0 over time.
   * Low health produces a persistent blood-edge overlay.
   * @param {number} deltaTime
   */
  updateDamageOverlay(deltaTime) {
    // Fade the hit-flash overlay
    if (this.damageOverlayAlpha > 0) {
      this.damageOverlayAlpha -= deltaTime * 1.2; // fade speed
      if (this.damageOverlayAlpha < 0) this.damageOverlayAlpha = 0;
    }

    // Persistent blood on screen edges when health is low
    const healthRatio = this.health / this.maxHealth;
    const lowHealthThreshold = 0.35;
    if (healthRatio < lowHealthThreshold) {
      // Ramp up blood edges as health drops
      const targetAlpha = (1.0 - healthRatio / lowHealthThreshold) * 0.5;
      this._lowHealthBloodAlpha = this._lerpScalar(
        this._lowHealthBloodAlpha,
        targetAlpha,
        deltaTime * 3.0
      );
    } else {
      // Fade out
      this._lowHealthBloodAlpha = this._lerpScalar(
        this._lowHealthBloodAlpha,
        0,
        deltaTime * 4.0
      );
    }
    if (this._lowHealthBloodAlpha < 0.001) this._lowHealthBloodAlpha = 0;

    // Fade directional hit indicator
    if (this.hitDirectionTimer > 0) {
      this.hitDirectionTimer -= deltaTime;
      if (this.hitDirectionTimer <= 0) {
        this.hitDirectionTimer = 0;
        this.hitDirectionIndicator = null;
      }
    }
  }

  /**
   * Get the total overlay alpha for the HUD to read (flash + persistent blood).
   * @returns {number} Combined alpha 0..1
   */
  getDamageOverlayAlpha() {
    return Math.min(this.damageOverlayAlpha + this._lowHealthBloodAlpha, 1.0);
  }

  // =========================================================================
  // Camera Shake / Recoil
  // =========================================================================

  /**
   * Trigger a camera shake effect (explosions, damage hits).
   * @param {number} intensity - Shake strength
   * @private
   */
  _triggerCameraShake(intensity) {
    this._shakeIntensity = Math.max(this._shakeIntensity, intensity);
  }

  /**
   * Update the shake offsets. Decays exponentially each frame.
   * @param {number} deltaTime
   */
  updateCameraShake(deltaTime) {
    if (this._shakeIntensity > 0.0001) {
      // Random offsets scaled by intensity
      this._shakeOffsetX = (Math.random() - 0.5) * 2 * this._shakeIntensity;
      this._shakeOffsetY = (Math.random() - 0.5) * 2 * this._shakeIntensity;

      // Exponential decay
      this._shakeIntensity *= Math.exp(-this._shakeDecay * deltaTime);
    } else {
      this._shakeIntensity = 0;
      this._shakeOffsetX = 0;
      this._shakeOffsetY = 0;
    }
  }

  /**
   * Apply upward recoil from weapon fire. The offset smoothly recovers.
   * @param {number} amount - Upward pitch offset in radians
   */
  applyRecoil(amount) {
    this.recoilOffset += amount;
  }

  /**
   * Smoothly recover recoil offset back to zero.
   * @param {number} deltaTime
   * @private
   */
  _updateRecoil(deltaTime) {
    if (this.recoilOffset > 0.0001) {
      this.recoilOffset -= this.recoilOffset * this._recoilRecoverySpeed * deltaTime;
      if (this.recoilOffset < 0.0001) this.recoilOffset = 0;
    }
  }

  // =========================================================================
  // Death
  // =========================================================================

  /**
   * Kill the player. Drops camera to the ground, tilts sideways,
   * and emits the death event.
   */
  die() {
    if (this.isDead) return;

    this.isDead = true;
    this.health = 0;
    this._deathAnimProgress = 0;
    this._deathCameraStartY = this.position.y;

    if (this.eventBus) {
      this.eventBus.emit('playerDied', {
        position: this.position.clone(),
        points: this.points,
      });
    }
  }

  /**
   * Animate the death camera: drop Y, tilt roll, fade to completion.
   * @param {number} deltaTime
   * @private
   */
  _updateDeathAnimation(deltaTime) {
    if (this._deathAnimProgress >= 1.0) return;

    // Advance progress (takes ~1.5 seconds)
    this._deathAnimProgress += deltaTime / 1.5;
    if (this._deathAnimProgress > 1.0) this._deathAnimProgress = 1.0;

    // Ease-in curve for falling feel
    const t = this._easeInQuad(this._deathAnimProgress);

    // Camera drops from standing height to near-ground
    const currentY = this._lerpScalar(
      this._deathCameraStartY,
      this._deathCameraTargetY,
      t
    );
    this.camera.position.set(this.position.x, currentY, this.position.z);

    // Camera tilts sideways (roll)
    const roll = this._lerpScalar(0, this._deathRollTarget, t);

    // Slight downward pitch as player collapses
    const deathPitch = this._lerpScalar(this.pitch, -0.3, t);

    this._euler.set(deathPitch, this.yaw, roll, 'YXZ');
    this.camera.rotation.copy(this._euler);
  }

  /**
   * Quadratic ease-in.
   * @param {number} t - 0..1
   * @returns {number}
   * @private
   */
  _easeInQuad(t) {
    return t * t;
  }

  // =========================================================================
  // Points
  // =========================================================================

  /**
   * Award points to the player.
   * @param {number} amount
   */
  addPoints(amount) {
    if (amount <= 0) return;
    this.points += amount;

    if (this.eventBus) {
      this.eventBus.emit('pointsChanged', {
        points: this.points,
        added: amount,
      });
    }
  }

  /**
   * Spend points if the player has enough.
   * @param {number} amount
   * @returns {boolean} True if purchase succeeded
   */
  spendPoints(amount) {
    if (amount <= 0) return true;
    if (this.points < amount) return false;

    this.points -= amount;

    if (this.eventBus) {
      this.eventBus.emit('pointsChanged', {
        points: this.points,
        spent: amount,
      });
    }
    return true;
  }

  // =========================================================================
  // Interaction / Raycasting
  // =========================================================================

  /**
   * Raycast forward from the camera to find the nearest interactable
   * object within interactionRange.
   * Interactable objects should have userData.interactable = true and
   * userData.interactionType (e.g. 'wallBuy', 'mysteryBox', 'barricade', 'door').
   * @returns {object|null} { object, point, distance, type } or null
   */
  getInteractionTarget() {
    // Build direction from camera orientation
    const dir = this.getForwardDirection();

    this._raycaster.set(this.camera.position, dir);
    this._raycaster.far = this.interactionRange;

    // Gather all scene objects flagged as interactable
    const interactables = [];
    this.scene.traverse((child) => {
      if (child.isMesh && child.userData && child.userData.interactable) {
        interactables.push(child);
      }
    });

    if (interactables.length === 0) return null;

    const intersections = this._raycaster.intersectObjects(interactables, false);

    if (intersections.length === 0) return null;

    const hit = intersections[0];
    return {
      object: hit.object,
      point: hit.point,
      distance: hit.distance,
      type: hit.object.userData.interactionType || 'unknown',
      cost: hit.object.userData.cost || 0,
      prompt: hit.object.userData.prompt || '',
    };
  }

  /**
   * Check whether the player is currently looking at something interactable
   * within range.
   * @returns {boolean}
   */
  canInteract() {
    return this.getInteractionTarget() !== null;
  }

  // =========================================================================
  // Utility
  // =========================================================================

  /**
   * Get the normalized forward direction vector based on the player's yaw.
   * Points into the XZ plane (Y = 0).
   * @returns {THREE.Vector3}
   */
  getForwardDirection() {
    // Camera convention: -Z is forward, rotated by yaw around Y
    this._tempVec.set(0, 0, -1);
    this._tempVec.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    // Also incorporate pitch for true aim direction
    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);

    const forward = new THREE.Vector3(
      -Math.sin(this.yaw) * cosPitch,
      sinPitch,
      -Math.cos(this.yaw) * cosPitch
    );

    return forward.normalize();
  }

  /**
   * Get the player's current health.
   * @returns {number}
   */
  getHealth() {
    return this.health;
  }

  /**
   * Get the player's current position.
   * @returns {THREE.Vector3}
   */
  getPosition() {
    return this.position;
  }

  /**
   * Get the player's foot position (ground level).
   * @returns {THREE.Vector3}
   */
  getFootPosition() {
    return this._tempVec.set(
      this.position.x,
      this.position.y - this.height,
      this.position.z
    );
  }

  // =========================================================================
  // Reset
  // =========================================================================

  /**
   * Restore all player state to defaults and reposition at spawn.
   * Used when restarting the game.
   */
  reset() {
    // Health
    this.health = this.maxHealth;
    this.isDead = false;
    this.isRegenerating = false;
    this.regenTimer = 0;
    this.lastDamageTime = 0;

    // Points
    this.points = 500;

    // Movement
    this.velocity.set(0, 0, 0);
    this.isMoving = false;
    this.isSprinting = false;

    // Look
    this.pitch = 0;
    this.yaw = 0;
    this._targetPitch = 0;
    this._targetYaw = 0;

    // Head bob
    this.headBobTimer = 0;
    this._headBobOffsetY = 0;
    this._headBobOffsetX = 0;

    // Damage overlay
    this.damageOverlayAlpha = 0;
    this._lowHealthBloodAlpha = 0;
    this.hitDirectionIndicator = null;
    this.hitDirectionTimer = 0;

    // Camera shake / recoil
    this._shakeIntensity = 0;
    this._shakeOffsetX = 0;
    this._shakeOffsetY = 0;
    this.recoilOffset = 0;

    // Death animation
    this._deathAnimProgress = 0;

    // Reposition to spawn
    this.init();

    if (this.eventBus) {
      this.eventBus.emit('playerReset', {
        health: this.health,
        points: this.points,
      });
    }
  }
}
