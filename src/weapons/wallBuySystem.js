import * as THREE from 'three';
import { WEAPONS_DATA } from './weaponData.js';

/**
 * WallBuySystem - Manages weapon purchasing from wall locations and the Mystery Box.
 * Creates chalk weapon outlines on walls with price text, handles player proximity
 * detection, purchase logic, ammo refills, and the full Mystery Box cycling sequence.
 */
export class WallBuySystem {
  constructor(scene, eventBus, map, player, weaponSystem) {
    this.scene = scene;
    this.eventBus = eventBus;
    this.map = map;
    this.player = player;
    this.weaponSystem = weaponSystem;

    /** @type {Array<object>} Active wall buy stations in the world */
    this.wallBuys = [];

    /** @type {object|null} The mystery box instance */
    this.mysteryBox = null;

    /** @type {number} Interaction range for wall buys */
    this.interactionRange = 2.5;

    /** @type {object|null} The wall buy or mystery box currently in range */
    this.activePrompt = null;

    /** @type {number} Mystery box cost */
    this.mysteryBoxCost = 950;

    // Mystery box state
    this.mysteryBoxState = 'idle'; // 'idle', 'cycling', 'ready', 'cooldown'
    this.mysteryBoxTimer = 0;
    this.mysteryBoxCycleTimer = 0;
    this.mysteryBoxCycleInterval = 0.1;
    this.mysteryBoxResultWeapon = null;
    this.mysteryBoxGrabTimer = 0;
    this.mysteryBoxDisplayModel = null;

    // All weapon IDs that can come from the mystery box
    this.mysteryBoxPool = Object.keys(WEAPONS_DATA).filter(id => {
      // Include all weapons in the mystery box pool
      return true;
    });

    // Ray Gun weight: store separately so we can control its rarity
    this.rayGunChance = 0.05;

    this.init();
  }

  /**
   * Initialize wall buys from map data and set up the mystery box.
   */
  init() {
    // Read wall buy locations from the map
    if (this.map && this.map.wallBuyLocations) {
      for (const loc of this.map.wallBuyLocations) {
        this._createWallBuy(loc);
      }
    }

    // Set up mystery box
    if (this.map && this.map.mysteryBoxLocation) {
      this._createMysteryBox(this.map.mysteryBoxLocation);
    }
  }

  // ---------------------------------------------------------------------------
  // Wall Buy creation
  // ---------------------------------------------------------------------------

  /**
   * Create a wall buy station at the given location.
   * @param {object} loc - { position: {x,y,z}, weaponId: string, rotation?: number }
   * @private
   */
  _createWallBuy(loc) {
    const weaponData = WEAPONS_DATA[loc.weaponId];
    if (!weaponData) {
      console.warn(`WallBuySystem: Unknown weapon "${loc.weaponId}" for wall buy`);
      return;
    }

    const cost = weaponData.wallBuyCost;
    if (cost <= 0) return; // Don't create wall buys for free/mystery-box-only weapons

    const group = new THREE.Group();
    group.position.set(loc.position.x, loc.position.y, loc.position.z);
    if (loc.rotation !== undefined) {
      group.rotation.y = loc.rotation;
    }

    // Create chalk weapon outline on a wall plane
    const outlineMesh = this._createChalkOutline(loc.weaponId, weaponData.type);
    outlineMesh.position.set(0, 0.15, 0);
    group.add(outlineMesh);

    // Create price text sprite below the weapon outline
    const priceSprite = this._createTextSprite(
      `${weaponData.name} - ${cost} Points`,
      { fontSize: 28, color: '#e8d8b8', backgroundColor: 'rgba(0,0,0,0)' }
    );
    priceSprite.position.set(0, -0.25, 0.02);
    priceSprite.scale.set(0.8, 0.25, 1);
    group.add(priceSprite);

    this.scene.add(group);

    const wallBuyEntry = {
      type: 'wallBuy',
      group: group,
      weaponId: loc.weaponId,
      weaponData: weaponData,
      cost: cost,
      ammoCost: weaponData.ammoCost || Math.floor(cost / 2),
      position: new THREE.Vector3(loc.position.x, loc.position.y, loc.position.z),
      outlineMesh: outlineMesh,
      priceSprite: priceSprite,
      flashTimer: 0 // For purchase flash effect
    };

    this.wallBuys.push(wallBuyEntry);
  }

  /**
   * Create a chalk weapon silhouette drawn on a canvas, applied to a plane.
   * @param {string} weaponId
   * @param {string} weaponType
   * @returns {THREE.Mesh}
   * @private
   */
  _createChalkOutline(weaponId, weaponType) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Transparent background
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Chalk-like style
    ctx.strokeStyle = 'rgba(220, 210, 190, 0.85)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255, 255, 240, 0.3)';
    ctx.shadowBlur = 3;

    // Draw a weapon silhouette based on type
    ctx.beginPath();
    switch (weaponType) {
      case 'pistol':
        // Compact pistol shape
        ctx.moveTo(60, 50);
        ctx.lineTo(190, 50);
        ctx.lineTo(195, 55);
        ctx.lineTo(195, 65);
        ctx.lineTo(190, 65);
        ctx.lineTo(150, 65);
        ctx.lineTo(145, 100);
        ctx.lineTo(115, 100);
        ctx.lineTo(110, 65);
        ctx.lineTo(60, 65);
        ctx.closePath();
        break;

      case 'rifle':
        // Rifle with stock
        ctx.moveTo(20, 50);
        ctx.lineTo(200, 50);
        ctx.lineTo(240, 45);
        ctx.lineTo(240, 55);
        ctx.lineTo(200, 60);
        ctx.lineTo(200, 65);
        ctx.lineTo(155, 65);
        ctx.lineTo(150, 95);
        ctx.lineTo(125, 95);
        ctx.lineTo(120, 65);
        ctx.lineTo(60, 65);
        ctx.lineTo(55, 60);
        ctx.lineTo(20, 60);
        ctx.closePath();
        break;

      case 'smg':
        // SMG with drum / compact look
        ctx.moveTo(30, 48);
        ctx.lineTo(200, 48);
        ctx.lineTo(210, 45);
        ctx.lineTo(210, 58);
        ctx.lineTo(200, 58);
        ctx.lineTo(165, 58);
        ctx.lineTo(160, 95);
        ctx.lineTo(135, 95);
        ctx.lineTo(130, 70);
        ctx.lineTo(110, 70);
        // Drum magazine circle
        ctx.arc(120, 85, 18, Math.PI, 0, true);
        ctx.lineTo(130, 70);
        ctx.moveTo(110, 70);
        ctx.lineTo(60, 60);
        ctx.lineTo(30, 58);
        ctx.closePath();
        break;

      case 'shotgun':
        // Shotgun shape (long barrel, stock)
        ctx.moveTo(15, 52);
        ctx.lineTo(220, 48);
        ctx.lineTo(245, 45);
        ctx.lineTo(245, 58);
        ctx.lineTo(220, 58);
        ctx.lineTo(180, 62);
        ctx.lineTo(175, 90);
        ctx.lineTo(150, 90);
        ctx.lineTo(148, 62);
        ctx.lineTo(80, 62);
        ctx.lineTo(15, 58);
        ctx.closePath();
        // Double barrel indicator for double_barrel
        if (weaponId === 'double_barrel') {
          ctx.moveTo(220, 50);
          ctx.lineTo(245, 50);
          ctx.moveTo(220, 56);
          ctx.lineTo(245, 56);
        }
        break;

      case 'lmg':
        // LMG shape (long, bipod, big magazine)
        ctx.moveTo(10, 50);
        ctx.lineTo(210, 48);
        ctx.lineTo(240, 45);
        ctx.lineTo(240, 58);
        ctx.lineTo(210, 58);
        ctx.lineTo(175, 62);
        ctx.lineTo(170, 100);
        ctx.lineTo(145, 100);
        ctx.lineTo(140, 62);
        ctx.lineTo(80, 62);
        ctx.lineTo(10, 58);
        ctx.closePath();
        // Bipod legs
        ctx.moveTo(230, 58);
        ctx.lineTo(225, 80);
        ctx.moveTo(235, 58);
        ctx.lineTo(240, 80);
        break;

      case 'special':
        // Sci-fi shape for Ray Gun
        ctx.arc(200, 55, 22, 0, Math.PI * 2);
        ctx.moveTo(178, 55);
        ctx.lineTo(80, 55);
        ctx.lineTo(75, 50);
        ctx.lineTo(40, 50);
        ctx.lineTo(40, 60);
        ctx.lineTo(75, 60);
        ctx.lineTo(80, 55);
        ctx.moveTo(120, 55);
        ctx.lineTo(125, 90);
        ctx.lineTo(105, 90);
        ctx.lineTo(100, 55);
        break;

      default:
        // Generic gun shape
        ctx.moveTo(30, 50);
        ctx.lineTo(220, 50);
        ctx.lineTo(220, 65);
        ctx.lineTo(160, 65);
        ctx.lineTo(155, 90);
        ctx.lineTo(130, 90);
        ctx.lineTo(125, 65);
        ctx.lineTo(30, 65);
        ctx.closePath();
        break;
    }
    ctx.stroke();

    // Add some chalk dust noise for authenticity
    ctx.fillStyle = 'rgba(220, 210, 190, 0.15)';
    for (let i = 0; i < 40; i++) {
      const px = Math.random() * canvas.width;
      const py = Math.random() * canvas.height;
      const size = Math.random() * 2 + 0.5;
      ctx.fillRect(px, py, size, size);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.4),
      material
    );

    return plane;
  }

  /**
   * Create a text sprite using CanvasTexture.
   * @param {string} text
   * @param {object} options - { fontSize, color, backgroundColor }
   * @returns {THREE.Sprite}
   * @private
   */
  _createTextSprite(text, options = {}) {
    const fontSize = options.fontSize || 24;
    const color = options.color || '#ffffff';
    const bgColor = options.backgroundColor || 'rgba(0,0,0,0.5)';

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Text
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });

    const sprite = new THREE.Sprite(spriteMat);
    return sprite;
  }

  // ---------------------------------------------------------------------------
  // Mystery Box creation
  // ---------------------------------------------------------------------------

  /**
   * Create the mystery box at the given map location.
   * @param {object} loc - { position: {x,y,z}, rotation?: number }
   * @private
   */
  _createMysteryBox(loc) {
    const group = new THREE.Group();
    group.position.set(loc.position.x, loc.position.y, loc.position.z);
    if (loc.rotation !== undefined) {
      group.rotation.y = loc.rotation;
    }

    // Box body (wooden crate)
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x5c3a1e,
      roughness: 0.8,
      metalness: 0.1
    });
    const boxBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.5, 0.5),
      boxMat
    );
    boxBody.position.set(0, 0.25, 0);
    boxBody.castShadow = true;
    boxBody.receiveShadow = true;
    group.add(boxBody);

    // Box lid (separate mesh for animation)
    const lidMat = new THREE.MeshStandardMaterial({
      color: 0x6b4423,
      roughness: 0.75,
      metalness: 0.1
    });
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.06, 0.52),
      lidMat
    );
    // Lid pivot at the back edge: move origin by offsetting geometry
    lid.geometry.translate(0, 0, -0.26);
    lid.position.set(0, 0.53, 0.26);
    lid.castShadow = true;
    group.add(lid);

    // Metal trim on the box
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x888866,
      roughness: 0.4,
      metalness: 0.8
    });

    // Front trim strip
    const frontTrim = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, 0.04, 0.02),
      trimMat
    );
    frontTrim.position.set(0, 0.5, 0.26);
    group.add(frontTrim);

    // Side trims
    const sideTrimL = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.5, 0.52),
      trimMat
    );
    sideTrimL.position.set(-0.41, 0.25, 0);
    group.add(sideTrimL);

    const sideTrimR = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.5, 0.52),
      trimMat
    );
    sideTrimR.position.set(0.41, 0.25, 0);
    group.add(sideTrimR);

    // Question mark texture on front
    const questionSprite = this._createTextSprite('?', {
      fontSize: 72,
      color: '#ffdd44',
      backgroundColor: 'rgba(0,0,0,0)'
    });
    questionSprite.position.set(0, 0.35, 0.27);
    questionSprite.scale.set(0.3, 0.3, 1);
    group.add(questionSprite);

    // Price text floating above
    const priceSprite = this._createTextSprite(
      `Mystery Box - ${this.mysteryBoxCost} Points`,
      { fontSize: 26, color: '#ffdd44', backgroundColor: 'rgba(0,0,0,0)' }
    );
    priceSprite.position.set(0, 0.9, 0);
    priceSprite.scale.set(0.9, 0.25, 1);
    group.add(priceSprite);

    // Glow light inside the box (visible when open)
    const glowLight = new THREE.PointLight(0xffdd44, 0, 5, 2);
    glowLight.position.set(0, 0.4, 0);
    group.add(glowLight);

    this.scene.add(group);

    this.mysteryBox = {
      type: 'mysteryBox',
      group: group,
      position: new THREE.Vector3(loc.position.x, loc.position.y, loc.position.z),
      lid: lid,
      glowLight: glowLight,
      priceSprite: priceSprite,
      questionSprite: questionSprite,
      lidOpenAngle: 0, // current lid rotation in radians
      lidTargetAngle: 0 // target lid rotation
    };
  }

  // ---------------------------------------------------------------------------
  // Main update loop
  // ---------------------------------------------------------------------------

  /**
   * Update wall buy system each frame. Checks proximity, handles input, updates mystery box.
   * @param {number} deltaTime - Seconds since last frame
   * @param {THREE.Vector3} playerPosition - Current player world position
   */
  update(deltaTime, playerPosition) {
    const dt = Math.min(deltaTime, 0.1);

    this.activePrompt = null;

    // Check proximity to wall buys
    this._updateWallBuys(dt, playerPosition);

    // Check proximity to mystery box
    this._updateMysteryBox(dt, playerPosition);

    // Update wall buy flash effects
    this._updateFlashEffects(dt);
  }

  /**
   * Check all wall buys for player proximity and handle purchase.
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   * @private
   */
  _updateWallBuys(dt, playerPos) {
    for (const wb of this.wallBuys) {
      const dist = playerPos.distanceTo(wb.position);

      if (dist <= this.interactionRange) {
        // Determine if this is an ammo purchase or new weapon purchase
        const playerHasWeapon = this.weaponSystem.getWeapons().some(w => w.id === wb.weaponId);
        const cost = playerHasWeapon ? wb.ammoCost : wb.cost;
        const action = playerHasWeapon ? 'buy ammo for' : 'buy';

        // Set active prompt for HUD display
        this.activePrompt = {
          type: 'wallBuy',
          message: `Press F to ${action} ${wb.weaponData.name} - ${cost} Points`,
          cost: cost,
          weaponId: wb.weaponId,
          isAmmoBuy: playerHasWeapon
        };

        if (this.eventBus) {
          this.eventBus.emit('showPrompt', this.activePrompt);
        }

        // Handle purchase input
        if (this._isInteractPressed()) {
          this._attemptWallBuyPurchase(wb, playerHasWeapon, cost);
        }

        // Only show one prompt at a time (closest)
        break;
      }
    }
  }

  /**
   * Attempt to purchase from a wall buy.
   * @param {object} wb - Wall buy entry
   * @param {boolean} isAmmoBuy - True if refilling ammo
   * @param {number} cost - Points cost
   * @private
   */
  _attemptWallBuyPurchase(wb, isAmmoBuy, cost) {
    const playerPoints = this._getPlayerPoints();

    if (playerPoints < cost) {
      if (this.eventBus) {
        this.eventBus.emit('purchaseFailed', { reason: 'Not enough points', cost: cost });
      }
      return;
    }

    // Deduct points
    this._deductPlayerPoints(cost);

    if (isAmmoBuy) {
      // Refill ammo for existing weapon
      this.weaponSystem.refillAmmo(wb.weaponId);
    } else {
      // Add new weapon to inventory
      this.weaponSystem.addWeapon(wb.weaponId);
    }

    // Flash the chalk outline to indicate purchase
    wb.flashTimer = 0.5;

    if (this.eventBus) {
      this.eventBus.emit('wallBuyPurchase', {
        weaponId: wb.weaponId,
        name: wb.weaponData.name,
        cost: cost,
        isAmmoBuy: isAmmoBuy
      });
    }
  }

  /**
   * Update flash animation on wall buy outlines after purchase.
   * @param {number} dt
   * @private
   */
  _updateFlashEffects(dt) {
    for (const wb of this.wallBuys) {
      if (wb.flashTimer > 0) {
        wb.flashTimer -= dt;

        // Flash: oscillate the outline opacity/emissive
        const flash = Math.sin(wb.flashTimer * 20) * 0.5 + 0.5;
        if (wb.outlineMesh && wb.outlineMesh.material) {
          wb.outlineMesh.material.opacity = 0.5 + flash * 0.5;
        }

        if (wb.flashTimer <= 0) {
          wb.flashTimer = 0;
          if (wb.outlineMesh && wb.outlineMesh.material) {
            wb.outlineMesh.material.opacity = 1.0;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Mystery Box logic
  // ---------------------------------------------------------------------------

  /**
   * Update the mystery box state machine and animations.
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   * @private
   */
  _updateMysteryBox(dt, playerPos) {
    if (!this.mysteryBox) return;

    const dist = playerPos.distanceTo(this.mysteryBox.position);
    const inRange = dist <= this.interactionRange;

    // Smoothly animate lid open/close
    this._animateMysteryBoxLid(dt);

    switch (this.mysteryBoxState) {
      case 'idle':
        if (inRange) {
          this.activePrompt = {
            type: 'mysteryBox',
            message: `Press F to use Mystery Box - ${this.mysteryBoxCost} Points`,
            cost: this.mysteryBoxCost
          };
          if (this.eventBus) {
            this.eventBus.emit('showPrompt', this.activePrompt);
          }

          if (this._isInteractPressed()) {
            this._attemptMysteryBoxUse();
          }
        }
        break;

      case 'cycling':
        this.mysteryBoxTimer -= dt;
        this.mysteryBoxCycleTimer -= dt;

        // Cycle through random weapons rapidly
        if (this.mysteryBoxCycleTimer <= 0) {
          this.mysteryBoxCycleTimer = this.mysteryBoxCycleInterval;
          // Slow down cycling as we approach the end
          if (this.mysteryBoxTimer < 1.0) {
            this.mysteryBoxCycleInterval = Math.min(this.mysteryBoxCycleInterval + 0.02, 0.5);
          }
          this._cycleDisplayWeapon();
        }

        // Rotate the display model
        if (this.mysteryBoxDisplayModel) {
          this.mysteryBoxDisplayModel.rotation.y += dt * 5;
          // Bob up and down
          this.mysteryBoxDisplayModel.position.y =
            this.mysteryBox.position.y + 0.9 + Math.sin(Date.now() * 0.005) * 0.05;
        }

        if (this.mysteryBoxTimer <= 0) {
          // Cycling complete - land on the result weapon
          this._setMysteryBoxResult();
          this.mysteryBoxState = 'ready';
          this.mysteryBoxGrabTimer = 5.0;
          this.mysteryBoxCycleInterval = 0.1; // reset

          if (this.eventBus) {
            this.eventBus.emit('mysteryBoxResult', {
              weaponId: this.mysteryBoxResultWeapon,
              name: WEAPONS_DATA[this.mysteryBoxResultWeapon].name
            });
          }
        }
        break;

      case 'ready':
        this.mysteryBoxGrabTimer -= dt;

        // Float and spin the result weapon
        if (this.mysteryBoxDisplayModel) {
          this.mysteryBoxDisplayModel.rotation.y += dt * 2;
          this.mysteryBoxDisplayModel.position.y =
            this.mysteryBox.position.y + 0.9 + Math.sin(Date.now() * 0.003) * 0.04;
        }

        if (inRange) {
          const weaponName = WEAPONS_DATA[this.mysteryBoxResultWeapon].name;
          this.activePrompt = {
            type: 'mysteryBoxGrab',
            message: `Press F to take ${weaponName}`,
            weaponId: this.mysteryBoxResultWeapon
          };
          if (this.eventBus) {
            this.eventBus.emit('showPrompt', this.activePrompt);
          }

          if (this._isInteractPressed()) {
            // Player grabs the weapon
            this.weaponSystem.addWeapon(this.mysteryBoxResultWeapon);

            if (this.eventBus) {
              this.eventBus.emit('mysteryBoxGrab', {
                weaponId: this.mysteryBoxResultWeapon,
                name: WEAPONS_DATA[this.mysteryBoxResultWeapon].name
              });
            }

            this._closeMysteryBox();
          }
        }

        // Time expired - weapon disappears
        if (this.mysteryBoxGrabTimer <= 0) {
          if (this.eventBus) {
            this.eventBus.emit('mysteryBoxTimeout', {
              weaponId: this.mysteryBoxResultWeapon
            });
          }
          this._closeMysteryBox();
        }
        break;

      case 'cooldown':
        this.mysteryBoxTimer -= dt;
        if (this.mysteryBoxTimer <= 0) {
          this.mysteryBoxState = 'idle';
        }
        break;
    }
  }

  /**
   * Attempt to use the mystery box (costs points).
   * @private
   */
  _attemptMysteryBoxUse() {
    const points = this._getPlayerPoints();

    if (points < this.mysteryBoxCost) {
      if (this.eventBus) {
        this.eventBus.emit('purchaseFailed', {
          reason: 'Not enough points',
          cost: this.mysteryBoxCost
        });
      }
      return;
    }

    // Deduct points
    this._deductPlayerPoints(this.mysteryBoxCost);

    // Open the lid
    this.mysteryBox.lidTargetAngle = -Math.PI * 0.6; // Open ~108 degrees

    // Turn on glow light
    this.mysteryBox.glowLight.intensity = 2;

    // Pick the result weapon now (but don't reveal yet)
    this._pickMysteryBoxWeapon();

    // Start cycling
    this.mysteryBoxState = 'cycling';
    this.mysteryBoxTimer = 3.0;
    this.mysteryBoxCycleTimer = 0;
    this.mysteryBoxCycleInterval = 0.1;

    if (this.eventBus) {
      this.eventBus.emit('mysteryBoxActivated', { cost: this.mysteryBoxCost });
    }
  }

  /**
   * Pick a random weapon for the mystery box result.
   * Ray Gun has only a 5% chance; other weapons are equally weighted.
   * @private
   */
  _pickMysteryBoxWeapon() {
    const roll = Math.random();

    if (roll < this.rayGunChance) {
      this.mysteryBoxResultWeapon = 'ray_gun';
    } else {
      // Pick from non-ray-gun pool
      const pool = this.mysteryBoxPool.filter(id => id !== 'ray_gun');
      const idx = Math.floor(Math.random() * pool.length);
      this.mysteryBoxResultWeapon = pool[idx];
    }
  }

  /**
   * Cycle to a random display weapon above the mystery box.
   * @private
   */
  _cycleDisplayWeapon() {
    // Remove old display model
    if (this.mysteryBoxDisplayModel) {
      this.scene.remove(this.mysteryBoxDisplayModel);
      this.mysteryBoxDisplayModel.traverse(child => {
        if (child.geometry) child.geometry.dispose();
      });
      this.mysteryBoxDisplayModel = null;
    }

    // Pick a random weapon to display
    const randomId = this.mysteryBoxPool[
      Math.floor(Math.random() * this.mysteryBoxPool.length)
    ];

    this._spawnDisplayModel(randomId);
  }

  /**
   * Set the mystery box to display the final result weapon.
   * @private
   */
  _setMysteryBoxResult() {
    // Remove cycling model
    if (this.mysteryBoxDisplayModel) {
      this.scene.remove(this.mysteryBoxDisplayModel);
      this.mysteryBoxDisplayModel.traverse(child => {
        if (child.geometry) child.geometry.dispose();
      });
      this.mysteryBoxDisplayModel = null;
    }

    // Spawn the result weapon model
    this._spawnDisplayModel(this.mysteryBoxResultWeapon);
  }

  /**
   * Spawn a weapon display model floating above the mystery box.
   * @param {string} weaponId
   * @private
   */
  _spawnDisplayModel(weaponId) {
    // Create a simple procedural representation for display
    const displayGroup = new THREE.Group();

    // Use colored boxes to represent different weapon types
    const data = WEAPONS_DATA[weaponId];
    let displayColor = 0x888888;
    let displayShape = 'rifle';

    if (data) {
      switch (data.type) {
        case 'pistol': displayColor = 0x333333; break;
        case 'rifle': displayColor = 0x5c3a1e; break;
        case 'smg': displayColor = 0x2a2a2a; break;
        case 'shotgun': displayColor = 0x4a3015; break;
        case 'lmg': displayColor = 0x3a3a3a; break;
        case 'special': displayColor = 0x00ff44; break;
      }
      displayShape = data.type;
    }

    const mat = new THREE.MeshStandardMaterial({
      color: displayColor,
      roughness: 0.5,
      metalness: 0.5,
      emissive: displayColor,
      emissiveIntensity: 0.2
    });

    // Simple body shape
    let bodyLength = 0.35;
    let bodyHeight = 0.06;
    if (displayShape === 'pistol') { bodyLength = 0.18; bodyHeight = 0.05; }
    if (displayShape === 'shotgun') { bodyLength = 0.45; }
    if (displayShape === 'lmg') { bodyLength = 0.5; bodyHeight = 0.07; }
    if (displayShape === 'special') { bodyLength = 0.25; }

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, bodyHeight, bodyLength),
      mat
    );
    displayGroup.add(body);

    // Barrel
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.3,
      metalness: 0.9
    });
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, bodyLength * 0.5, 6),
      barrelMat
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -bodyLength * 0.5;
    displayGroup.add(barrel);

    // For special weapons (Ray Gun), add a green sphere
    if (displayShape === 'special') {
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0x00ff44 })
      );
      glow.position.z = -bodyLength * 0.6;
      displayGroup.add(glow);
    }

    // Name label sprite above the weapon
    const nameSprite = this._createTextSprite(data ? data.name : weaponId, {
      fontSize: 32,
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0)'
    });
    nameSprite.position.set(0, 0.15, 0);
    nameSprite.scale.set(0.5, 0.15, 1);
    displayGroup.add(nameSprite);

    // Position above the mystery box
    displayGroup.position.set(
      this.mysteryBox.position.x,
      this.mysteryBox.position.y + 0.9,
      this.mysteryBox.position.z
    );
    displayGroup.scale.setScalar(1.5);

    this.scene.add(displayGroup);
    this.mysteryBoxDisplayModel = displayGroup;
  }

  /**
   * Close the mystery box (reset state, close lid, remove display model).
   * @private
   */
  _closeMysteryBox() {
    // Remove display model
    if (this.mysteryBoxDisplayModel) {
      this.scene.remove(this.mysteryBoxDisplayModel);
      this.mysteryBoxDisplayModel.traverse(child => {
        if (child.geometry) child.geometry.dispose();
      });
      this.mysteryBoxDisplayModel = null;
    }

    // Close lid
    this.mysteryBox.lidTargetAngle = 0;
    this.mysteryBox.glowLight.intensity = 0;

    // Brief cooldown before the box can be used again
    this.mysteryBoxState = 'cooldown';
    this.mysteryBoxTimer = 1.0;
    this.mysteryBoxResultWeapon = null;
  }

  /**
   * Smoothly animate the mystery box lid between current and target angle.
   * @param {number} dt
   * @private
   */
  _animateMysteryBoxLid(dt) {
    if (!this.mysteryBox || !this.mysteryBox.lid) return;

    const lid = this.mysteryBox.lid;
    const current = this.mysteryBox.lidOpenAngle;
    const target = this.mysteryBox.lidTargetAngle;

    if (Math.abs(current - target) > 0.01) {
      this.mysteryBox.lidOpenAngle = THREE.MathUtils.lerp(current, target, dt * 5);
      lid.rotation.x = this.mysteryBox.lidOpenAngle;
    } else {
      this.mysteryBox.lidOpenAngle = target;
      lid.rotation.x = target;
    }
  }

  // ---------------------------------------------------------------------------
  // Helper methods for player state interaction
  // ---------------------------------------------------------------------------

  /**
   * Check if the interact key (F) was pressed this frame.
   * @returns {boolean}
   * @private
   */
  _isInteractPressed() {
    // Check via input manager if available
    if (this.weaponSystem && this.weaponSystem.input) {
      return this.weaponSystem.input.isKeyPressed('KeyF');
    }
    // Fallback: check via player object
    if (this.player && this.player.input) {
      return this.player.input.isKeyPressed('KeyF');
    }
    return false;
  }

  /**
   * Get the player's current points.
   * @returns {number}
   * @private
   */
  _getPlayerPoints() {
    if (this.player && typeof this.player.points === 'number') {
      return this.player.points;
    }
    if (this.player && this.player.getPoints) {
      return this.player.getPoints();
    }
    // Fallback: emit event and hope something responds, or return Infinity to not block
    // In a real integration the player object should have points
    return 0;
  }

  /**
   * Deduct points from the player.
   * @param {number} amount
   * @private
   */
  _deductPlayerPoints(amount) {
    if (this.player && typeof this.player.points === 'number') {
      this.player.points -= amount;
    } else if (this.player && this.player.deductPoints) {
      this.player.deductPoints(amount);
    }

    if (this.eventBus) {
      this.eventBus.emit('pointsDeducted', { amount: amount });
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Get the current active prompt (for HUD rendering).
   * @returns {object|null} The prompt data or null if no prompt active
   */
  getActivePrompt() {
    return this.activePrompt;
  }

  /**
   * Get mystery box state for external systems.
   * @returns {string} Current state: 'idle', 'cycling', 'ready', 'cooldown'
   */
  getMysteryBoxState() {
    return this.mysteryBoxState;
  }

  /**
   * Manually add a wall buy location at runtime (for dynamic map areas opening).
   * @param {object} loc - { position: {x,y,z}, weaponId: string, rotation?: number }
   */
  addWallBuyLocation(loc) {
    this._createWallBuy(loc);
  }

  /**
   * Clean up all wall buy and mystery box resources.
   */
  dispose() {
    // Remove wall buy meshes
    for (const wb of this.wallBuys) {
      if (wb.group) {
        this.scene.remove(wb.group);
        wb.group.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (child.material.map) child.material.map.dispose();
            child.material.dispose();
          }
        });
      }
    }
    this.wallBuys = [];

    // Remove mystery box
    if (this.mysteryBox && this.mysteryBox.group) {
      this.scene.remove(this.mysteryBox.group);
      this.mysteryBox.group.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
    }

    // Remove display model if present
    if (this.mysteryBoxDisplayModel) {
      this.scene.remove(this.mysteryBoxDisplayModel);
      this.mysteryBoxDisplayModel.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
      this.mysteryBoxDisplayModel = null;
    }

    this.mysteryBox = null;
  }
}
