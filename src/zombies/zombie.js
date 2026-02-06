import * as THREE from 'three';

/**
 * Zombie - A single zombie entity with procedural mesh, state machine AI,
 * procedural animations, and hitbox detection for a CoD WaW-style zombies game.
 *
 * States: inactive -> spawning -> breaking -> chasing -> attacking -> dying -> dead -> inactive (pool)
 */

// Shared materials (created once, reused across all zombie instances)
let _sharedMaterials = null;

function getSharedMaterials() {
  if (_sharedMaterials) return _sharedMaterials;

  _sharedMaterials = {
    // Skin tones - sickly greens and greys
    skin: new THREE.MeshStandardMaterial({
      color: 0x5a6b52,
      roughness: 0.9,
      metalness: 0.0,
    }),
    skinAlt: new THREE.MeshStandardMaterial({
      color: 0x4a5a42,
      roughness: 0.9,
      metalness: 0.0,
    }),
    skinPale: new THREE.MeshStandardMaterial({
      color: 0x6b7b63,
      roughness: 0.85,
      metalness: 0.0,
    }),
    // Uniform colors
    uniformGrey: new THREE.MeshStandardMaterial({
      color: 0x3a3a3a,
      roughness: 0.85,
      metalness: 0.05,
    }),
    uniformOlive: new THREE.MeshStandardMaterial({
      color: 0x4a5a3a,
      roughness: 0.85,
      metalness: 0.05,
    }),
    uniformBrown: new THREE.MeshStandardMaterial({
      color: 0x3a3028,
      roughness: 0.85,
      metalness: 0.05,
    }),
    // Eyes - glowing emissive
    eye: new THREE.MeshStandardMaterial({
      color: 0xff4400,
      emissive: 0xff4400,
      emissiveIntensity: 2.0,
      roughness: 0.2,
      metalness: 0.0,
    }),
    // Mouth interior
    mouth: new THREE.MeshStandardMaterial({
      color: 0x2a0a0a,
      roughness: 0.95,
      metalness: 0.0,
    }),
    // Pants
    pants: new THREE.MeshStandardMaterial({
      color: 0x2a2a28,
      roughness: 0.9,
      metalness: 0.0,
    }),
    // Blood splatter
    blood: new THREE.MeshStandardMaterial({
      color: 0x660000,
      roughness: 0.7,
      metalness: 0.1,
    }),
    // Invisible hitbox material
    hitbox: new THREE.MeshBasicMaterial({
      visible: false,
      transparent: true,
      opacity: 0,
    }),
  };

  return _sharedMaterials;
}

// Shared geometries (created once, reused)
let _sharedGeometries = null;

function getSharedGeometries() {
  if (_sharedGeometries) return _sharedGeometries;

  _sharedGeometries = {
    // Body parts
    torso: new THREE.BoxGeometry(0.5, 0.6, 0.3),
    head: new THREE.SphereGeometry(0.16, 10, 8),
    eye: new THREE.SphereGeometry(0.025, 6, 4),
    jaw: new THREE.BoxGeometry(0.1, 0.04, 0.08),
    upperArm: new THREE.CylinderGeometry(0.06, 0.055, 0.35, 6),
    lowerArm: new THREE.CylinderGeometry(0.055, 0.045, 0.3, 6),
    hand: new THREE.BoxGeometry(0.07, 0.1, 0.05),
    upperLeg: new THREE.CylinderGeometry(0.08, 0.07, 0.4, 6),
    lowerLeg: new THREE.CylinderGeometry(0.07, 0.06, 0.4, 6),
    foot: new THREE.BoxGeometry(0.09, 0.06, 0.16),
    // Hitboxes
    headHitbox: new THREE.SphereGeometry(0.22, 8, 6),
    bodyHitbox: new THREE.BoxGeometry(0.6, 0.8, 0.4),
    // Blood splatter patch
    bloodPatch: new THREE.PlaneGeometry(0.1, 0.1),
  };

  return _sharedGeometries;
}

// Uniform color options for variation
const UNIFORM_COLORS = ['uniformGrey', 'uniformOlive', 'uniformBrown'];
const SKIN_COLORS = ['skin', 'skinAlt', 'skinPale'];

export class Zombie {
  /**
   * @param {THREE.Scene} scene - The Three.js scene
   * @param {number} id - Unique pool identifier
   */
  constructor(scene, id) {
    this.scene = scene;
    this.id = id;

    /** @type {boolean} Whether this zombie is currently alive and active */
    this.isAlive = false;
    /** @type {number} Current health points */
    this.health = 100;
    /** @type {number} Maximum health for current round */
    this.maxHealth = 100;
    /** @type {number} Movement speed in units/second */
    this.speed = 1.5;
    /** @type {number} Damage dealt per attack */
    this.damage = 30;
    /** @type {number} Seconds between attacks */
    this.attackCooldown = 1.0;
    /** @type {number} Timer tracking cooldown between attacks */
    this.attackTimer = 0;

    /**
     * Current AI state.
     * @type {'inactive'|'spawning'|'breaking'|'chasing'|'attacking'|'dying'|'dead'}
     */
    this.state = 'inactive';

    /** @type {object|null} Reference to the barricade this zombie targets */
    this.targetBarricade = null;
    /** @type {THREE.Group|null} Root mesh group */
    this.mesh = null;
    /** @type {THREE.Mesh|null} Body hitbox (invisible) */
    this.hitbox = null;
    /** @type {THREE.Mesh|null} Head hitbox (invisible) */
    this.headHitbox = null;

    // Internal body part references for animation
    /** @type {object} Named references to mesh parts for procedural animation */
    this._parts = {};

    // Animation state
    /** @type {number} Elapsed time accumulator for animation cycling */
    this._animTime = 0;
    /** @type {number} Timer for spawn rising animation */
    this._spawnTimer = 0;
    /** @type {number} Duration of spawn animation in seconds */
    this._spawnDuration = 2.0;
    /** @type {number} Timer for breaking animation cycle */
    this._breakTimer = 0;
    /** @type {number} Timer for death animation */
    this._deathTimer = 0;
    /** @type {boolean} Whether death was from a headshot */
    this._deathIsHeadshot = false;
    /** @type {number} Timer for fade-out after death */
    this._fadeTimer = 0;
    /** @type {number} Timer for attack swing animation */
    this._attackAnimTimer = 0;

    // Movement
    /** @type {THREE.Vector3} Current velocity vector */
    this._velocity = new THREE.Vector3();
    /** @type {THREE.Vector3} Target position the zombie is navigating toward */
    this._targetPosition = new THREE.Vector3();
    /** @type {boolean} Whether the zombie has entered the map through the window */
    this._hasEnteredMap = false;
    /** @type {THREE.Vector3|null} The position of the window/entry point */
    this._entryPoint = null;
    /** @type {number} Y-position of ground level */
    this._groundY = 0;

    // Variation state
    /** @type {boolean} Whether this zombie is missing its left arm */
    this._missingLeftArm = false;
    /** @type {boolean} Whether this zombie is missing its right arm */
    this._missingRightArm = false;
    /** @type {number} Current round number for scaling */
    this._round = 1;

    // Lurch mechanic
    /** @type {number} Timer until next random lurch */
    this._lurchTimer = 0;
    /** @type {number} Duration of current lurch burst */
    this._lurchDuration = 0;
    /** @type {boolean} Whether currently in a lurch/speed burst */
    this._isLurching = false;

    // Reusable vectors to avoid GC
    this._tempVec3 = new THREE.Vector3();
    this._tempVec3b = new THREE.Vector3();

    // Build the mesh once; reuse it each spawn with variations
    this._buildMesh();
  }

  // ---------------------------------------------------------------------------
  // MESH CONSTRUCTION
  // ---------------------------------------------------------------------------

  /**
   * Build the full procedural humanoid zombie mesh from Three.js primitives.
   * All parts are children of a root THREE.Group. The mesh starts invisible
   * and is only shown when spawn() is called.
   * @private
   */
  _buildMesh() {
    const mats = getSharedMaterials();
    const geo = getSharedGeometries();

    this.mesh = new THREE.Group();
    this.mesh.visible = false;

    // ---- Torso ----
    const torso = new THREE.Mesh(geo.torso, mats.uniformOlive);
    torso.position.set(0, 1.1, 0);
    torso.castShadow = true;
    this.mesh.add(torso);
    this._parts.torso = torso;

    // ---- Head ----
    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.58, 0);
    this.mesh.add(headGroup);
    this._parts.headGroup = headGroup;

    const head = new THREE.Mesh(geo.head, mats.skin);
    head.castShadow = true;
    headGroup.add(head);
    this._parts.head = head;

    // Eyes
    const leftEye = new THREE.Mesh(geo.eye, mats.eye);
    leftEye.position.set(-0.06, 0.03, 0.13);
    headGroup.add(leftEye);
    this._parts.leftEye = leftEye;

    const rightEye = new THREE.Mesh(geo.eye, mats.eye);
    rightEye.position.set(0.06, 0.03, 0.13);
    headGroup.add(rightEye);
    this._parts.rightEye = rightEye;

    // Jaw
    const jaw = new THREE.Mesh(geo.jaw, mats.skin);
    jaw.position.set(0, -0.12, 0.06);
    jaw.rotation.x = 0.2; // slightly open
    headGroup.add(jaw);
    this._parts.jaw = jaw;

    // Mouth interior (dark gap)
    const mouthInterior = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.02, 0.04),
      mats.mouth
    );
    mouthInterior.position.set(0, -0.09, 0.1);
    headGroup.add(mouthInterior);

    // ---- Left Arm ----
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.35, 1.25, 0);
    this.mesh.add(leftArmGroup);
    this._parts.leftArmGroup = leftArmGroup;

    const leftUpperArm = new THREE.Mesh(geo.upperArm, mats.uniformOlive);
    leftUpperArm.position.set(0, -0.17, 0);
    leftUpperArm.castShadow = true;
    leftArmGroup.add(leftUpperArm);
    this._parts.leftUpperArm = leftUpperArm;

    const leftLowerArm = new THREE.Mesh(geo.lowerArm, mats.skin);
    leftLowerArm.position.set(0, -0.5, 0.08);
    leftLowerArm.rotation.x = -0.4; // bent forward
    leftLowerArm.castShadow = true;
    leftArmGroup.add(leftLowerArm);
    this._parts.leftLowerArm = leftLowerArm;

    const leftHand = new THREE.Mesh(geo.hand, mats.skin);
    leftHand.position.set(0, -0.7, 0.2);
    leftArmGroup.add(leftHand);
    this._parts.leftHand = leftHand;

    // ---- Right Arm ----
    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.35, 1.25, 0);
    this.mesh.add(rightArmGroup);
    this._parts.rightArmGroup = rightArmGroup;

    const rightUpperArm = new THREE.Mesh(geo.upperArm, mats.uniformOlive);
    rightUpperArm.position.set(0, -0.17, 0);
    rightUpperArm.castShadow = true;
    rightArmGroup.add(rightUpperArm);
    this._parts.rightUpperArm = rightUpperArm;

    const rightLowerArm = new THREE.Mesh(geo.lowerArm, mats.skin);
    rightLowerArm.position.set(0, -0.5, 0.08);
    rightLowerArm.rotation.x = -0.4;
    rightLowerArm.castShadow = true;
    rightArmGroup.add(rightLowerArm);
    this._parts.rightLowerArm = rightLowerArm;

    const rightHand = new THREE.Mesh(geo.hand, mats.skin);
    rightHand.position.set(0, -0.7, 0.2);
    rightArmGroup.add(rightHand);
    this._parts.rightHand = rightHand;

    // ---- Left Leg ----
    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.13, 0.65, 0);
    this.mesh.add(leftLegGroup);
    this._parts.leftLegGroup = leftLegGroup;

    const leftUpperLeg = new THREE.Mesh(geo.upperLeg, mats.pants);
    leftUpperLeg.position.set(0, -0.1, 0);
    leftUpperLeg.castShadow = true;
    leftLegGroup.add(leftUpperLeg);
    this._parts.leftUpperLeg = leftUpperLeg;

    const leftLowerLeg = new THREE.Mesh(geo.lowerLeg, mats.pants);
    leftLowerLeg.position.set(0, -0.5, 0);
    leftLowerLeg.castShadow = true;
    leftLegGroup.add(leftLowerLeg);
    this._parts.leftLowerLeg = leftLowerLeg;

    const leftFoot = new THREE.Mesh(geo.foot, mats.uniformGrey);
    leftFoot.position.set(0, -0.73, 0.03);
    leftLegGroup.add(leftFoot);
    this._parts.leftFoot = leftFoot;

    // ---- Right Leg ----
    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.13, 0.65, 0);
    this.mesh.add(rightLegGroup);
    this._parts.rightLegGroup = rightLegGroup;

    const rightUpperLeg = new THREE.Mesh(geo.upperLeg, mats.pants);
    rightUpperLeg.position.set(0, -0.1, 0);
    rightUpperLeg.castShadow = true;
    rightLegGroup.add(rightUpperLeg);
    this._parts.rightUpperLeg = rightUpperLeg;

    const rightLowerLeg = new THREE.Mesh(geo.lowerLeg, mats.pants);
    rightLowerLeg.position.set(0, -0.5, 0);
    rightLowerLeg.castShadow = true;
    rightLegGroup.add(rightLowerLeg);
    this._parts.rightLowerLeg = rightLowerLeg;

    const rightFoot = new THREE.Mesh(geo.foot, mats.uniformGrey);
    rightFoot.position.set(0, -0.73, 0.03);
    rightLegGroup.add(rightFoot);
    this._parts.rightFoot = rightFoot;

    // ---- Hitboxes (invisible) ----
    this.headHitbox = new THREE.Mesh(geo.headHitbox, mats.hitbox);
    this.headHitbox.position.set(0, 1.58, 0);
    this.headHitbox.userData.zombieId = this.id;
    this.headHitbox.userData.isHead = true;
    this.mesh.add(this.headHitbox);

    this.hitbox = new THREE.Mesh(geo.bodyHitbox, mats.hitbox);
    this.hitbox.position.set(0, 1.1, 0);
    this.hitbox.userData.zombieId = this.id;
    this.hitbox.userData.isHead = false;
    this.mesh.add(this.hitbox);

    // Store blood splatter meshes that get toggled on spawn for variation
    this._bloodPatches = [];
  }

  // ---------------------------------------------------------------------------
  // VISUAL VARIATIONS
  // ---------------------------------------------------------------------------

  /**
   * Apply random visual variations to the zombie each time it spawns.
   * Varies body proportions, uniform color, skin color, missing limbs,
   * head shape, and blood splatters.
   * @private
   */
  _applyVariations() {
    const mats = getSharedMaterials();

    // Random uniform color
    const uniformKey = UNIFORM_COLORS[Math.floor(Math.random() * UNIFORM_COLORS.length)];
    const uniformMat = mats[uniformKey];
    this._parts.torso.material = uniformMat;
    this._parts.leftUpperArm.material = uniformMat;
    this._parts.rightUpperArm.material = uniformMat;

    // Random skin color
    const skinKey = SKIN_COLORS[Math.floor(Math.random() * SKIN_COLORS.length)];
    const skinMat = mats[skinKey];
    this._parts.head.material = skinMat;
    this._parts.leftLowerArm.material = skinMat;
    this._parts.rightLowerArm.material = skinMat;
    this._parts.leftHand.material = skinMat;
    this._parts.rightHand.material = skinMat;
    this._parts.jaw.material = skinMat;

    // Body proportion variation (+/- 10%)
    const scaleVar = () => 0.9 + Math.random() * 0.2;
    const bodyScale = scaleVar();
    this._parts.torso.scale.set(scaleVar(), bodyScale, scaleVar());

    // Head shape variation (independent axis scaling)
    const headGroup = this._parts.headGroup;
    headGroup.scale.set(
      0.9 + Math.random() * 0.2,
      0.9 + Math.random() * 0.2,
      0.9 + Math.random() * 0.2
    );

    // Arm proportions
    const armScale = scaleVar();
    this._parts.leftArmGroup.scale.set(armScale, scaleVar(), armScale);
    this._parts.rightArmGroup.scale.set(armScale, scaleVar(), armScale);

    // Leg proportions
    this._parts.leftLegGroup.scale.set(scaleVar(), scaleVar(), scaleVar());
    this._parts.rightLegGroup.scale.set(scaleVar(), scaleVar(), scaleVar());

    // Missing arm chance (15% chance for each)
    this._missingLeftArm = Math.random() < 0.15;
    this._missingRightArm = Math.random() < 0.15;
    // Never remove both arms
    if (this._missingLeftArm && this._missingRightArm) {
      this._missingLeftArm = false;
    }
    this._parts.leftArmGroup.visible = !this._missingLeftArm;
    this._parts.rightArmGroup.visible = !this._missingRightArm;

    // Remove old blood patches
    for (const patch of this._bloodPatches) {
      patch.parent.remove(patch);
    }
    this._bloodPatches = [];

    // Add random blood patches (0-4 patches)
    const geo = getSharedGeometries();
    const bloodCount = Math.floor(Math.random() * 5);
    const attachTargets = [
      this._parts.torso,
      this._parts.head,
      this._parts.leftUpperArm,
      this._parts.rightUpperArm,
      this._parts.leftUpperLeg,
      this._parts.rightUpperLeg,
    ];

    for (let i = 0; i < bloodCount; i++) {
      const target = attachTargets[Math.floor(Math.random() * attachTargets.length)];
      const patch = new THREE.Mesh(geo.bloodPatch, mats.blood);
      patch.position.set(
        (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.15,
        0.16
      );
      patch.rotation.z = Math.random() * Math.PI * 2;
      const patchScale = 0.5 + Math.random() * 1.5;
      patch.scale.set(patchScale, patchScale, 1);
      target.add(patch);
      this._bloodPatches.push(patch);
    }
  }

  // ---------------------------------------------------------------------------
  // SPAWN / RESET
  // ---------------------------------------------------------------------------

  /**
   * Activate this zombie from the pool: set stats for the current round,
   * place at spawn position, apply visual variations, and begin the spawn
   * animation (rising from ground).
   *
   * @param {THREE.Vector3|{x:number,y:number,z:number}} position - Spawn position
   * @param {object|null} barricade - The barricade/window this zombie will break through
   * @param {number} round - Current round number (affects health/speed)
   */
  spawn(position, barricade, round) {
    this._round = round;
    this.isAlive = true;
    this.maxHealth = Math.min(100 + round * 50, 1000);
    this.health = this.maxHealth;
    this.speed = Math.min(1.5 + round * 0.2, 4.0);
    this.damage = 30 + Math.floor(round / 3) * 10;
    this.attackTimer = 0;
    this.targetBarricade = barricade;
    this.state = 'spawning';
    this._hasEnteredMap = false;
    this._groundY = 0;

    // Animation resets
    this._animTime = 0;
    this._spawnTimer = 0;
    this._breakTimer = 0;
    this._deathTimer = 0;
    this._fadeTimer = 0;
    this._attackAnimTimer = 0;
    this._deathIsHeadshot = false;
    this._lurchTimer = 3 + Math.random() * 5;
    this._lurchDuration = 0;
    this._isLurching = false;

    // Reset mesh transforms
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.scale.set(1, 1, 1);
    this.mesh.visible = true;

    // Reset all part rotations/positions to default
    this._resetPartTransforms();

    // Store entry point (barricade interior side) for navigation after breaking
    if (barricade && barricade.entryPoint) {
      this._entryPoint = new THREE.Vector3(
        barricade.entryPoint.x,
        barricade.entryPoint.y || 0,
        barricade.entryPoint.z
      );
    } else if (barricade && barricade.position) {
      // Default: entry is slightly inside from barricade position
      const dir = new THREE.Vector3(0, 0, 1); // fallback direction
      this._entryPoint = new THREE.Vector3(
        barricade.position.x + dir.x * 1.5,
        0,
        barricade.position.z + dir.z * 1.5
      );
    } else {
      this._entryPoint = new THREE.Vector3(position.x, 0, position.z);
    }

    // Apply random visual variation
    this._applyVariations();

    // Start below ground for rising animation
    this.mesh.position.y = position.y - 1.8;

    // Reset opacity for all parts (in case previous death faded them)
    this.mesh.traverse((child) => {
      if (child.isMesh && child.material && child.material.opacity !== undefined) {
        if (child.material !== getSharedMaterials().hitbox) {
          child.material.transparent = false;
          child.material.opacity = 1.0;
        }
      }
    });

    // Add to scene if not already
    if (!this.mesh.parent) {
      this.scene.add(this.mesh);
    }
  }

  /**
   * Reset part transforms back to their default T-pose / reaching pose.
   * @private
   */
  _resetPartTransforms() {
    const p = this._parts;

    // Torso
    p.torso.position.set(0, 1.1, 0);
    p.torso.rotation.set(0, 0, 0);

    // Head
    p.headGroup.position.set(0, 1.58, 0);
    p.headGroup.rotation.set(0, 0, 0);

    // Arms
    p.leftArmGroup.position.set(-0.35, 1.25, 0);
    p.leftArmGroup.rotation.set(0, 0, 0);
    p.rightArmGroup.position.set(0.35, 1.25, 0);
    p.rightArmGroup.rotation.set(0, 0, 0);

    // Reset lower arm bend
    p.leftLowerArm.rotation.set(-0.4, 0, 0);
    p.rightLowerArm.rotation.set(-0.4, 0, 0);

    // Legs
    p.leftLegGroup.position.set(-0.13, 0.65, 0);
    p.leftLegGroup.rotation.set(0, 0, 0);
    p.rightLegGroup.position.set(0.13, 0.65, 0);
    p.rightLegGroup.rotation.set(0, 0, 0);

    // Jaw
    p.jaw.rotation.set(0.2, 0, 0);

    // Hitboxes
    this.headHitbox.position.set(0, 1.58, 0);
    this.hitbox.position.set(0, 1.1, 0);
  }

  /**
   * Fully reset the zombie to inactive pool state. Removes mesh from scene.
   */
  reset() {
    this.isAlive = false;
    this.state = 'inactive';
    this.health = 0;
    this.targetBarricade = null;
    this._hasEnteredMap = false;
    this._entryPoint = null;
    this._animTime = 0;

    if (this.mesh) {
      this.mesh.visible = false;
      if (this.mesh.parent) {
        this.scene.remove(this.mesh);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CORE UPDATE - STATE MACHINE
  // ---------------------------------------------------------------------------

  /**
   * Main update tick. Drives the AI state machine, animation, and movement.
   *
   * @param {number} deltaTime - Seconds since last frame
   * @param {THREE.Vector3|{x:number,y:number,z:number}} playerPosition - Current player position
   * @param {Array<{position:{x:number,y:number,z:number}}>} [navPoints] - Navigation waypoints
   * @param {Zombie[]} [otherZombies] - Other active zombies for separation
   */
  update(deltaTime, playerPosition, navPoints, otherZombies) {
    if (!this.isAlive && this.state !== 'dying' && this.state !== 'dead') return;

    this._animTime += deltaTime;

    switch (this.state) {
      case 'spawning':
        this._updateSpawning(deltaTime);
        break;
      case 'breaking':
        this._updateBreaking(deltaTime);
        break;
      case 'chasing':
        this._updateChasing(deltaTime, playerPosition, navPoints, otherZombies);
        break;
      case 'attacking':
        this._updateAttacking(deltaTime, playerPosition);
        break;
      case 'dying':
        this._updateDying(deltaTime);
        break;
      case 'dead':
        this._updateDead(deltaTime);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // STATE: SPAWNING - Rise from ground
  // ---------------------------------------------------------------------------

  /**
   * Update the spawning state: zombie rises from below ground over _spawnDuration seconds.
   * @param {number} dt - Delta time
   * @private
   */
  _updateSpawning(dt) {
    this._spawnTimer += dt;
    const progress = Math.min(this._spawnTimer / this._spawnDuration, 1.0);

    // Ease-out rise
    const eased = 1 - Math.pow(1 - progress, 2);

    // Rise from -1.8 below ground to ground level (0)
    this.mesh.position.y = this._groundY - 1.8 + eased * 1.8;

    // Animate the spawn (arms raised, dramatic emergence)
    this._animateSpawn(dt, progress);

    if (progress >= 1.0) {
      this.mesh.position.y = this._groundY;

      // Transition: if we have a barricade, go to breaking; otherwise chase
      if (this.targetBarricade) {
        this.state = 'breaking';
        this._breakTimer = 0;
      } else {
        this.state = 'chasing';
        this._hasEnteredMap = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // STATE: BREAKING - Tear down barricade boards
  // ---------------------------------------------------------------------------

  /**
   * Update the breaking state: zombie tears boards off the barricade.
   * Removes one board every 1.5 seconds, then climbs through.
   * @param {number} dt - Delta time
   * @private
   */
  _updateBreaking(dt) {
    this._breakTimer += dt;

    // Animate arm-slamming motion
    this._animateBreaking(dt);

    // Face the barricade
    if (this.targetBarricade && this.targetBarricade.position) {
      this._facePosition(this.targetBarricade.position);
    }

    // Every 1.5 seconds, remove a board
    if (this._breakTimer >= 1.5) {
      this._breakTimer -= 1.5;

      if (this.targetBarricade && typeof this.targetBarricade.removeBoard === 'function') {
        const boardsRemaining = this.targetBarricade.removeBoard();

        // If all boards removed, climb through
        if (boardsRemaining <= 0) {
          this._beginClimbThrough();
          return;
        }
      } else {
        // No barricade interface, just proceed after a few swings
        this._beginClimbThrough();
        return;
      }
    }
  }

  /**
   * Begin the transition from breaking to chasing: move through the window opening.
   * @private
   */
  _beginClimbThrough() {
    this._hasEnteredMap = true;

    // Move to entry point (inside the map)
    if (this._entryPoint) {
      this.mesh.position.set(
        this._entryPoint.x,
        this._groundY,
        this._entryPoint.z
      );
    }

    this.state = 'chasing';
  }

  // ---------------------------------------------------------------------------
  // STATE: CHASING - Pathfind toward player
  // ---------------------------------------------------------------------------

  /**
   * Update chasing state: navigate toward the player using simple steering
   * with obstacle avoidance via navPoints and zombie separation.
   *
   * @param {number} dt - Delta time
   * @param {{x:number,y:number,z:number}} playerPos - Player position
   * @param {Array} navPoints - Optional navigation waypoints
   * @param {Zombie[]} otherZombies - For separation steering
   * @private
   */
  _updateChasing(dt, playerPos, navPoints, otherZombies) {
    if (!playerPos) return;

    const myPos = this.mesh.position;

    // Determine effective target - either a nav point or the player directly
    let targetPos = this._tempVec3.set(playerPos.x, this._groundY, playerPos.z);

    // If navPoints exist, find the best intermediate waypoint
    if (navPoints && navPoints.length > 0) {
      targetPos = this._getNavTarget(playerPos, navPoints);
    }

    // Direction toward target
    const dx = targetPos.x - myPos.x;
    const dz = targetPos.z - myPos.z;
    const distToTarget = Math.sqrt(dx * dx + dz * dz);

    // Check if close enough to attack
    const distToPlayer = this._distanceToHorizontal(playerPos);
    if (distToPlayer < 2.0) {
      this.state = 'attacking';
      this.attackTimer = 0;
      this._attackAnimTimer = 0;
      return;
    }

    // Compute desired movement direction
    let dirX = 0;
    let dirZ = 0;
    if (distToTarget > 0.1) {
      dirX = dx / distToTarget;
      dirZ = dz / distToTarget;
    }

    // Separation force from other zombies
    let sepX = 0;
    let sepZ = 0;
    if (otherZombies) {
      const separationRadius = 1.2;
      for (const other of otherZombies) {
        if (other === this || !other.isAlive) continue;
        const otherPos = other.mesh.position;
        const ox = myPos.x - otherPos.x;
        const oz = myPos.z - otherPos.z;
        const oDist = Math.sqrt(ox * ox + oz * oz);
        if (oDist < separationRadius && oDist > 0.01) {
          const force = (separationRadius - oDist) / separationRadius;
          sepX += (ox / oDist) * force;
          sepZ += (oz / oDist) * force;
        }
      }
    }

    // Combine steering
    const sepWeight = 0.6;
    let moveX = dirX + sepX * sepWeight;
    let moveZ = dirZ + sepZ * sepWeight;

    // Normalize
    const moveLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
    if (moveLen > 0.01) {
      moveX /= moveLen;
      moveZ /= moveLen;
    }

    // Lurch mechanic - occasional speed bursts
    this._updateLurch(dt);
    const currentSpeed = this._isLurching ? this.speed * 1.8 : this.speed;

    // Apply movement
    myPos.x += moveX * currentSpeed * dt;
    myPos.z += moveZ * currentSpeed * dt;
    myPos.y = this._groundY; // Keep on ground

    // Face movement direction
    if (moveLen > 0.01) {
      this.mesh.rotation.y = Math.atan2(moveX, moveZ);
    }

    // Procedural walk animation
    this._animateWalk(dt);
  }

  /**
   * Find the best navigation waypoint to steer toward on the way to the player.
   * Uses a simple closest-to-player navpoint that is closer to the player than we are.
   *
   * @param {{x:number,y:number,z:number}} playerPos
   * @param {Array<{position:{x:number,y:number,z:number}}>} navPoints
   * @returns {THREE.Vector3}
   * @private
   */
  _getNavTarget(playerPos, navPoints) {
    const myPos = this.mesh.position;
    const myDistToPlayer = this._distanceToHorizontal(playerPos);

    // Direct line of sight heuristic: if close enough, go directly
    if (myDistToPlayer < 6.0) {
      return this._tempVec3.set(playerPos.x, this._groundY, playerPos.z);
    }

    // Find the nav point closest to the player that is also closer to us than the player
    let bestPoint = null;
    let bestScore = Infinity;

    for (const np of navPoints) {
      const npPos = np.position || np;
      const npToPlayer = Math.sqrt(
        (npPos.x - playerPos.x) ** 2 + (npPos.z - playerPos.z) ** 2
      );
      const meToNp = Math.sqrt(
        (npPos.x - myPos.x) ** 2 + (npPos.z - myPos.z) ** 2
      );

      // Score: distance from us to navpoint + distance from navpoint to player
      const score = meToNp + npToPlayer;

      // Only consider nav points that bring us closer
      if (npToPlayer < myDistToPlayer && score < bestScore) {
        bestScore = score;
        bestPoint = npPos;
      }
    }

    if (bestPoint) {
      return this._tempVec3.set(bestPoint.x, this._groundY, bestPoint.z);
    }

    // Fallback: go directly toward player
    return this._tempVec3.set(playerPos.x, this._groundY, playerPos.z);
  }

  /**
   * Update lurch timer - random bursts of speed.
   * @param {number} dt
   * @private
   */
  _updateLurch(dt) {
    if (this._isLurching) {
      this._lurchDuration -= dt;
      if (this._lurchDuration <= 0) {
        this._isLurching = false;
        this._lurchTimer = 3 + Math.random() * 7;
      }
    } else {
      this._lurchTimer -= dt;
      if (this._lurchTimer <= 0) {
        this._isLurching = true;
        this._lurchDuration = 0.5 + Math.random() * 1.0;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // STATE: ATTACKING
  // ---------------------------------------------------------------------------

  /**
   * Update attacking state: swipe at player when in range, return to chasing
   * if player moves away.
   *
   * @param {number} dt - Delta time
   * @param {{x:number,y:number,z:number}} playerPos - Player position
   * @private
   */
  _updateAttacking(dt, playerPos) {
    if (!playerPos) {
      this.state = 'chasing';
      return;
    }

    const dist = this._distanceToHorizontal(playerPos);

    // If player moved out of attack range, chase
    if (dist > 2.5) {
      this.state = 'chasing';
      this._resetPartTransforms();
      return;
    }

    // Face player
    this._facePosition(playerPos);

    // Attack cooldown
    this.attackTimer += dt;
    this._attackAnimTimer += dt;

    // Animate the attack swing
    this._animateAttack(dt);

    // Check if attack lands (at peak of swing animation)
    if (this.attackTimer >= this.attackCooldown) {
      this.attackTimer = 0;
      this._attackAnimTimer = 0;
      return { damage: this.damage, zombieId: this.id };
    }

    return null;
  }

  /**
   * Deal damage to the player. Called externally by the game loop when
   * the zombie's attack state produces a hit.
   *
   * @param {object} player - Player object with a takeDamage(amount) method
   * @returns {number} Damage dealt
   */
  attack(player) {
    if (player && typeof player.takeDamage === 'function') {
      player.takeDamage(this.damage);
    }
    return this.damage;
  }

  // ---------------------------------------------------------------------------
  // STATE: DYING & DEAD
  // ---------------------------------------------------------------------------

  /**
   * Trigger death sequence.
   * @param {boolean} isHeadshot - Whether the killing blow was a headshot
   */
  die(isHeadshot) {
    if (this.state === 'dying' || this.state === 'dead') return;

    this.state = 'dying';
    this.isAlive = false;
    this._deathTimer = 0;
    this._fadeTimer = 0;
    this._deathIsHeadshot = isHeadshot;
  }

  /**
   * Update dying state: play death animation over 0.5 seconds.
   * @param {number} dt
   * @private
   */
  _updateDying(dt) {
    this._deathTimer += dt;
    const duration = 0.5;
    const progress = Math.min(this._deathTimer / duration, 1.0);

    this._animateDeath(dt, progress, this._deathIsHeadshot);

    if (progress >= 1.0) {
      this.state = 'dead';
      this._fadeTimer = 0;
    }
  }

  /**
   * Update dead state: remain on ground for 3 seconds, then fade out.
   * @param {number} dt
   * @private
   */
  _updateDead(dt) {
    this._fadeTimer += dt;

    // Lie on ground for 3 seconds
    if (this._fadeTimer > 3.0) {
      // Fade out over 1 second
      const fadeProgress = Math.min((this._fadeTimer - 3.0) / 1.0, 1.0);
      const opacity = 1.0 - fadeProgress;

      this.mesh.traverse((child) => {
        if (child.isMesh && child.material) {
          // Clone shared material on first fade to avoid affecting other zombies
          if (!child.material._isCloned) {
            child.material = child.material.clone();
            child.material._isCloned = true;
          }
          child.material.transparent = true;
          child.material.opacity = opacity;
        }
      });

      if (fadeProgress >= 1.0) {
        // Fully faded - ready to return to pool
        this.reset();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // DAMAGE
  // ---------------------------------------------------------------------------

  /**
   * Apply damage to this zombie. Headshots deal double damage.
   * Creates a blood splatter effect at the hit point.
   *
   * @param {number} amount - Base damage amount
   * @param {THREE.Vector3|{x:number,y:number,z:number}} hitPoint - World position of hit
   * @param {boolean} isHeadshot - Whether the hit was on the head hitbox
   * @returns {boolean} True if the zombie died from this damage
   */
  takeDamage(amount, hitPoint, isHeadshot) {
    if (!this.isAlive) return false;

    const actualDamage = isHeadshot ? amount * 2 : amount;
    this.health -= actualDamage;

    // Blood splatter VFX at hit point
    this._spawnBloodEffect(hitPoint);

    if (this.health <= 0) {
      this.health = 0;
      this.die(isHeadshot);
      return true;
    }

    return false;
  }

  /**
   * Spawn a small particle-like blood effect at the hit location.
   * Uses a few small red planes that expand and fade.
   * @param {{x:number,y:number,z:number}} hitPoint
   * @private
   */
  _spawnBloodEffect(hitPoint) {
    if (!hitPoint) return;

    const mats = getSharedMaterials();

    for (let i = 0; i < 4; i++) {
      const size = 0.05 + Math.random() * 0.1;
      const geo = new THREE.PlaneGeometry(size, size);
      const mat = mats.blood.clone();
      mat.transparent = true;
      mat.opacity = 0.9;
      mat.side = THREE.DoubleSide;

      const particle = new THREE.Mesh(geo, mat);
      particle.position.set(
        hitPoint.x + (Math.random() - 0.5) * 0.3,
        hitPoint.y + (Math.random() - 0.5) * 0.3,
        hitPoint.z + (Math.random() - 0.5) * 0.3
      );
      particle.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );

      this.scene.add(particle);

      // Self-removing particle: expand and fade over 0.4 seconds
      const startTime = performance.now();
      const duration = 400;
      const scene = this.scene;

      const animateParticle = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1.0);

        particle.scale.setScalar(1 + t * 2);
        mat.opacity = 0.9 * (1 - t);

        if (t < 1.0) {
          requestAnimationFrame(animateParticle);
        } else {
          scene.remove(particle);
          geo.dispose();
          mat.dispose();
        }
      };
      requestAnimationFrame(animateParticle);
    }
  }

  // ---------------------------------------------------------------------------
  // PROCEDURAL ANIMATIONS
  // ---------------------------------------------------------------------------

  /**
   * Spawn rising animation: arms rise up, body emerges from ground.
   * @param {number} dt
   * @param {number} progress - 0..1 completion
   * @private
   */
  _animateSpawn(dt, progress) {
    const p = this._parts;

    // Arms reach up during emergence
    const armRaise = Math.sin(progress * Math.PI) * 0.8;
    if (p.leftArmGroup.visible) {
      p.leftArmGroup.rotation.x = -armRaise;
    }
    if (p.rightArmGroup.visible) {
      p.rightArmGroup.rotation.x = -armRaise;
    }

    // Head tilts up as if looking to the sky
    p.headGroup.rotation.x = -0.3 * (1 - progress);

    // Jaw opens during spawn scream
    p.jaw.rotation.x = 0.2 + Math.sin(progress * Math.PI) * 0.4;
  }

  /**
   * Walking/shambling animation: sinusoidal bob, arm sway, leg movement, lean.
   * @param {number} dt
   * @private
   */
  _animateWalk(dt) {
    const t = this._animTime;
    const p = this._parts;
    const walkFreq = this._isLurching ? 10.0 : 6.0;

    // Body vertical bob
    const bob = Math.sin(t * walkFreq) * 0.04;
    p.torso.position.y = 1.1 + bob;
    p.headGroup.position.y = 1.58 + bob;

    // Forward lean
    p.torso.rotation.x = 0.12;

    // Head slight sway
    p.headGroup.rotation.z = Math.sin(t * walkFreq * 0.5) * 0.05;
    p.headGroup.rotation.x = 0.08; // slight downward tilt

    // Arm swing (opposite to legs for natural walk)
    const armSwing = Math.sin(t * walkFreq) * 0.4;
    if (p.leftArmGroup.visible) {
      p.leftArmGroup.rotation.x = -0.5 + armSwing; // reaching forward base
      p.leftArmGroup.rotation.z = -0.1;
    }
    if (p.rightArmGroup.visible) {
      p.rightArmGroup.rotation.x = -0.5 - armSwing;
      p.rightArmGroup.rotation.z = 0.1;
    }

    // Leg swing
    const legSwing = Math.sin(t * walkFreq) * 0.35;
    p.leftLegGroup.rotation.x = legSwing;
    p.rightLegGroup.rotation.x = -legSwing;

    // Knee bend on back leg
    if (legSwing > 0) {
      p.leftLowerLeg.rotation.x = 0;
      p.rightLowerLeg.rotation.x = -Math.abs(legSwing) * 0.5;
    } else {
      p.leftLowerLeg.rotation.x = -Math.abs(legSwing) * 0.5;
      p.rightLowerLeg.rotation.x = 0;
    }

    // Jaw chattering
    p.jaw.rotation.x = 0.2 + Math.abs(Math.sin(t * 8)) * 0.1;

    // Update hitbox positions to follow animated parts
    this.headHitbox.position.y = p.headGroup.position.y;
    this.hitbox.position.y = p.torso.position.y;
  }

  /**
   * Attack swipe animation: arm swings forward forcefully.
   * @param {number} dt
   * @private
   */
  _animateAttack(dt) {
    const t = this._attackAnimTimer;
    const p = this._parts;
    const swingDuration = this.attackCooldown;
    const progress = (t % swingDuration) / swingDuration;

    // Wind up (0-0.3), strike (0.3-0.5), return (0.5-1.0)
    let armAngle;
    if (progress < 0.3) {
      // Wind up - pull arm back
      armAngle = -0.5 + (progress / 0.3) * 1.2;
    } else if (progress < 0.5) {
      // Strike - swing forward fast
      const strikeProgress = (progress - 0.3) / 0.2;
      armAngle = 0.7 - strikeProgress * 2.2;
    } else {
      // Return to ready position
      const returnProgress = (progress - 0.5) / 0.5;
      armAngle = -1.5 + returnProgress * 1.0;
    }

    // Apply to whichever arm is visible (prefer right)
    if (p.rightArmGroup.visible) {
      p.rightArmGroup.rotation.x = armAngle;
      p.rightArmGroup.rotation.z = 0.2;
    }
    if (p.leftArmGroup.visible) {
      p.leftArmGroup.rotation.x = armAngle * 0.7; // secondary arm follows
      p.leftArmGroup.rotation.z = -0.2;
    }

    // Lean forward during strike
    if (progress > 0.25 && progress < 0.55) {
      p.torso.rotation.x = 0.3;
    } else {
      p.torso.rotation.x = 0.1;
    }

    // Open jaw during attack
    p.jaw.rotation.x = 0.2 + Math.sin(progress * Math.PI * 2) * 0.3;
  }

  /**
   * Barricade breaking animation: repeated overhead arm slams.
   * @param {number} dt
   * @private
   */
  _animateBreaking(dt) {
    const t = this._animTime;
    const p = this._parts;

    // Slam cycle: ~1.5 seconds per slam matching board removal rate
    const slamProgress = (t % 1.5) / 1.5;

    let armAngle;
    if (slamProgress < 0.4) {
      // Raise arms up
      armAngle = -slamProgress / 0.4 * 2.5;
    } else if (slamProgress < 0.6) {
      // Slam down fast
      const slamPhase = (slamProgress - 0.4) / 0.2;
      armAngle = -2.5 + slamPhase * 3.5;
    } else {
      // Hold/return
      const returnPhase = (slamProgress - 0.6) / 0.4;
      armAngle = 1.0 - returnPhase * 1.0;
    }

    if (p.leftArmGroup.visible) {
      p.leftArmGroup.rotation.x = armAngle;
    }
    if (p.rightArmGroup.visible) {
      p.rightArmGroup.rotation.x = armAngle;
    }

    // Body rocks with the slam
    p.torso.rotation.x = slamProgress < 0.6 ? -0.1 : 0.2;

    // Jaw open during slam
    p.jaw.rotation.x = 0.2 + (slamProgress < 0.6 ? 0.3 : 0.1);
  }

  /**
   * Death animation: ragdoll-like fall. Headshot variant detaches/flings head.
   * @param {number} dt
   * @param {number} progress - 0..1 completion of the fall
   * @param {boolean} isHeadshot
   * @private
   */
  _animateDeath(dt, progress, isHeadshot) {
    const p = this._parts;

    if (isHeadshot) {
      // Head flies off - move head group up and away
      const headFly = progress * 3.0;
      p.headGroup.position.y = 1.58 + headFly;
      p.headGroup.position.x = (Math.random() > 0.5 ? 1 : -1) * headFly * 0.5;
      p.headGroup.rotation.x = progress * Math.PI * 3;
      p.headGroup.rotation.z = progress * Math.PI * 2;

      // Body crumples straight down
      this.mesh.position.y = this._groundY - progress * 0.9;

      // Arms go limp
      if (p.leftArmGroup.visible) {
        p.leftArmGroup.rotation.x = progress * 0.5;
        p.leftArmGroup.rotation.z = -progress * 0.8;
      }
      if (p.rightArmGroup.visible) {
        p.rightArmGroup.rotation.x = progress * 0.5;
        p.rightArmGroup.rotation.z = progress * 0.8;
      }

      // Legs buckle
      p.leftLegGroup.rotation.x = -progress * 0.6;
      p.rightLegGroup.rotation.x = progress * 0.3;
    } else {
      // Body shot: stumble backward and fall

      // Lean backward
      this.mesh.rotation.x = progress * (-Math.PI / 2.5);

      // Drop down
      this.mesh.position.y = this._groundY - progress * 0.85;

      // Stumble backward slightly
      const backDir = -Math.sin(this.mesh.rotation.y);
      const backDirZ = -Math.cos(this.mesh.rotation.y);
      this.mesh.position.x += backDir * dt * 1.5 * (1 - progress);
      this.mesh.position.z += backDirZ * dt * 1.5 * (1 - progress);

      // Arms fling out
      if (p.leftArmGroup.visible) {
        p.leftArmGroup.rotation.x = -progress * 1.2;
        p.leftArmGroup.rotation.z = -progress * 1.0;
      }
      if (p.rightArmGroup.visible) {
        p.rightArmGroup.rotation.x = -progress * 1.2;
        p.rightArmGroup.rotation.z = progress * 1.0;
      }

      // Head snaps back
      p.headGroup.rotation.x = -progress * 0.8;

      // Legs buckle forward
      p.leftLegGroup.rotation.x = progress * 0.5;
      p.rightLegGroup.rotation.x = progress * 0.4;
    }
  }

  // ---------------------------------------------------------------------------
  // UTILITY
  // ---------------------------------------------------------------------------

  /**
   * Rotate the mesh to face a world position (Y-axis rotation only).
   * @param {{x:number, y:number, z:number}} pos
   * @private
   */
  _facePosition(pos) {
    const dx = pos.x - this.mesh.position.x;
    const dz = pos.z - this.mesh.position.z;
    this.mesh.rotation.y = Math.atan2(dx, dz);
  }

  /**
   * Horizontal distance (XZ plane) from this zombie's position to a target.
   * @param {{x:number, y:number, z:number}} pos
   * @returns {number}
   * @private
   */
  _distanceToHorizontal(pos) {
    const dx = pos.x - this.mesh.position.x;
    const dz = pos.z - this.mesh.position.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * Get the current world position of this zombie.
   * @returns {THREE.Vector3}
   */
  getPosition() {
    if (this.mesh) {
      return this.mesh.position.clone();
    }
    return new THREE.Vector3();
  }

  /**
   * Calculate distance from this zombie to a given position.
   * @param {{x:number,y:number,z:number}} position
   * @returns {number}
   */
  distanceTo(position) {
    if (!this.mesh) return Infinity;
    return this.mesh.position.distanceTo(
      this._tempVec3b.set(position.x, position.y, position.z)
    );
  }

  /**
   * Get the bounding box of the zombie for broad collision tests.
   * @returns {THREE.Box3}
   */
  getBoundingBox() {
    if (!this.mesh) return new THREE.Box3();
    const box = new THREE.Box3();
    box.setFromCenterAndSize(
      this.mesh.position,
      this._tempVec3b.set(0.6, 1.8, 0.4)
    );
    return box;
  }
}
