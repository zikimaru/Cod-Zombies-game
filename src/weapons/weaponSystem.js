import * as THREE from 'three';
import { WEAPONS_DATA } from './weaponData.js';

/**
 * WeaponSystem - Manages the player's weapons from first-person perspective.
 * Handles shooting, reloading, weapon swapping, procedural weapon models,
 * muzzle flash, recoil, bullet tracers, hit detection, and all weapon animations.
 */
export class WeaponSystem {
  constructor(scene, camera, eventBus, inputManager) {
    this.scene = scene;
    this.camera = camera;
    this.eventBus = eventBus;
    this.input = inputManager;

    this.weapons = []; // Player's current weapons (max 2)
    this.currentWeaponIndex = 0;
    this.currentWeapon = null;

    // Weapon view model (first person weapon mesh attached to camera)
    this.weaponContainer = new THREE.Group();
    this.camera.add(this.weaponContainer);

    // State
    this.isShooting = false;
    this.isReloading = false;
    this.isSwapping = false;
    this.shootTimer = 0;
    this.reloadTimer = 0;
    this.swapTimer = 0;
    this.swapPhase = 'none'; // 'lowering', 'raising', 'none'
    this.pendingSwapIndex = -1;

    // Weapon sway/bob
    this.swayAmount = 0;
    this.bobTimer = 0;

    // Recoil state
    this.recoilOffset = new THREE.Vector3();
    this.recoilRotation = new THREE.Euler();
    this.recoilRecoverySpeed = 8;

    // Reload animation state
    this.reloadAnimProgress = 0;
    this.reloadAnimBaseY = 0;

    // Muzzle flash
    this.muzzleFlash = null;
    this.muzzleFlashLight = null;
    this.muzzleFlashTimer = 0;

    // Bullet tracers active in scene
    this.tracers = [];

    // Bullet hole decals active in scene
    this.bulletHoles = [];
    this.maxBulletHoles = 50;

    // Raycaster for hit detection
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 200;

    // Weapon model cache: weaponId -> THREE.Group
    this.weaponModels = {};

    // Shared materials
    this.materials = {
      darkMetal: new THREE.MeshStandardMaterial({
        color: 0x2a2a2a,
        roughness: 0.4,
        metalness: 0.8
      }),
      blackMetal: new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.3,
        metalness: 0.9
      }),
      wood: new THREE.MeshStandardMaterial({
        color: 0x5c3a1e,
        roughness: 0.8,
        metalness: 0.05
      }),
      woodDark: new THREE.MeshStandardMaterial({
        color: 0x3d2510,
        roughness: 0.75,
        metalness: 0.05
      }),
      greenEmissive: new THREE.MeshStandardMaterial({
        color: 0x00ff44,
        emissive: 0x00ff44,
        emissiveIntensity: 0.8,
        roughness: 0.3,
        metalness: 0.6
      }),
      silverMetal: new THREE.MeshStandardMaterial({
        color: 0x888888,
        roughness: 0.3,
        metalness: 0.9
      }),
      rayGunBody: new THREE.MeshStandardMaterial({
        color: 0x445566,
        roughness: 0.2,
        metalness: 0.9
      })
    };

    this.init();
  }

  /**
   * Initialize the weapon system. Gives the player the starting Colt M1911
   * and sets up the muzzle flash effect.
   */
  init() {
    this._createMuzzleFlash();
    this.addWeapon('colt_m1911');
  }

  // ---------------------------------------------------------------------------
  // Procedural weapon model builders
  // ---------------------------------------------------------------------------

  /**
   * Build or retrieve a cached first-person weapon model for the given weaponId.
   * @param {string} weaponId
   * @returns {THREE.Group}
   */
  _getWeaponModel(weaponId) {
    if (this.weaponModels[weaponId]) {
      return this.weaponModels[weaponId].clone();
    }
    let model;
    switch (weaponId) {
      case 'colt_m1911':
        model = this._buildColtM1911();
        break;
      case 'm1_carbine':
        model = this._buildM1Carbine();
        break;
      case 'thompson':
        model = this._buildThompson();
        break;
      case 'double_barrel':
        model = this._buildDoubleBarrel();
        break;
      case 'bar':
        model = this._buildBAR();
        break;
      case 'stg44':
        model = this._buildSTG44();
        break;
      case 'trench_gun':
        model = this._buildTrenchGun();
        break;
      case 'ray_gun':
        model = this._buildRayGun();
        break;
      default:
        model = this._buildColtM1911();
        break;
    }
    this.weaponModels[weaponId] = model;
    return model.clone();
  }

  /** Colt M1911 - Pistol: box slide, smaller grip, cylinder barrel */
  _buildColtM1911() {
    const group = new THREE.Group();

    // Slide (top box)
    const slide = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.32),
      this.materials.darkMetal
    );
    slide.position.set(0, 0.03, -0.04);
    group.add(slide);

    // Grip (lower box, slightly angled)
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.12, 0.08),
      this.materials.blackMetal
    );
    grip.position.set(0, -0.06, 0.08);
    grip.rotation.x = 0.15;
    group.add(grip);

    // Barrel (cylinder protruding forward)
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8),
      this.materials.blackMetal
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.035, -0.24);
    group.add(barrel);

    // Trigger guard
    const triggerGuard = new THREE.Mesh(
      new THREE.TorusGeometry(0.02, 0.004, 6, 8, Math.PI),
      this.materials.darkMetal
    );
    triggerGuard.position.set(0, -0.02, 0.02);
    triggerGuard.rotation.z = Math.PI;
    group.add(triggerGuard);

    return group;
  }

  /** M1 Carbine - Rifle: long barrel/receiver, angled stock, small magazine */
  _buildM1Carbine() {
    const group = new THREE.Group();

    // Receiver (long box)
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.06, 0.5),
      this.materials.darkMetal
    );
    receiver.position.set(0, 0, 0);
    group.add(receiver);

    // Barrel (cylinder extending forward)
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8),
      this.materials.blackMetal
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, -0.4);
    group.add(barrel);

    // Stock (angled box going back)
    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.065, 0.3),
      this.materials.wood
    );
    stock.position.set(0, -0.025, 0.35);
    stock.rotation.x = 0.08;
    group.add(stock);

    // Magazine (small box underneath)
    const magazine = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.1, 0.04),
      this.materials.blackMetal
    );
    magazine.position.set(0, -0.07, 0);
    group.add(magazine);

    // Wooden handguard
    const handGuard = new THREE.Mesh(
      new THREE.BoxGeometry(0.048, 0.04, 0.2),
      this.materials.wood
    );
    handGuard.position.set(0, -0.02, -0.15);
    group.add(handGuard);

    return group;
  }

  /** Thompson SMG: cylinder barrel, box receiver, drum magazine, wood stock */
  _buildThompson() {
    const group = new THREE.Group();

    // Receiver body
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.07, 0.35),
      this.materials.darkMetal
    );
    receiver.position.set(0, 0, 0);
    group.add(receiver);

    // Barrel (cylinder with cooling fins look)
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.25, 8),
      this.materials.blackMetal
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, -0.3);
    group.add(barrel);

    // Barrel shroud (slightly larger cylinder around barrel)
    const shroud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.18, 8),
      this.materials.darkMetal
    );
    shroud.rotation.x = Math.PI / 2;
    shroud.position.set(0, 0.01, -0.24);
    group.add(shroud);

    // Drum magazine (flat cylinder underneath)
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.035, 16),
      this.materials.blackMetal
    );
    drum.position.set(0, -0.07, -0.02);
    group.add(drum);

    // Wood stock
    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.06, 0.22),
      this.materials.wood
    );
    stock.position.set(0, -0.01, 0.27);
    stock.rotation.x = 0.05;
    group.add(stock);

    // Pistol grip
    const pistolGrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.09, 0.05),
      this.materials.wood
    );
    pistolGrip.position.set(0, -0.065, 0.1);
    pistolGrip.rotation.x = 0.2;
    group.add(pistolGrip);

    // Foregrip (vertical)
    const foreGrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.07, 0.03),
      this.materials.wood
    );
    foreGrip.position.set(0, -0.06, -0.08);
    group.add(foreGrip);

    return group;
  }

  /** Double-Barrel Shotgun: two cylinders side by side, box receiver, wood stock */
  _buildDoubleBarrel() {
    const group = new THREE.Group();

    // Left barrel
    const barrelL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.5, 8),
      this.materials.darkMetal
    );
    barrelL.rotation.x = Math.PI / 2;
    barrelL.position.set(-0.018, 0.01, -0.25);
    group.add(barrelL);

    // Right barrel
    const barrelR = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.5, 8),
      this.materials.darkMetal
    );
    barrelR.rotation.x = Math.PI / 2;
    barrelR.position.set(0.018, 0.01, -0.25);
    group.add(barrelR);

    // Receiver (break-action hinge area)
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.055, 0.1),
      this.materials.darkMetal
    );
    receiver.position.set(0, 0, 0.02);
    group.add(receiver);

    // Stock
    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.065, 0.3),
      this.materials.wood
    );
    stock.position.set(0, -0.01, 0.22);
    stock.rotation.x = 0.06;
    group.add(stock);

    // Fore-end (wood under barrels)
    const foreEnd = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.035, 0.2),
      this.materials.wood
    );
    foreEnd.position.set(0, -0.015, -0.12);
    group.add(foreEnd);

    // Trigger guard
    const triggerGuard = new THREE.Mesh(
      new THREE.TorusGeometry(0.018, 0.004, 6, 8, Math.PI),
      this.materials.darkMetal
    );
    triggerGuard.position.set(0, -0.025, 0.04);
    triggerGuard.rotation.z = Math.PI;
    group.add(triggerGuard);

    return group;
  }

  /** BAR (LMG): long barrel with bipod, box receiver, long magazine, wood stock */
  _buildBAR() {
    const group = new THREE.Group();

    // Receiver
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.065, 0.45),
      this.materials.darkMetal
    );
    receiver.position.set(0, 0, 0);
    group.add(receiver);

    // Barrel (long)
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.4, 8),
      this.materials.blackMetal
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, -0.42);
    group.add(barrel);

    // Barrel gas tube (thinner cylinder on top)
    const gasTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.25, 6),
      this.materials.darkMetal
    );
    gasTube.rotation.x = Math.PI / 2;
    gasTube.position.set(0, 0.04, -0.3);
    group.add(gasTube);

    // Long magazine
    const magazine = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.16, 0.04),
      this.materials.blackMetal
    );
    magazine.position.set(0, -0.1, -0.02);
    magazine.rotation.x = 0.05;
    group.add(magazine);

    // Wood stock
    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.048, 0.06, 0.28),
      this.materials.wood
    );
    stock.position.set(0, -0.01, 0.34);
    stock.rotation.x = 0.05;
    group.add(stock);

    // Wood handguard
    const handGuard = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.035, 0.18),
      this.materials.wood
    );
    handGuard.position.set(0, -0.02, -0.18);
    group.add(handGuard);

    // Bipod - left leg
    const bipodL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.14, 4),
      this.materials.blackMetal
    );
    bipodL.position.set(-0.03, -0.06, -0.52);
    bipodL.rotation.z = -0.3;
    group.add(bipodL);

    // Bipod - right leg
    const bipodR = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.14, 4),
      this.materials.blackMetal
    );
    bipodR.position.set(0.03, -0.06, -0.52);
    bipodR.rotation.z = 0.3;
    group.add(bipodR);

    // Pistol grip
    const pistolGrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.08, 0.04),
      this.materials.wood
    );
    pistolGrip.position.set(0, -0.06, 0.12);
    pistolGrip.rotation.x = 0.2;
    group.add(pistolGrip);

    return group;
  }

  /** STG-44: angled receiver, curved magazine, barrel cylinder, wood stock */
  _buildSTG44() {
    const group = new THREE.Group();

    // Receiver (slightly angled)
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.06, 0.38),
      this.materials.darkMetal
    );
    receiver.position.set(0, 0, 0);
    group.add(receiver);

    // Barrel
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.013, 0.28, 8),
      this.materials.blackMetal
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.008, -0.33);
    group.add(barrel);

    // Barrel shroud
    const shroud = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.045, 0.15),
      this.materials.darkMetal
    );
    shroud.position.set(0, 0.005, -0.22);
    group.add(shroud);

    // Curved magazine (using a slightly rotated box to suggest the curve)
    const magazine = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.14, 0.045),
      this.materials.blackMetal
    );
    magazine.position.set(0, -0.09, -0.02);
    magazine.rotation.x = 0.15;
    group.add(magazine);

    // Wood stock
    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.055, 0.24),
      this.materials.wood
    );
    stock.position.set(0, -0.015, 0.3);
    stock.rotation.x = 0.06;
    group.add(stock);

    // Pistol grip
    const pistolGrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.08, 0.04),
      this.materials.wood
    );
    pistolGrip.position.set(0, -0.06, 0.1);
    pistolGrip.rotation.x = 0.25;
    group.add(pistolGrip);

    // Handguard (wood)
    const handGuard = new THREE.Mesh(
      new THREE.BoxGeometry(0.048, 0.035, 0.12),
      this.materials.wood
    );
    handGuard.position.set(0, -0.018, -0.12);
    group.add(handGuard);

    // Front sight post
    const frontSight = new THREE.Mesh(
      new THREE.BoxGeometry(0.006, 0.025, 0.006),
      this.materials.blackMetal
    );
    frontSight.position.set(0, 0.04, -0.38);
    group.add(frontSight);

    return group;
  }

  /** Trench Gun (pump shotgun): single barrel, box receiver, pump slide, wood stock */
  _buildTrenchGun() {
    const group = new THREE.Group();

    // Barrel
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.5, 8),
      this.materials.darkMetal
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.01, -0.28);
    group.add(barrel);

    // Receiver
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.06, 0.18),
      this.materials.darkMetal
    );
    receiver.position.set(0, 0, 0);
    group.add(receiver);

    // Pump slide (box around barrel area)
    const pumpSlide = new THREE.Mesh(
      new THREE.BoxGeometry(0.048, 0.04, 0.1),
      this.materials.woodDark
    );
    pumpSlide.position.set(0, -0.005, -0.15);
    group.add(pumpSlide);

    // Tubular magazine (below barrel)
    const tubeMag = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.35, 8),
      this.materials.darkMetal
    );
    tubeMag.rotation.x = Math.PI / 2;
    tubeMag.position.set(0, -0.02, -0.2);
    group.add(tubeMag);

    // Stock
    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.048, 0.06, 0.26),
      this.materials.wood
    );
    stock.position.set(0, -0.01, 0.22);
    stock.rotation.x = 0.05;
    group.add(stock);

    // Heat shield (perforated top)
    const heatShield = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.008, 0.3),
      this.materials.darkMetal
    );
    heatShield.position.set(0, 0.035, -0.18);
    group.add(heatShield);

    // Bayonet lug
    const bayonetLug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, 0.04, 4),
      this.materials.darkMetal
    );
    bayonetLug.rotation.x = Math.PI / 2;
    bayonetLug.position.set(0, -0.01, -0.52);
    group.add(bayonetLug);

    return group;
  }

  /** Ray Gun: sci-fi bulbous front, cylindrical body, green emissive accents */
  _buildRayGun() {
    const group = new THREE.Group();

    // Bulbous front (sphere)
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 12),
      this.materials.greenEmissive
    );
    bulb.position.set(0, 0.01, -0.22);
    group.add(bulb);

    // Main body (cylinder)
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.03, 0.28, 10),
      this.materials.rayGunBody
    );
    body.rotation.x = Math.PI / 2;
    body.position.set(0, 0, -0.05);
    group.add(body);

    // Rear cap (slightly wider disc)
    const rearCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10),
      this.materials.rayGunBody
    );
    rearCap.rotation.x = Math.PI / 2;
    rearCap.position.set(0, 0, 0.1);
    group.add(rearCap);

    // Green emissive ring near the front
    const ring1 = new THREE.Mesh(
      new THREE.TorusGeometry(0.038, 0.005, 8, 16),
      this.materials.greenEmissive
    );
    ring1.position.set(0, 0, -0.14);
    group.add(ring1);

    // Second green ring
    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(0.032, 0.004, 8, 16),
      this.materials.greenEmissive
    );
    ring2.position.set(0, 0, 0.0);
    group.add(ring2);

    // Grip (below body, angled back)
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.1, 0.05),
      this.materials.rayGunBody
    );
    grip.position.set(0, -0.06, 0.02);
    grip.rotation.x = 0.2;
    group.add(grip);

    // Green emissive strip on grip
    const gripStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.06, 0.02),
      this.materials.greenEmissive
    );
    gripStrip.position.set(0, -0.05, 0.04);
    gripStrip.rotation.x = 0.2;
    group.add(gripStrip);

    // Antenna / fin on top
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.004, 0.035, 0.12),
      this.materials.rayGunBody
    );
    fin.position.set(0, 0.04, -0.08);
    group.add(fin);

    // Antenna tip glow
    const antennaTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 6, 6),
      this.materials.greenEmissive
    );
    antennaTip.position.set(0, 0.06, -0.14);
    group.add(antennaTip);

    return group;
  }

  // ---------------------------------------------------------------------------
  // Muzzle flash setup
  // ---------------------------------------------------------------------------

  /**
   * Create the muzzle flash effect objects (reusable, hidden until fired).
   */
  _createMuzzleFlash() {
    // Small emissive plane for visual flash
    const flashGeo = new THREE.PlaneGeometry(0.08, 0.08);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffaa,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.muzzleFlash = new THREE.Mesh(flashGeo, flashMat);
    this.muzzleFlash.position.set(0, 0, -0.6);
    this.muzzleFlash.visible = false;
    this.weaponContainer.add(this.muzzleFlash);

    // Point light for muzzle flash illumination
    this.muzzleFlashLight = new THREE.PointLight(0xffdd66, 0, 8, 2);
    this.muzzleFlashLight.position.set(0, 0, -0.6);
    this.weaponContainer.add(this.muzzleFlashLight);
  }

  // ---------------------------------------------------------------------------
  // Weapon inventory management
  // ---------------------------------------------------------------------------

  /**
   * Add a weapon to the player's inventory.
   * If the player already has 2 weapons, the current weapon is replaced.
   * @param {string} weaponId - Key from WEAPONS_DATA
   */
  addWeapon(weaponId) {
    const data = WEAPONS_DATA[weaponId];
    if (!data) {
      console.warn(`WeaponSystem.addWeapon: Unknown weapon "${weaponId}"`);
      return;
    }

    // Check if player already owns this weapon -> refill ammo instead
    const existingIndex = this.weapons.findIndex(w => w.id === weaponId);
    if (existingIndex !== -1) {
      this.refillAmmo(weaponId);
      return;
    }

    const weaponInstance = {
      id: weaponId,
      data: data,
      currentAmmo: data.magazineSize,
      reserveAmmo: data.reserveAmmo,
      model: this._getWeaponModel(weaponId)
    };

    if (this.weapons.length < 2) {
      this.weapons.push(weaponInstance);
      this.currentWeaponIndex = this.weapons.length - 1;
    } else {
      // Replace current weapon
      this._removeWeaponModel(this.weapons[this.currentWeaponIndex]);
      this.weapons[this.currentWeaponIndex] = weaponInstance;
    }

    this._equipWeapon(this.currentWeaponIndex);

    if (this.eventBus) {
      this.eventBus.emit('weaponPickup', {
        weaponId,
        name: data.name,
        slotIndex: this.currentWeaponIndex
      });
    }
  }

  /**
   * Refill ammo for a weapon the player already owns.
   * @param {string} weaponId
   */
  refillAmmo(weaponId) {
    const weapon = this.weapons.find(w => w.id === weaponId);
    if (!weapon) return;
    weapon.reserveAmmo = weapon.data.reserveAmmo;
    weapon.currentAmmo = weapon.data.magazineSize;

    if (this.eventBus) {
      this.eventBus.emit('ammoRefilled', { weaponId, name: weapon.data.name });
    }
  }

  /**
   * Remove the 3D model of a weapon from the container.
   * @param {object} weaponInstance
   * @private
   */
  _removeWeaponModel(weaponInstance) {
    if (weaponInstance && weaponInstance.model) {
      this.weaponContainer.remove(weaponInstance.model);
    }
  }

  /**
   * Equip the weapon at the given inventory index.
   * Attaches the weapon model to the camera container.
   * @param {number} index
   * @private
   */
  _equipWeapon(index) {
    // Remove all existing weapon models from container
    for (const w of this.weapons) {
      if (w.model && w.model.parent === this.weaponContainer) {
        this.weaponContainer.remove(w.model);
      }
    }

    this.currentWeaponIndex = index;
    this.currentWeapon = this.weapons[index];

    if (!this.currentWeapon) return;

    const data = this.currentWeapon.data;
    const offset = data.modelOffset || { x: 0.3, y: -0.25, z: -0.5 };
    const scale = data.modelScale || 0.15;

    const model = this.currentWeapon.model;
    model.position.set(offset.x, offset.y, offset.z);
    model.scale.setScalar(scale);
    this.weaponContainer.add(model);

    // Reset animation state
    this.isReloading = false;
    this.isShooting = false;
    this.recoilOffset.set(0, 0, 0);
    this.recoilRotation.set(0, 0, 0);
    this.shootTimer = 0;
  }

  // ---------------------------------------------------------------------------
  // Swap weapon
  // ---------------------------------------------------------------------------

  /**
   * Begin the weapon swap animation to the given index.
   * @param {number} index - Inventory slot index (0 or 1)
   */
  swapWeapon(index) {
    if (index === this.currentWeaponIndex) return;
    if (index < 0 || index >= this.weapons.length) return;
    if (this.isSwapping || this.isReloading) return;

    this.isSwapping = true;
    this.swapPhase = 'lowering';
    this.swapTimer = 0;
    this.pendingSwapIndex = index;

    if (this.eventBus) {
      this.eventBus.emit('weaponSwapStart', { fromIndex: this.currentWeaponIndex, toIndex: index });
    }
  }

  // ---------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------

  /**
   * Attempt to fire the current weapon.
   */
  shoot() {
    if (!this.currentWeapon) return;
    if (this.isReloading || this.isSwapping) return;
    if (this.shootTimer > 0) return;
    if (this.currentWeapon.currentAmmo <= 0) {
      // Auto reload when attempting to shoot with empty magazine
      this.reload();
      return;
    }

    const data = this.currentWeapon.data;

    // Decrement ammo
    this.currentWeapon.currentAmmo--;

    // Set fire rate timer
    this.shootTimer = data.fireRate;

    // Trigger muzzle flash
    this._showMuzzleFlash();

    // Apply recoil
    this._applyRecoil(data.recoil);

    // Perform hit detection
    if (data.type === 'shotgun' && data.pellets) {
      // Shotgun fires multiple pellets
      for (let i = 0; i < data.pellets; i++) {
        this._performRaycast(data, true);
      }
    } else {
      this._performRaycast(data, false);
    }

    // Emit event
    if (this.eventBus) {
      this.eventBus.emit('weaponFired', {
        weaponId: this.currentWeapon.id,
        ammoLeft: this.currentWeapon.currentAmmo,
        reserveAmmo: this.currentWeapon.reserveAmmo
      });
    }
  }

  /**
   * Perform a single raycast for hit detection, create tracer and bullet hole.
   * @param {object} data - Weapon data
   * @param {boolean} applyExtraSpread - Whether to add pellet spread (shotguns)
   * @private
   */
  _performRaycast(data, applyExtraSpread) {
    // Calculate direction from camera center with weapon spread
    const direction = new THREE.Vector3(0, 0, -1);
    direction.applyQuaternion(this.camera.quaternion);

    // Apply weapon spread
    const spreadAmount = applyExtraSpread ? data.spread : data.spread * 0.5;
    direction.x += (Math.random() - 0.5) * spreadAmount * 2;
    direction.y += (Math.random() - 0.5) * spreadAmount * 2;
    direction.normalize();

    // Set up raycaster from camera position
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    this.raycaster.set(origin, direction);
    this.raycaster.far = data.range || 200;

    // Cast against all scene objects
    const intersects = this.raycaster.intersectObjects(this.scene.children, true);

    let hitPoint = null;
    let hitNormal = null;
    let hitObject = null;

    if (intersects.length > 0) {
      // Filter out weapon container objects and muzzle flash
      for (const hit of intersects) {
        // Skip our own weapon model and muzzle flash
        let isWeaponPart = false;
        let parent = hit.object;
        while (parent) {
          if (parent === this.weaponContainer) {
            isWeaponPart = true;
            break;
          }
          parent = parent.parent;
        }
        if (isWeaponPart) continue;

        hitPoint = hit.point.clone();
        hitNormal = hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0);
        hitObject = hit.object;
        break;
      }
    }

    // Create bullet tracer
    const tracerEnd = hitPoint
      ? hitPoint.clone()
      : origin.clone().add(direction.clone().multiplyScalar(data.range || 100));
    this._createTracer(origin, tracerEnd);

    if (hitPoint && hitObject) {
      // Check if we hit a zombie by traversing up to find userData.type === 'zombie'
      let zombieRoot = hitObject;
      let isZombie = false;
      let isHeadshot = false;

      while (zombieRoot) {
        if (zombieRoot.userData && zombieRoot.userData.type === 'zombie') {
          isZombie = true;
          break;
        }
        zombieRoot = zombieRoot.parent;
      }

      // Check for headshot (hit object or its parent named 'head' or tagged)
      if (hitObject.userData && hitObject.userData.isHead) {
        isHeadshot = true;
      } else if (hitObject.name && hitObject.name.toLowerCase().includes('head')) {
        isHeadshot = true;
      }

      if (isZombie) {
        const baseDamage = data.damage;
        const finalDamage = isHeadshot ? baseDamage * data.headshotMultiplier : baseDamage;

        if (this.eventBus) {
          this.eventBus.emit('zombieHit', {
            zombie: zombieRoot,
            damage: finalDamage,
            hitPoint: hitPoint,
            isHeadshot: isHeadshot,
            weaponId: this.currentWeapon.id,
            isExplosive: data.isExplosive || false,
            explosionRadius: data.explosionRadius || 0
          });
        }
      } else {
        // Hit a wall or prop: create bullet hole decal
        this._createBulletHole(hitPoint, hitNormal);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Visual effects
  // ---------------------------------------------------------------------------

  /**
   * Show the muzzle flash for a brief moment.
   * @private
   */
  _showMuzzleFlash() {
    this.muzzleFlashTimer = 0.05;
    this.muzzleFlash.visible = true;
    this.muzzleFlash.material.opacity = 1.0;
    // Random rotation for variety
    this.muzzleFlash.rotation.z = Math.random() * Math.PI * 2;
    // Random scale for variety
    const flashScale = 0.8 + Math.random() * 0.6;
    this.muzzleFlash.scale.setScalar(flashScale);

    this.muzzleFlashLight.intensity = 3 + Math.random() * 2;

    // Position the muzzle flash at the weapon muzzle
    if (this.currentWeapon) {
      const offset = this.currentWeapon.data.modelOffset || { x: 0.3, y: -0.25, z: -0.5 };
      this.muzzleFlash.position.set(offset.x, offset.y + 0.02, offset.z - 0.35);
      this.muzzleFlashLight.position.copy(this.muzzleFlash.position);
    }
  }

  /**
   * Apply recoil to the weapon model and camera.
   * @param {number} amount - Recoil magnitude
   * @private
   */
  _applyRecoil(amount) {
    // Weapon kick back and up
    this.recoilOffset.z += amount * 2.0;
    this.recoilOffset.y += amount * 0.5;

    // Camera pitch up slightly
    this.recoilRotation.x -= amount;

    // Add slight random horizontal recoil
    this.recoilRotation.y += (Math.random() - 0.5) * amount * 0.3;
  }

  /**
   * Create a bullet tracer line from start to end.
   * @param {THREE.Vector3} start
   * @param {THREE.Vector3} end
   * @private
   */
  _createTracer(start, end) {
    const points = [start, end];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xffff66,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);

    this.tracers.push({ mesh: line, life: 0.08 });
  }

  /**
   * Create a bullet hole decal on the hit surface.
   * @param {THREE.Vector3} point - Hit position
   * @param {THREE.Vector3} normal - Surface normal at hit
   * @private
   */
  _createBulletHole(point, normal) {
    // Small dark circle decal
    const holeGeo = new THREE.CircleGeometry(0.02, 8);
    const holeMat = new THREE.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1
    });
    const hole = new THREE.Mesh(holeGeo, holeMat);

    // Position slightly in front of the surface to avoid z-fighting
    hole.position.copy(point).add(normal.clone().multiplyScalar(0.005));

    // Orient to face along the surface normal
    hole.lookAt(point.clone().add(normal));

    this.scene.add(hole);
    this.bulletHoles.push(hole);

    // Limit total bullet holes to prevent memory issues
    if (this.bulletHoles.length > this.maxBulletHoles) {
      const old = this.bulletHoles.shift();
      this.scene.remove(old);
      old.geometry.dispose();
      old.material.dispose();
    }
  }

  // ---------------------------------------------------------------------------
  // Reload
  // ---------------------------------------------------------------------------

  /**
   * Begin reloading the current weapon if possible.
   */
  reload() {
    if (!this.currentWeapon) return;
    if (this.isReloading || this.isSwapping) return;

    const weapon = this.currentWeapon;
    // Don't reload if magazine is full or no reserve ammo
    if (weapon.currentAmmo >= weapon.data.magazineSize) return;
    if (weapon.reserveAmmo <= 0) return;

    this.isReloading = true;
    this.reloadTimer = weapon.data.reloadTime;
    this.reloadAnimProgress = 0;

    // Store the base Y position for the reload dip animation
    if (weapon.model) {
      this.reloadAnimBaseY = weapon.data.modelOffset
        ? weapon.data.modelOffset.y
        : -0.25;
    }

    if (this.eventBus) {
      this.eventBus.emit('reloadStart', {
        weaponId: weapon.id,
        reloadTime: weapon.data.reloadTime
      });
    }
  }

  /**
   * Complete the reload: transfer ammo from reserve to magazine.
   * @private
   */
  _finishReload() {
    if (!this.currentWeapon) return;

    const weapon = this.currentWeapon;
    const needed = weapon.data.magazineSize - weapon.currentAmmo;
    const transfer = Math.min(needed, weapon.reserveAmmo);

    weapon.currentAmmo += transfer;
    weapon.reserveAmmo -= transfer;

    this.isReloading = false;
    this.reloadTimer = 0;
    this.reloadAnimProgress = 0;

    // Restore weapon model position
    if (weapon.model && weapon.data.modelOffset) {
      weapon.model.position.y = weapon.data.modelOffset.y;
    }

    if (this.eventBus) {
      this.eventBus.emit('reloadComplete', {
        weaponId: weapon.id,
        currentAmmo: weapon.currentAmmo,
        reserveAmmo: weapon.reserveAmmo
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Animations
  // ---------------------------------------------------------------------------

  /**
   * Update idle sway animation (subtle breathing motion).
   * @param {number} dt
   * @private
   */
  _updateIdleSway(dt) {
    if (!this.currentWeapon || !this.currentWeapon.model) return;

    this.swayAmount += dt;
    const model = this.currentWeapon.model;
    const offset = this.currentWeapon.data.modelOffset || { x: 0.3, y: -0.25, z: -0.5 };

    // Subtle sinusoidal breathing sway
    const swayX = Math.sin(this.swayAmount * 1.2) * 0.002;
    const swayY = Math.sin(this.swayAmount * 0.8) * 0.003;

    if (!this.isReloading && !this.isSwapping) {
      model.position.x = offset.x + swayX;
      model.position.y = offset.y + swayY;
    }
  }

  /**
   * Update walking bob animation (figure-8 pattern).
   * @param {number} dt
   * @param {boolean} isMoving
   * @param {boolean} isSprinting
   * @private
   */
  _updateWalkBob(dt, isMoving, isSprinting) {
    if (!this.currentWeapon || !this.currentWeapon.model) return;
    if (this.isReloading || this.isSwapping) return;

    const model = this.currentWeapon.model;
    const offset = this.currentWeapon.data.modelOffset || { x: 0.3, y: -0.25, z: -0.5 };

    if (isMoving) {
      const speed = isSprinting ? 12 : 8;
      const intensity = isSprinting ? 1.5 : 1.0;

      this.bobTimer += dt * speed;

      // Figure-8 bob pattern
      const bobX = Math.sin(this.bobTimer) * 0.01 * intensity;
      const bobY = Math.abs(Math.sin(this.bobTimer * 2)) * 0.008 * intensity;

      model.position.x = offset.x + bobX;
      model.position.y = offset.y + bobY;

      // Sprint: move weapon to center-chest carry position
      if (isSprinting) {
        model.position.x = offset.x - 0.1 + bobX;
        model.position.y = offset.y + 0.05 + bobY;
        model.rotation.y = THREE.MathUtils.lerp(model.rotation.y, -0.3, dt * 5);
        model.rotation.x = THREE.MathUtils.lerp(model.rotation.x, 0.2, dt * 5);
      } else {
        model.rotation.y = THREE.MathUtils.lerp(model.rotation.y, 0, dt * 5);
        model.rotation.x = THREE.MathUtils.lerp(model.rotation.x, 0, dt * 5);
      }
    } else {
      // Return to idle position smoothly
      this.bobTimer = 0;
      model.rotation.y = THREE.MathUtils.lerp(model.rotation.y, 0, dt * 5);
      model.rotation.x = THREE.MathUtils.lerp(model.rotation.x, 0, dt * 5);
    }
  }

  /**
   * Update the shoot recoil animation (kick back + recovery).
   * @param {number} dt
   * @private
   */
  _updateRecoilAnimation(dt) {
    if (!this.currentWeapon || !this.currentWeapon.model) return;

    const model = this.currentWeapon.model;
    const offset = this.currentWeapon.data.modelOffset || { x: 0.3, y: -0.25, z: -0.5 };

    // Recover recoil offset smoothly back to zero
    this.recoilOffset.lerp(new THREE.Vector3(0, 0, 0), dt * this.recoilRecoverySpeed);

    // Apply recoil offset to weapon position
    model.position.z = offset.z + this.recoilOffset.z;

    // Recover camera recoil rotation
    this.recoilRotation.x = THREE.MathUtils.lerp(this.recoilRotation.x, 0, dt * this.recoilRecoverySpeed * 0.5);
    this.recoilRotation.y = THREE.MathUtils.lerp(this.recoilRotation.y, 0, dt * this.recoilRecoverySpeed * 0.5);

    // Apply camera recoil (the game's player controller should read this)
    if (this.eventBus && (Math.abs(this.recoilRotation.x) > 0.0001 || Math.abs(this.recoilRotation.y) > 0.0001)) {
      this.eventBus.emit('weaponRecoil', {
        pitchDelta: this.recoilRotation.x * dt * 2,
        yawDelta: this.recoilRotation.y * dt * 2
      });
    }
  }

  /**
   * Update reload animation: weapon dips down, pauses, returns.
   * @param {number} dt
   * @private
   */
  _updateReloadAnimation(dt) {
    if (!this.isReloading || !this.currentWeapon || !this.currentWeapon.model) return;

    const model = this.currentWeapon.model;
    const totalTime = this.currentWeapon.data.reloadTime;
    const elapsed = totalTime - this.reloadTimer;
    const progress = elapsed / totalTime; // 0 -> 1

    const baseY = this.reloadAnimBaseY;
    const dipAmount = 0.25; // how far the weapon dips

    if (progress < 0.3) {
      // Phase 1: Lower weapon
      const t = progress / 0.3;
      const eased = t * t; // ease in
      model.position.y = baseY - dipAmount * eased;
      model.rotation.x = -0.3 * eased;
    } else if (progress < 0.7) {
      // Phase 2: Hold low (magazine swap)
      model.position.y = baseY - dipAmount;
      model.rotation.x = -0.3;
    } else {
      // Phase 3: Raise weapon back
      const t = (progress - 0.7) / 0.3;
      const eased = 1 - (1 - t) * (1 - t); // ease out
      model.position.y = baseY - dipAmount * (1 - eased);
      model.rotation.x = -0.3 * (1 - eased);
    }
  }

  /**
   * Update weapon swap animation.
   * @param {number} dt
   * @private
   */
  _updateSwapAnimation(dt) {
    if (!this.isSwapping) return;

    const swapDuration = 0.4; // seconds for each phase (lower / raise)
    this.swapTimer += dt;

    if (this.swapPhase === 'lowering') {
      const progress = Math.min(this.swapTimer / swapDuration, 1);
      const eased = progress * progress;

      if (this.currentWeapon && this.currentWeapon.model) {
        const offset = this.currentWeapon.data.modelOffset || { x: 0.3, y: -0.25, z: -0.5 };
        this.currentWeapon.model.position.y = offset.y - 0.5 * eased;
      }

      if (progress >= 1) {
        // Swap the actual weapon
        this._equipWeapon(this.pendingSwapIndex);
        this.swapPhase = 'raising';
        this.swapTimer = 0;

        // Start the new weapon below screen
        if (this.currentWeapon && this.currentWeapon.model) {
          const offset = this.currentWeapon.data.modelOffset || { x: 0.3, y: -0.25, z: -0.5 };
          this.currentWeapon.model.position.y = offset.y - 0.5;
        }
      }
    } else if (this.swapPhase === 'raising') {
      const progress = Math.min(this.swapTimer / swapDuration, 1);
      const eased = 1 - (1 - progress) * (1 - progress);

      if (this.currentWeapon && this.currentWeapon.model) {
        const offset = this.currentWeapon.data.modelOffset || { x: 0.3, y: -0.25, z: -0.5 };
        this.currentWeapon.model.position.y = offset.y - 0.5 * (1 - eased);
      }

      if (progress >= 1) {
        this.isSwapping = false;
        this.swapPhase = 'none';
        this.swapTimer = 0;

        if (this.eventBus) {
          this.eventBus.emit('weaponSwapComplete', {
            weaponId: this.currentWeapon ? this.currentWeapon.id : null,
            slotIndex: this.currentWeaponIndex
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Visual effect updates
  // ---------------------------------------------------------------------------

  /**
   * Update muzzle flash timer and fade out.
   * @param {number} dt
   * @private
   */
  _updateMuzzleFlash(dt) {
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      if (this.muzzleFlashTimer <= 0) {
        this.muzzleFlash.visible = false;
        this.muzzleFlash.material.opacity = 0;
        this.muzzleFlashLight.intensity = 0;
      } else {
        // Fade out
        const t = this.muzzleFlashTimer / 0.05;
        this.muzzleFlash.material.opacity = t;
        this.muzzleFlashLight.intensity = (3 + Math.random()) * t;
      }
    }
  }

  /**
   * Update bullet tracers (fade and remove).
   * @param {number} dt
   * @private
   */
  _updateTracers(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.life -= dt;

      if (tracer.life <= 0) {
        this.scene.remove(tracer.mesh);
        tracer.mesh.geometry.dispose();
        tracer.mesh.material.dispose();
        this.tracers.splice(i, 1);
      } else {
        tracer.mesh.material.opacity = tracer.life / 0.08;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public getters
  // ---------------------------------------------------------------------------

  /**
   * Get the current ammo state.
   * @returns {{ current: number, reserve: number, magazineSize: number }}
   */
  getCurrentAmmo() {
    if (!this.currentWeapon) return { current: 0, reserve: 0, magazineSize: 0 };
    return {
      current: this.currentWeapon.currentAmmo,
      reserve: this.currentWeapon.reserveAmmo,
      magazineSize: this.currentWeapon.data.magazineSize
    };
  }

  /**
   * Get the display name of the current weapon.
   * @returns {string}
   */
  getWeaponName() {
    if (!this.currentWeapon) return '';
    return this.currentWeapon.data.name;
  }

  /**
   * Get the current weapon data object.
   * @returns {object|null}
   */
  getCurrentWeaponData() {
    if (!this.currentWeapon) return null;
    return this.currentWeapon.data;
  }

  /**
   * Get full weapons inventory.
   * @returns {Array}
   */
  getWeapons() {
    return this.weapons;
  }

  // ---------------------------------------------------------------------------
  // Main update loop
  // ---------------------------------------------------------------------------

  /**
   * Main update method. Call every frame.
   * @param {number} deltaTime - Seconds since last frame
   * @param {boolean} isMoving - Whether the player is moving
   * @param {boolean} isSprinting - Whether the player is sprinting
   */
  update(deltaTime, isMoving, isSprinting) {
    // Clamp deltaTime to avoid physics explosions on tab-back
    const dt = Math.min(deltaTime, 0.1);

    // --- Input handling ---
    this._handleInput(dt, isSprinting);

    // --- Timers ---
    if (this.shootTimer > 0) {
      this.shootTimer -= dt;
    }

    // Reload timer
    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this._finishReload();
      }
    }

    // --- Animations ---
    this._updateIdleSway(dt);
    this._updateWalkBob(dt, isMoving, isSprinting);
    this._updateRecoilAnimation(dt);
    this._updateReloadAnimation(dt);
    this._updateSwapAnimation(dt);

    // --- Visual effects ---
    this._updateMuzzleFlash(dt);
    this._updateTracers(dt);
  }

  /**
   * Handle player input for shooting, reloading, and swapping weapons.
   * @param {number} dt
   * @param {boolean} isSprinting
   * @private
   */
  _handleInput(dt, isSprinting) {
    if (!this.input || !this.currentWeapon) return;

    // Don't allow shooting while sprinting
    if (!isSprinting && !this.isSwapping) {
      if (this.currentWeapon.data.isAutomatic) {
        // Automatic: hold LMB to fire
        if (this.input.isMouseButtonDown(0)) {
          this.shoot();
        }
      } else {
        // Semi-auto: press LMB to fire (single shot per click)
        if (this.input.isMouseButtonPressed(0)) {
          this.shoot();
        }
      }
    }

    // R key to reload
    if (this.input.isKeyPressed('KeyR')) {
      this.reload();
    }

    // 1 and 2 keys to swap weapons
    if (this.input.isKeyPressed('Digit1') && this.weapons.length >= 1) {
      this.swapWeapon(0);
    }
    if (this.input.isKeyPressed('Digit2') && this.weapons.length >= 2) {
      this.swapWeapon(1);
    }

    // Scroll wheel swap (optional convenience)
    // This would need mouse wheel event from input manager; skip for now
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * Dispose of all resources.
   */
  dispose() {
    // Remove weapon models
    for (const w of this.weapons) {
      if (w.model) {
        this.weaponContainer.remove(w.model);
        w.model.traverse(child => {
          if (child.geometry) child.geometry.dispose();
        });
      }
    }

    // Remove muzzle flash
    if (this.muzzleFlash) {
      this.weaponContainer.remove(this.muzzleFlash);
      this.muzzleFlash.geometry.dispose();
      this.muzzleFlash.material.dispose();
    }
    if (this.muzzleFlashLight) {
      this.weaponContainer.remove(this.muzzleFlashLight);
    }

    // Remove tracers
    for (const tracer of this.tracers) {
      this.scene.remove(tracer.mesh);
      tracer.mesh.geometry.dispose();
      tracer.mesh.material.dispose();
    }
    this.tracers = [];

    // Remove bullet holes
    for (const hole of this.bulletHoles) {
      this.scene.remove(hole);
      hole.geometry.dispose();
      hole.material.dispose();
    }
    this.bulletHoles = [];

    // Remove weapon container from camera
    this.camera.remove(this.weaponContainer);

    // Dispose shared materials
    for (const key of Object.keys(this.materials)) {
      this.materials[key].dispose();
    }

    // Dispose cached weapon model geometries
    for (const key of Object.keys(this.weaponModels)) {
      this.weaponModels[key].traverse(child => {
        if (child.geometry) child.geometry.dispose();
      });
    }
    this.weaponModels = {};
  }
}
