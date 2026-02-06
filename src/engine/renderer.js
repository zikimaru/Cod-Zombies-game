import * as THREE from 'three';

/**
 * GameRenderer - Handles all Three.js rendering, scene setup, camera, and lighting.
 * Creates the atmospheric bunker environment with dim lighting, fog, and flickering effects.
 */
export class GameRenderer {
  constructor() {
    /** @type {THREE.WebGLRenderer} */
    this.renderer = null;
    /** @type {THREE.PerspectiveCamera} */
    this.camera = null;
    /** @type {THREE.Scene} */
    this.scene = null;

    /** @type {THREE.PointLight[]} Lights that flicker randomly */
    this.flickerLights = [];
    /** @type {number[]} Base intensities for flicker lights */
    this.flickerBaseIntensities = [];
    /** @type {number[]} Individual flicker timers */
    this.flickerTimers = [];
  }

  /**
   * Initialize the renderer, scene, camera, and all lighting.
   * @returns {void}
   */
  init() {
    this._createRenderer();
    this._createCamera();
    this._createScene();
    this._setupLighting();
    this._bindResize();
  }

  /**
   * Create the WebGL renderer with shadows and tone mapping.
   * @private
   */
  _createRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Shadow configuration
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Tone mapping for cinematic look
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    document.body.appendChild(this.renderer.domElement);
  }

  /**
   * Create the perspective camera for FPS view.
   * @private
   */
  _createCamera() {
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 1.7, 0); // Eye height ~1.7m
  }

  /**
   * Create the scene with dark atmospheric fog.
   * @private
   */
  _createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a0f);
    this.scene.fog = new THREE.Fog(0x0a0a0f, 10, 80);
  }

  /**
   * Set up all bunker lighting: ambient, ceiling point lights, and flicker lights.
   * @private
   */
  _setupLighting() {
    // Dim ambient light for bunker darkness
    const ambient = new THREE.AmbientLight(0x1a1a2e, 0.3);
    this.scene.add(ambient);

    // Bunker ceiling lights - warm yellow bulbs at fixed positions
    const ceilingLightPositions = [
      { x: 0, y: 3.8, z: 0 },
      { x: 8, y: 3.8, z: 0 },
      { x: -8, y: 3.8, z: 0 },
      { x: 0, y: 3.8, z: 8 },
      { x: 0, y: 3.8, z: -8 },
      { x: 8, y: 3.8, z: 8 },
      { x: -8, y: 3.8, z: -8 },
      { x: 8, y: 3.8, z: -8 },
      { x: -8, y: 3.8, z: 8 },
    ];

    for (const pos of ceilingLightPositions) {
      const light = new THREE.PointLight(0xffcc66, 1.2, 18, 1.5);
      light.position.set(pos.x, pos.y, pos.z);
      light.castShadow = true;

      // Shadow quality settings - keep shadow maps small for performance
      light.shadow.mapSize.width = 512;
      light.shadow.mapSize.height = 512;
      light.shadow.camera.near = 0.2;
      light.shadow.camera.far = 20;
      light.shadow.bias = -0.002;

      this.scene.add(light);

      // Small emissive sphere to represent the bulb
      const bulbGeometry = new THREE.SphereGeometry(0.08, 8, 8);
      const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffdd88 });
      const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
      bulb.position.copy(light.position);
      this.scene.add(bulb);
    }

    // Flicker lights - a subset that randomly vary intensity for horror atmosphere
    const flickerPositions = [
      { x: 4, y: 3.8, z: 4, intensity: 1.0 },
      { x: -4, y: 3.8, z: -4, intensity: 0.8 },
      { x: 12, y: 3.8, z: 4, intensity: 0.9 },
    ];

    for (const cfg of flickerPositions) {
      const light = new THREE.PointLight(0xffaa44, cfg.intensity, 15, 1.8);
      light.position.set(cfg.x, cfg.y, cfg.z);
      light.castShadow = true;
      light.shadow.mapSize.width = 256;
      light.shadow.mapSize.height = 256;
      light.shadow.camera.near = 0.2;
      light.shadow.camera.far = 16;
      light.shadow.bias = -0.002;

      this.scene.add(light);

      this.flickerLights.push(light);
      this.flickerBaseIntensities.push(cfg.intensity);
      this.flickerTimers.push(Math.random() * Math.PI * 2); // random phase offset

      // Bulb mesh for flicker light
      const bulbGeometry = new THREE.SphereGeometry(0.08, 8, 8);
      const bulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffcc66 });
      const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
      bulb.position.set(cfg.x, cfg.y, cfg.z);
      this.scene.add(bulb);
    }

    // Subtle directional fill light to prevent total blackness in corners
    const fillLight = new THREE.DirectionalLight(0x2233aa, 0.08);
    fillLight.position.set(0, 10, 0);
    this.scene.add(fillLight);
  }

  /**
   * Bind the window resize handler.
   * @private
   */
  _bindResize() {
    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  /**
   * Handle window resize - update camera aspect and renderer size.
   * @private
   */
  _handleResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  /**
   * Update flickering lights. Called each frame.
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(deltaTime) {
    for (let i = 0; i < this.flickerLights.length; i++) {
      this.flickerTimers[i] += deltaTime * (3 + Math.random() * 2);

      const base = this.flickerBaseIntensities[i];
      // Combine sine wave with random jitter for organic flicker
      const sinFlicker = Math.sin(this.flickerTimers[i] * 4.7) * 0.15;
      const randomJitter = (Math.random() - 0.5) * 0.2;

      // Occasional hard flicker (momentary dimming)
      let hardFlicker = 1.0;
      if (Math.random() < 0.005) {
        hardFlicker = 0.1 + Math.random() * 0.3;
      }

      this.flickerLights[i].intensity = Math.max(
        0.05,
        (base + sinFlicker + randomJitter) * hardFlicker
      );
    }
  }

  /**
   * Render the scene.
   */
  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * @returns {THREE.Scene}
   */
  getScene() {
    return this.scene;
  }

  /**
   * @returns {THREE.PerspectiveCamera}
   */
  getCamera() {
    return this.camera;
  }

  /**
   * @returns {THREE.WebGLRenderer}
   */
  getRenderer() {
    return this.renderer;
  }

  /**
   * Clean up renderer resources.
   */
  dispose() {
    window.removeEventListener('resize', this._onResize);

    this.renderer.dispose();
    this.renderer.domElement.remove();

    // Dispose all geometries and materials in the scene
    this.scene.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose();
      }
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((mat) => mat.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
  }
}
