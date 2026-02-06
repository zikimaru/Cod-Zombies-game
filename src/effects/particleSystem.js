import * as THREE from 'three';

/**
 * ParticleSystem - GPU-accelerated particle effects for a CoD Zombies game.
 *
 * Uses a single THREE.Points mesh with a shared BufferGeometry holding up to
 * MAX_PARTICLES entries.  Per-particle state is tracked in a parallel JS array
 * and flushed to the GPU buffers every frame in `update()`.
 */

const MAX_PARTICLES = 2000;

// Scratch vectors reused across spawn helpers to avoid per-call allocations.
const _tmpVec = new THREE.Vector3();
const _perpA  = new THREE.Vector3();
const _perpB  = new THREE.Vector3();

export class ParticleSystem {
  /**
   * @param {THREE.Scene} scene - The scene to add the particle mesh to.
   */
  constructor(scene) {
    this.scene = scene;

    // ---- Internal particle state (parallel to buffer indices) ----
    /** @type {Array<{active:boolean, position:THREE.Vector3, velocity:THREE.Vector3, color:THREE.Color, size:number, life:number, maxLife:number, gravity:number, fadeRate:number}>} */
    this.particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        color: new THREE.Color(),
        size: 0,
        life: 0,
        maxLife: 0,
        gravity: 0,
        fadeRate: 1,
      });
    }

    // ---- BufferGeometry with interleaved attributes ----
    this.geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colors    = new Float32Array(MAX_PARTICLES * 3);
    const sizes     = new Float32Array(MAX_PARTICLES);
    const opacities = new Float32Array(MAX_PARTICLES);

    this.positionAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr    = new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr     = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
    this.opacityAttr  = new THREE.BufferAttribute(opacities, 1).setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('color', this.colorAttr);
    this.geometry.setAttribute('aSize', this.sizeAttr);
    this.geometry.setAttribute('aOpacity', this.opacityAttr);

    // ---- ShaderMaterial for per-particle size & opacity with additive blending ----
    this.material = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aOpacity;
        varying vec3  vColor;
        varying float vOpacity;
        void main() {
          vColor   = color;
          vOpacity = aOpacity;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (300.0 / -mvPosition.z);
          gl_Position  = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3  vColor;
        varying float vOpacity;
        void main() {
          // Soft circular particle
          float dist = length(gl_PointCoord - vec2(0.5));
          if (dist > 0.5) discard;
          float alpha = smoothstep(0.5, 0.15, dist) * vOpacity;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    // ---- Points mesh ----
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false; // particles span the entire level
    this.scene.add(this.points);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Find the next inactive slot (or the oldest particle if pool is full).
   * @returns {number} Index into the particles array.
   * @private
   */
  _allocate() {
    // First pass: grab an inactive slot
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.particles[i].active) return i;
    }
    // Pool exhausted -- recycle the particle with the least remaining life
    let minLife = Infinity;
    let minIdx = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.particles[i].life < minLife) {
        minLife = this.particles[i].life;
        minIdx = i;
      }
    }
    return minIdx;
  }

  /**
   * Activate a particle with the given properties.
   * @private
   */
  _emit(position, velocity, color, size, life, gravity, fadeRate) {
    const idx = this._allocate();
    const p = this.particles[idx];
    p.active = true;
    p.position.copy(position);
    p.velocity.copy(velocity);
    p.color.copy(color);
    p.size = size;
    p.life = life;
    p.maxLife = life;
    p.gravity = gravity;
    p.fadeRate = fadeRate;
    return idx;
  }

  /**
   * Build an orthonormal basis around a direction so we can scatter particles
   * in a hemisphere. Returns nothing; writes into _perpA and _perpB.
   * @private
   */
  _buildBasis(dir) {
    const d = _tmpVec.copy(dir).normalize();
    // Choose an arbitrary non-parallel axis
    const ref = Math.abs(d.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    _perpA.crossVectors(d, ref).normalize();
    _perpB.crossVectors(d, _perpA).normalize();
  }

  /**
   * Random float in [min, max).
   * @private
   */
  _rand(min, max) {
    return min + Math.random() * (max - min);
  }

  // ---------------------------------------------------------------------------
  // Public spawn methods
  // ---------------------------------------------------------------------------

  /**
   * 1. Blood splatter from a hit point.
   * @param {THREE.Vector3} position - World-space hit point.
   * @param {THREE.Vector3} direction - Incoming hit direction (particles burst *away*).
   * @param {number} [amount=15] - Number of blood particles.
   */
  spawnBlood(position, direction, amount = 15) {
    const count = Math.round(this._rand(10, 20) * (amount / 15));
    const awayDir = _tmpVec.copy(direction).negate().normalize();
    this._buildBasis(awayDir);

    for (let i = 0; i < count; i++) {
      // Hemisphere scatter
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * Math.PI * 0.5; // hemisphere
      const speed = this._rand(2.0, 6.0);

      const vx = awayDir.x * Math.cos(phi) + (_perpA.x * Math.cos(theta) + _perpB.x * Math.sin(theta)) * Math.sin(phi);
      const vy = awayDir.y * Math.cos(phi) + (_perpA.y * Math.cos(theta) + _perpB.y * Math.sin(theta)) * Math.sin(phi);
      const vz = awayDir.z * Math.cos(phi) + (_perpA.z * Math.cos(theta) + _perpB.z * Math.sin(theta)) * Math.sin(phi);

      const vel = new THREE.Vector3(vx * speed, vy * speed, vz * speed);
      // Vary hue between dark red and bright red
      const r = this._rand(0.5, 1.0);
      const g = this._rand(0.0, 0.08);
      const b = this._rand(0.0, 0.05);
      const color = new THREE.Color(r, g, b);

      this._emit(position, vel, color, this._rand(0.04, 0.1), this._rand(0.35, 0.6), 9.8, 2.0);
    }
  }

  /**
   * 2. Muzzle flash sparks from gun barrel.
   * @param {THREE.Vector3} position - Barrel tip world position.
   * @param {THREE.Vector3} direction - Forward firing direction.
   */
  spawnMuzzleFlash(position, direction) {
    const count = Math.round(this._rand(5, 8));
    const fwd = _tmpVec.copy(direction).normalize();
    this._buildBasis(fwd);

    for (let i = 0; i < count; i++) {
      const spread = this._rand(-0.25, 0.25);
      const speed  = this._rand(8, 18);
      const vel = new THREE.Vector3(
        fwd.x * speed + _perpA.x * spread * speed + _perpB.x * spread * speed,
        fwd.y * speed + _perpA.y * spread * speed + _perpB.y * spread * speed,
        fwd.z * speed + _perpA.z * spread * speed + _perpB.z * spread * speed,
      );

      // Bright yellow-orange palette
      const t = Math.random();
      const color = new THREE.Color().lerpColors(
        new THREE.Color(1.0, 0.95, 0.5),  // hot yellow
        new THREE.Color(1.0, 0.55, 0.1),  // orange
        t,
      );

      this._emit(position, vel, color, this._rand(0.05, 0.15), this._rand(0.03, 0.06), 0, 20.0);
    }
  }

  /**
   * 3. Surface impact dust (concrete / generic).
   * @param {THREE.Vector3} position - Impact point.
   * @param {THREE.Vector3} normal - Surface normal at impact.
   */
  spawnImpact(position, normal) {
    const count = Math.round(this._rand(5, 10));
    const n = _tmpVec.copy(normal).normalize();
    this._buildBasis(n);

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * Math.PI * 0.45;
      const speed = this._rand(1.0, 4.0);

      const vx = n.x * Math.cos(phi) + (_perpA.x * Math.cos(theta) + _perpB.x * Math.sin(theta)) * Math.sin(phi);
      const vy = n.y * Math.cos(phi) + (_perpA.y * Math.cos(theta) + _perpB.y * Math.sin(theta)) * Math.sin(phi);
      const vz = n.z * Math.cos(phi) + (_perpA.z * Math.cos(theta) + _perpB.z * Math.sin(theta)) * Math.sin(phi);

      const vel = new THREE.Vector3(vx * speed, vy * speed, vz * speed);

      const grey = this._rand(0.35, 0.65);
      const color = new THREE.Color(grey, grey, grey);

      this._emit(position, vel, color, this._rand(0.03, 0.08), this._rand(0.2, 0.45), 4.0, 3.0);
    }
  }

  /**
   * 4. Mystery Box glow -- call every frame to maintain a continuous halo.
   * @param {THREE.Vector3} position - Center of the mystery box (top surface).
   */
  spawnMysteryBoxGlow(position) {
    // Emit 1-3 particles per call to keep the glow alive without flooding
    const count = Math.round(this._rand(1, 3));

    for (let i = 0; i < count; i++) {
      const offset = new THREE.Vector3(
        this._rand(-0.4, 0.4),
        this._rand(0.0, 0.15),
        this._rand(-0.4, 0.4),
      );
      const spawnPos = new THREE.Vector3().copy(position).add(offset);

      // Gentle upward drift with light sway
      const vel = new THREE.Vector3(
        this._rand(-0.15, 0.15),
        this._rand(0.6, 1.4),
        this._rand(-0.15, 0.15),
      );

      // Golden hue variations
      const t = Math.random();
      const color = new THREE.Color().lerpColors(
        new THREE.Color(1.0, 0.85, 0.2),  // warm gold
        new THREE.Color(1.0, 0.65, 0.05), // deep amber
        t,
      );

      this._emit(spawnPos, vel, color, this._rand(0.04, 0.09), this._rand(1.0, 2.0), -0.1, 1.0);
    }
  }

  /**
   * 5. Ambient dust floating through an area.
   * @param {{min:THREE.Vector3, max:THREE.Vector3}} bounds - AABB defining the area.
   */
  spawnAmbientDust(bounds) {
    // Emit a small batch each call; caller should invoke every few frames
    const count = Math.round(this._rand(1, 3));

    for (let i = 0; i < count; i++) {
      const spawnPos = new THREE.Vector3(
        this._rand(bounds.min.x, bounds.max.x),
        this._rand(bounds.min.y, bounds.max.y),
        this._rand(bounds.min.z, bounds.max.z),
      );

      // Very slow random drift
      const vel = new THREE.Vector3(
        this._rand(-0.08, 0.08),
        this._rand(-0.02, 0.04),
        this._rand(-0.08, 0.08),
      );

      const brightness = this._rand(0.55, 0.85);
      const color = new THREE.Color(brightness, brightness, brightness);

      this._emit(spawnPos, vel, color, this._rand(0.015, 0.035), this._rand(4.0, 8.0), 0, 0.25);
    }
  }

  /**
   * 6. Barricade splinters -- sharp angular burst of wood fragments.
   * @param {THREE.Vector3} position - Center of the barricade break.
   * @param {THREE.Vector3} direction - General outward direction of the break.
   */
  spawnSplinters(position, direction) {
    const count = Math.round(this._rand(8, 16));
    const out = _tmpVec.copy(direction).normalize();
    this._buildBasis(out);

    for (let i = 0; i < count; i++) {
      // Wide cone burst, bias outward
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * Math.PI * 0.6;
      const speed = this._rand(3.0, 8.0);

      const vx = out.x * Math.cos(phi) + (_perpA.x * Math.cos(theta) + _perpB.x * Math.sin(theta)) * Math.sin(phi);
      const vy = out.y * Math.cos(phi) + (_perpA.y * Math.cos(theta) + _perpB.y * Math.sin(theta)) * Math.sin(phi);
      const vz = out.z * Math.cos(phi) + (_perpA.z * Math.cos(theta) + _perpB.z * Math.sin(theta)) * Math.sin(phi);

      const vel = new THREE.Vector3(vx * speed, vy * speed + this._rand(1, 3), vz * speed);

      // Brown / tan / wood palette
      const t = Math.random();
      const color = new THREE.Color().lerpColors(
        new THREE.Color(0.55, 0.35, 0.12), // dark wood
        new THREE.Color(0.85, 0.65, 0.3),  // light tan
        t,
      );

      this._emit(position, vel, color, this._rand(0.03, 0.09), this._rand(0.4, 0.8), 9.8, 2.0);
    }
  }

  /**
   * 7. Zombie death effect -- large blood burst + dark smoke.
   * @param {THREE.Vector3} position - Zombie world position at time of death.
   */
  spawnDeathEffect(position) {
    // --- Blood burst (large, many particles) ---
    const bloodCount = Math.round(this._rand(20, 30));
    for (let i = 0; i < bloodCount; i++) {
      const vel = new THREE.Vector3(
        this._rand(-3.5, 3.5),
        this._rand(1.0, 5.5),
        this._rand(-3.5, 3.5),
      );

      const r = this._rand(0.45, 1.0);
      const g = this._rand(0.0, 0.1);
      const b = this._rand(0.0, 0.05);
      const color = new THREE.Color(r, g, b);

      this._emit(position, vel, color, this._rand(0.06, 0.14), this._rand(0.5, 1.0), 9.8, 1.8);
    }

    // --- Dark smoke puff ---
    const smokeCount = Math.round(this._rand(8, 14));
    for (let i = 0; i < smokeCount; i++) {
      const vel = new THREE.Vector3(
        this._rand(-1.0, 1.0),
        this._rand(0.8, 2.5),
        this._rand(-1.0, 1.0),
      );

      const grey = this._rand(0.08, 0.2);
      const color = new THREE.Color(grey, grey, grey);

      const smokePos = new THREE.Vector3().copy(position).add(
        new THREE.Vector3(this._rand(-0.2, 0.2), this._rand(0, 0.5), this._rand(-0.2, 0.2)),
      );

      this._emit(smokePos, vel, color, this._rand(0.12, 0.28), this._rand(0.8, 1.5), -0.3, 1.2);
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  /**
   * 8. Tick all active particles: integrate physics, fade opacity, expire dead
   *    particles, and flush state to GPU buffers.
   * @param {number} deltaTime - Frame delta in seconds.
   */
  update(deltaTime) {
    const posArr = this.positionAttr.array;
    const colArr = this.colorAttr.array;
    const sizeArr = this.sizeAttr.array;
    const opaArr = this.opacityAttr.array;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];

      if (!p.active) {
        // Park inactive particles far off-screen so they aren't rendered visibly
        posArr[i * 3]     = 0;
        posArr[i * 3 + 1] = -9999;
        posArr[i * 3 + 2] = 0;
        sizeArr[i]  = 0;
        opaArr[i]   = 0;
        continue;
      }

      // --- Integrate physics ---
      p.velocity.y -= p.gravity * deltaTime;
      p.position.addScaledVector(p.velocity, deltaTime);

      // --- Age ---
      p.life -= deltaTime;
      if (p.life <= 0) {
        p.active = false;
        posArr[i * 3]     = 0;
        posArr[i * 3 + 1] = -9999;
        posArr[i * 3 + 2] = 0;
        sizeArr[i]  = 0;
        opaArr[i]   = 0;
        continue;
      }

      // --- Opacity fade ---
      const lifeRatio = p.life / p.maxLife; // 1 -> 0 over lifetime
      const opacity = Math.pow(lifeRatio, p.fadeRate);

      // --- Write to GPU buffers ---
      posArr[i * 3]     = p.position.x;
      posArr[i * 3 + 1] = p.position.y;
      posArr[i * 3 + 2] = p.position.z;

      colArr[i * 3]     = p.color.r;
      colArr[i * 3 + 1] = p.color.g;
      colArr[i * 3 + 2] = p.color.b;

      sizeArr[i] = p.size;
      opaArr[i]  = opacity;
    }

    // Flag attributes for GPU upload
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate    = true;
    this.sizeAttr.needsUpdate     = true;
    this.opacityAttr.needsUpdate  = true;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /**
   * 9. Dispose of all GPU resources and remove the mesh from the scene.
   */
  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
