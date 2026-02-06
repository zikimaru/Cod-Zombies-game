/**
 * AudioManager - Procedural audio system for CoD Zombies using Web Audio API.
 * All sounds are synthesized at runtime (no external audio files).
 * Provides 3D spatial audio, weapon sounds, zombie vocals, UI feedback,
 * ambient atmosphere, and tension music.
 */

import { eventBus } from '../main.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DISTANCE = 60;
const REF_DISTANCE = 1;
const ROLLOFF = 1.5;
const SAMPLE_RATE = 44100;

// ---------------------------------------------------------------------------
// AudioManager
// ---------------------------------------------------------------------------

export class AudioManager {
  /**
   * @param {THREE.PerspectiveCamera} camera - The player camera used as the audio listener
   */
  constructor(camera) {
    this.eventBus = eventBus;
    this.camera = camera;

    /** @type {AudioContext|null} */
    this.audioContext = null;
    /** @type {GainNode|null} */
    this.masterGain = null;
    /** @type {GainNode|null} */
    this.sfxGain = null;
    /** @type {GainNode|null} */
    this.musicGain = null;
    /** @type {GainNode|null} */
    this.ambientGain = null;

    /** @type {Map<string, AudioBuffer>} Pre-generated audio buffers */
    this.buffers = new Map();

    /** @type {Array<object>} Currently playing 3D sound instances */
    this.activeSounds = [];

    /** @type {Array<object>} Active ambient loop sources */
    this.ambientSources = [];

    /** @type {object|null} Currently playing music state */
    this.musicState = null;

    this.isInitialized = false;
    this._userGestureHandled = false;

    // Listener state (updated each frame)
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.listenerForward = { x: 0, y: 0, z: -1 };
    this.listenerRight = { x: 1, y: 0, z: 0 };

    // Round tracking for music intensity
    this.currentRound = 1;

    this.init();
  }

  // =========================================================================
  // Initialization
  // =========================================================================

  /**
   * Set up deferred AudioContext creation (browser requires user gesture).
   */
  init() {
    // Attach user-gesture listener to create/resume the AudioContext
    this._gestureHandler = () => this.initOnUserGesture();
    document.addEventListener('click', this._gestureHandler, { once: false });
    document.addEventListener('keydown', this._gestureHandler, { once: false });

    // Subscribe to game events
    this._subscribeEvents();
  }

  /**
   * Called on first user interaction to create and resume the AudioContext.
   */
  initOnUserGesture() {
    if (this._userGestureHandled) return;

    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        console.warn('[AudioManager] Web Audio API not supported.');
        return;
      }

      this.audioContext = new AC({ sampleRate: SAMPLE_RATE });

      // Build gain node graph: master -> sfx / music / ambient
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 0.7;
      this.masterGain.connect(this.audioContext.destination);

      this.sfxGain = this.audioContext.createGain();
      this.sfxGain.gain.value = 1.0;
      this.sfxGain.connect(this.masterGain);

      this.musicGain = this.audioContext.createGain();
      this.musicGain.gain.value = 0.25;
      this.musicGain.connect(this.masterGain);

      this.ambientGain = this.audioContext.createGain();
      this.ambientGain.gain.value = 0.35;
      this.ambientGain.connect(this.masterGain);

      // Resume context if suspended
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      // Pre-generate commonly used buffers
      this._pregenerateBuffers();

      this.isInitialized = true;
      this._userGestureHandled = true;

      // Clean up gesture listeners
      document.removeEventListener('click', this._gestureHandler);
      document.removeEventListener('keydown', this._gestureHandler);

      console.log('[AudioManager] Initialized successfully.');
    } catch (err) {
      console.error('[AudioManager] Failed to initialize:', err);
    }
  }

  /**
   * Subscribe to EventBus events for automatic audio triggers.
   * @private
   */
  _subscribeEvents() {
    this.eventBus.on('weapon:fire', (data) => {
      this.playGunshot(data.weaponType || 'rifle');
    });
    this.eventBus.on('weapon:reload', (data) => {
      this.playReload(data.weaponType || 'rifle');
    });
    this.eventBus.on('zombie:hit', (data) => {
      const type = data.headshot ? 'headshot' : 'flesh';
      this.playImpact(type);
    });
    this.eventBus.on('zombie:killed', (data) => {
      this.playZombieSound('death', data.position);
    });
    this.eventBus.on('zombie:attack', (data) => {
      this.playZombieSound('attack', data.position);
    });
    this.eventBus.on('points:updated', () => {
      this.playUI('points');
    });
    this.eventBus.on('round:changed', (round) => {
      this.currentRound = round;
      this.playUI('roundStart');
    });
    this.eventBus.on('wave:complete', () => {
      this.playUI('roundEnd');
    });
    this.eventBus.on('game:started', () => {
      this.startAmbience();
      this._startMusic();
    });
    this.eventBus.on('game:over', () => {
      this.stopAmbience();
      this._stopMusic();
    });
    this.eventBus.on('barricade:rebuild', () => {
      this.playUI('barrierRebuild');
    });
    this.eventBus.on('purchase:complete', () => {
      this.playUI('purchase');
    });
  }

  /**
   * Pre-generate reusable audio buffers for common sounds.
   * @private
   */
  _pregenerateBuffers() {
    const ctx = this.audioContext;
    // White noise buffers at various durations
    this.buffers.set('whiteNoise_0.1', this.createWhiteNoise(0.1));
    this.buffers.set('whiteNoise_0.2', this.createWhiteNoise(0.2));
    this.buffers.set('whiteNoise_0.5', this.createWhiteNoise(0.5));
    this.buffers.set('whiteNoise_1.0', this.createWhiteNoise(1.0));
    this.buffers.set('whiteNoise_2.0', this.createWhiteNoise(2.0));
    this.buffers.set('pinkNoise_2.0', this.createPinkNoise(2.0));
    this.buffers.set('pinkNoise_4.0', this.createPinkNoise(4.0));
  }

  // =========================================================================
  // Noise Generation
  // =========================================================================

  /**
   * Create an AudioBuffer filled with white noise.
   * @param {number} duration - Duration in seconds
   * @returns {AudioBuffer}
   */
  createWhiteNoise(duration) {
    const ctx = this.audioContext;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * Create an AudioBuffer filled with pink noise (filtered white noise with
   * more energy at lower frequencies).
   * Uses the Voss-McCartney algorithm approximation.
   * @param {number} duration - Duration in seconds
   * @returns {AudioBuffer}
   */
  createPinkNoise(duration) {
    const ctx = this.audioContext;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return buffer;
  }

  // =========================================================================
  // Gunshot Sound Synthesis
  // =========================================================================

  /**
   * Synthesize and play a gunshot sound for the given weapon type.
   * Each type has unique tonal characteristics.
   * @param {string} weaponType - 'pistol' | 'rifle' | 'smg' | 'shotgun' | 'special' | 'lmg'
   */
  playGunshot(weaponType) {
    if (!this.isInitialized) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    switch (weaponType) {
      case 'pistol':
        this._playPistolShot(now);
        break;
      case 'rifle':
        this._playRifleShot(now);
        break;
      case 'smg':
        this._playSMGShot(now);
        break;
      case 'shotgun':
        this._playShotgunShot(now);
        break;
      case 'special':
        this._playRayGunShot(now);
        break;
      case 'lmg':
        this._playLMGShot(now);
        break;
      default:
        this._playRifleShot(now);
        break;
    }
  }

  /**
   * Pistol: Short sharp noise burst, quick decay, slight metallic ring.
   * @private
   */
  _playPistolShot(now) {
    const ctx = this.audioContext;

    // Noise body
    const noiseSource = this._createNoiseSource(0.15);
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 3000;
    bandpass.Q.value = 1.2;

    const gainEnv = ctx.createGain();
    gainEnv.gain.setValueAtTime(0.8, now);
    gainEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    noiseSource.connect(bandpass);
    bandpass.connect(gainEnv);
    gainEnv.connect(this.sfxGain);

    noiseSource.start(now);
    noiseSource.stop(now + 0.15);

    // Metallic ring
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(4200, now);
    osc.frequency.exponentialRampToValueAtTime(2800, now + 0.06);

    const ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(0.15, now);
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(ringGain);
    ringGain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.1);

    // Low thump
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(150, now);
    thump.frequency.exponentialRampToValueAtTime(50, now + 0.08);

    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.5, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    thump.connect(thumpGain);
    thumpGain.connect(this.sfxGain);
    thump.start(now);
    thump.stop(now + 0.1);
  }

  /**
   * Rifle: Longer noise burst, more bass, echo tail.
   * @private
   */
  _playRifleShot(now) {
    const ctx = this.audioContext;

    // Main noise burst
    const noiseSource = this._createNoiseSource(0.3);
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1800;
    bandpass.Q.value = 0.8;

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 200;

    const gainEnv = ctx.createGain();
    gainEnv.gain.setValueAtTime(0.9, now);
    gainEnv.gain.exponentialRampToValueAtTime(0.3, now + 0.04);
    gainEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    noiseSource.connect(bandpass);
    bandpass.connect(highpass);
    highpass.connect(gainEnv);
    gainEnv.connect(this.sfxGain);

    noiseSource.start(now);
    noiseSource.stop(now + 0.3);

    // Bass thump
    const bass = ctx.createOscillator();
    bass.type = 'sine';
    bass.frequency.setValueAtTime(120, now);
    bass.frequency.exponentialRampToValueAtTime(40, now + 0.12);

    const bassGain = ctx.createGain();
    bassGain.gain.setValueAtTime(0.7, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    bass.connect(bassGain);
    bassGain.connect(this.sfxGain);
    bass.start(now);
    bass.stop(now + 0.18);

    // Echo / reverb tail (delayed quieter burst)
    const echoNoise = this._createNoiseSource(0.2);
    const echoBP = ctx.createBiquadFilter();
    echoBP.type = 'bandpass';
    echoBP.frequency.value = 1200;
    echoBP.Q.value = 0.5;

    const echoGain = ctx.createGain();
    echoGain.gain.setValueAtTime(0.0, now);
    echoGain.gain.setValueAtTime(0.15, now + 0.06);
    echoGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    echoNoise.connect(echoBP);
    echoBP.connect(echoGain);
    echoGain.connect(this.sfxGain);

    echoNoise.start(now + 0.06);
    echoNoise.stop(now + 0.4);
  }

  /**
   * SMG: Shorter, rapid, less bass.
   * @private
   */
  _playSMGShot(now) {
    const ctx = this.audioContext;

    const noiseSource = this._createNoiseSource(0.08);
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 3500;
    bandpass.Q.value = 1.0;

    const gainEnv = ctx.createGain();
    gainEnv.gain.setValueAtTime(0.65, now);
    gainEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    noiseSource.connect(bandpass);
    bandpass.connect(gainEnv);
    gainEnv.connect(this.sfxGain);

    noiseSource.start(now);
    noiseSource.stop(now + 0.08);

    // Light snap
    const snap = ctx.createOscillator();
    snap.type = 'square';
    snap.frequency.setValueAtTime(2000, now);
    snap.frequency.exponentialRampToValueAtTime(800, now + 0.03);

    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.2, now);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    snap.connect(snapGain);
    snapGain.connect(this.sfxGain);
    snap.start(now);
    snap.stop(now + 0.04);
  }

  /**
   * Shotgun: Large noise burst, heavy bass, long reverb tail.
   * @private
   */
  _playShotgunShot(now) {
    const ctx = this.audioContext;

    // Massive initial noise burst
    const noiseSource = this._createNoiseSource(0.5);
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1200;
    bandpass.Q.value = 0.5;

    const gainEnv = ctx.createGain();
    gainEnv.gain.setValueAtTime(1.0, now);
    gainEnv.gain.exponentialRampToValueAtTime(0.4, now + 0.03);
    gainEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    noiseSource.connect(bandpass);
    bandpass.connect(gainEnv);
    gainEnv.connect(this.sfxGain);

    noiseSource.start(now);
    noiseSource.stop(now + 0.5);

    // Heavy bass
    const bass = ctx.createOscillator();
    bass.type = 'sine';
    bass.frequency.setValueAtTime(80, now);
    bass.frequency.exponentialRampToValueAtTime(30, now + 0.2);

    const bassGain = ctx.createGain();
    bassGain.gain.setValueAtTime(0.9, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    bass.connect(bassGain);
    bassGain.connect(this.sfxGain);
    bass.start(now);
    bass.stop(now + 0.3);

    // Long reverb tail
    const reverbNoise = this._createNoiseSource(0.8);
    const reverbBP = ctx.createBiquadFilter();
    reverbBP.type = 'lowpass';
    reverbBP.frequency.value = 800;

    const reverbGain = ctx.createGain();
    reverbGain.gain.setValueAtTime(0.0, now);
    reverbGain.gain.linearRampToValueAtTime(0.2, now + 0.05);
    reverbGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

    reverbNoise.connect(reverbBP);
    reverbBP.connect(reverbGain);
    reverbGain.connect(this.sfxGain);

    reverbNoise.start(now + 0.03);
    reverbNoise.stop(now + 0.8);

    // Secondary thump for extra punch
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(200, now);
    thump.frequency.exponentialRampToValueAtTime(60, now + 0.06);

    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.6, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    thump.connect(thumpGain);
    thumpGain.connect(this.sfxGain);
    thump.start(now);
    thump.stop(now + 0.12);
  }

  /**
   * LMG: Similar to rifle but with more punch and longer tail.
   * @private
   */
  _playLMGShot(now) {
    const ctx = this.audioContext;

    const noiseSource = this._createNoiseSource(0.25);
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 2000;
    bandpass.Q.value = 0.7;

    const gainEnv = ctx.createGain();
    gainEnv.gain.setValueAtTime(0.85, now);
    gainEnv.gain.exponentialRampToValueAtTime(0.2, now + 0.04);
    gainEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    noiseSource.connect(bandpass);
    bandpass.connect(gainEnv);
    gainEnv.connect(this.sfxGain);

    noiseSource.start(now);
    noiseSource.stop(now + 0.25);

    // Bass body
    const bass = ctx.createOscillator();
    bass.type = 'sine';
    bass.frequency.setValueAtTime(100, now);
    bass.frequency.exponentialRampToValueAtTime(35, now + 0.14);

    const bassGain = ctx.createGain();
    bassGain.gain.setValueAtTime(0.65, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    bass.connect(bassGain);
    bassGain.connect(this.sfxGain);
    bass.start(now);
    bass.stop(now + 0.18);

    // Mechanical clatter
    const clatter = this._createNoiseSource(0.06);
    const clatterBP = ctx.createBiquadFilter();
    clatterBP.type = 'bandpass';
    clatterBP.frequency.value = 5000;
    clatterBP.Q.value = 3;

    const clatterGain = ctx.createGain();
    clatterGain.gain.setValueAtTime(0.1, now + 0.02);
    clatterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    clatter.connect(clatterBP);
    clatterBP.connect(clatterGain);
    clatterGain.connect(this.sfxGain);

    clatter.start(now + 0.02);
    clatter.stop(now + 0.08);
  }

  /**
   * Ray Gun: Oscillator sweep (high to low), electronic buzz.
   * @private
   */
  _playRayGunShot(now) {
    const ctx = this.audioContext;

    // Main descending sweep
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(3000, now);
    osc1.frequency.exponentialRampToValueAtTime(200, now + 0.3);

    const osc1Gain = ctx.createGain();
    osc1Gain.gain.setValueAtTime(0.35, now);
    osc1Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(osc1Gain);
    osc1Gain.connect(this.sfxGain);
    osc1.start(now);
    osc1.stop(now + 0.4);

    // Electronic buzz / ring modulation effect
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(800, now);
    osc2.frequency.exponentialRampToValueAtTime(120, now + 0.25);

    const osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(0.2, now);
    osc2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc2.connect(osc2Gain);
    osc2Gain.connect(this.sfxGain);
    osc2.start(now);
    osc2.stop(now + 0.3);

    // High-frequency shimmer
    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(6000, now);
    shimmer.frequency.exponentialRampToValueAtTime(1500, now + 0.15);

    const shimmerGain = ctx.createGain();
    shimmerGain.gain.setValueAtTime(0.12, now);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    shimmer.connect(shimmerGain);
    shimmerGain.connect(this.sfxGain);
    shimmer.start(now);
    shimmer.stop(now + 0.2);

    // Sub-bass punch
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(100, now);
    sub.frequency.exponentialRampToValueAtTime(40, now + 0.1);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.5, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    sub.connect(subGain);
    subGain.connect(this.sfxGain);
    sub.start(now);
    sub.stop(now + 0.15);
  }

  // =========================================================================
  // Reload Sound Synthesis
  // =========================================================================

  /**
   * Play a reload sound sequence for the given weapon type.
   * Consists of mag-out click, pause, mag-in click, bolt/slide rack.
   * @param {string} weaponType
   */
  playReload(weaponType) {
    if (!this.isInitialized) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Timing offsets (seconds)
    const magOutTime = 0.0;
    const magInTime = 0.4;
    const boltTime = 0.75;

    // Magazine out: short click
    this._playClick(now + magOutTime, 4500, 0.04, 0.5);

    // Magazine in: slightly lower click
    this._playClick(now + magInTime, 3200, 0.05, 0.55);

    // Bolt/slide rack: metallic scraping
    this._playMetallicScrape(now + boltTime, weaponType);
  }

  /**
   * Play a short click sound (magazine click).
   * @param {number} time - Start time
   * @param {number} freq - Bandpass center frequency
   * @param {number} duration - Duration in seconds
   * @param {number} volume - Gain level
   * @private
   */
  _playClick(time, freq, duration, volume) {
    const ctx = this.audioContext;

    const noise = this._createNoiseSource(duration + 0.02);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    noise.connect(bp);
    bp.connect(gain);
    gain.connect(this.sfxGain);

    noise.start(time);
    noise.stop(time + duration + 0.02);
  }

  /**
   * Play a metallic scraping sound (bolt/slide action).
   * @param {number} time - Start time
   * @param {string} weaponType
   * @private
   */
  _playMetallicScrape(time, weaponType) {
    const ctx = this.audioContext;
    const duration = weaponType === 'shotgun' ? 0.25 : 0.15;

    // Filtered noise for scraping
    const noise = this._createNoiseSource(duration + 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2500, time);
    bp.frequency.linearRampToValueAtTime(4000, time + duration * 0.5);
    bp.frequency.linearRampToValueAtTime(2000, time + duration);
    bp.Q.value = 4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.4, time + 0.02);
    gain.gain.setValueAtTime(0.35, time + duration * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    noise.connect(bp);
    bp.connect(gain);
    gain.connect(this.sfxGain);

    noise.start(time);
    noise.stop(time + duration + 0.05);

    // Metallic ring overtone
    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(5500, time);
    ring.frequency.exponentialRampToValueAtTime(3500, time + duration);

    const ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(0.08, time);
    ringGain.gain.exponentialRampToValueAtTime(0.001, time + duration * 0.8);

    ring.connect(ringGain);
    ringGain.connect(this.sfxGain);

    ring.start(time);
    ring.stop(time + duration + 0.02);
  }

  // =========================================================================
  // Zombie Sound Synthesis
  // =========================================================================

  /**
   * Play a zombie sound at a given 3D position.
   * @param {string} type - 'growl' | 'moan' | 'attack' | 'death' | 'horde'
   * @param {{ x: number, y: number, z: number }} [position] - World position
   */
  playZombieSound(type, position) {
    if (!this.isInitialized) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Create a gain node for 3D positioning
    const spatialGain = ctx.createGain();
    const panner = ctx.createStereoPanner();

    // Calculate spatial attenuation if position given
    if (position) {
      const spatial = this._computeSpatial(position);
      spatialGain.gain.value = spatial.volume;
      panner.pan.value = spatial.pan;
    } else {
      spatialGain.gain.value = 1.0;
      panner.pan.value = 0;
    }

    panner.connect(spatialGain);
    spatialGain.connect(this.sfxGain);

    const connectTo = panner;

    switch (type) {
      case 'growl':
        this._playZombieGrowl(now, connectTo);
        break;
      case 'moan':
        this._playZombieMoan(now, connectTo);
        break;
      case 'attack':
        this._playZombieAttack(now, connectTo);
        break;
      case 'death':
        this._playZombieDeath(now, connectTo);
        break;
      case 'horde':
        this._playZombieHorde(now, connectTo);
        break;
      default:
        this._playZombieMoan(now, connectTo);
        break;
    }

    // Track for spatial update if positioned
    if (position) {
      const instance = {
        position: { ...position },
        gainNode: spatialGain,
        pannerNode: panner,
        startTime: now,
        duration: type === 'horde' ? 4.0 : 1.5,
      };
      this.activeSounds.push(instance);
    }
  }

  /**
   * Zombie growl: Low frequency noise (100-300Hz bandpass), slow tremolo.
   * @private
   */
  _playZombieGrowl(now, destination) {
    const ctx = this.audioContext;
    const duration = 0.8 + Math.random() * 0.6;

    // Low noise body
    const noise = this._createNoiseSource(duration + 0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 150 + Math.random() * 150;
    bp.Q.value = 2;

    // Tremolo LFO
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5 + Math.random() * 3;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.3;

    const tremoloGain = ctx.createGain();
    tremoloGain.gain.value = 0.6;

    lfo.connect(lfoGain);
    lfoGain.connect(tremoloGain.gain);

    // Envelope
    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(0.001, now);
    envGain.gain.linearRampToValueAtTime(0.7, now + 0.1);
    envGain.gain.setValueAtTime(0.6, now + duration * 0.6);
    envGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(bp);
    bp.connect(tremoloGain);
    tremoloGain.connect(envGain);
    envGain.connect(destination);

    noise.start(now);
    noise.stop(now + duration + 0.1);
    lfo.start(now);
    lfo.stop(now + duration + 0.1);
  }

  /**
   * Zombie moan: Oscillator with vibrato, noise mix.
   * @private
   */
  _playZombieMoan(now, destination) {
    const ctx = this.audioContext;
    const duration = 1.0 + Math.random() * 0.8;
    const baseFreq = 130 + Math.random() * 60;

    // Main oscillator with vibrato
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.linearRampToValueAtTime(baseFreq * 1.15, now + duration * 0.3);
    osc.frequency.linearRampToValueAtTime(baseFreq * 0.9, now + duration);

    // Vibrato LFO
    const vibrato = ctx.createOscillator();
    vibrato.type = 'sine';
    vibrato.frequency.value = 5 + Math.random() * 2;

    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = 10 + Math.random() * 8;

    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);

    // Filter
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.Q.value = 1;

    // Noise layer
    const noise = this._createNoiseSource(duration + 0.1);
    const noiseBP = ctx.createBiquadFilter();
    noiseBP.type = 'bandpass';
    noiseBP.frequency.value = 200;
    noiseBP.Q.value = 1.5;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.15;

    // Mix gain
    const mixGain = ctx.createGain();
    mixGain.gain.setValueAtTime(0.001, now);
    mixGain.gain.linearRampToValueAtTime(0.5, now + 0.15);
    mixGain.gain.setValueAtTime(0.45, now + duration * 0.5);
    mixGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(lp);
    lp.connect(mixGain);

    noise.connect(noiseBP);
    noiseBP.connect(noiseGain);
    noiseGain.connect(mixGain);

    mixGain.connect(destination);

    osc.start(now);
    osc.stop(now + duration + 0.05);
    vibrato.start(now);
    vibrato.stop(now + duration + 0.05);
    noise.start(now);
    noise.stop(now + duration + 0.1);
  }

  /**
   * Zombie attack scream: Higher pitch growl with fast attack.
   * @private
   */
  _playZombieAttack(now, destination) {
    const ctx = this.audioContext;
    const duration = 0.5 + Math.random() * 0.3;

    // High noise
    const noise = this._createNoiseSource(duration + 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(400, now);
    bp.frequency.linearRampToValueAtTime(600, now + 0.05);
    bp.frequency.linearRampToValueAtTime(300, now + duration);
    bp.Q.value = 3;

    // Fast attack envelope
    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(0.001, now);
    envGain.gain.linearRampToValueAtTime(0.9, now + 0.02);
    envGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(bp);
    bp.connect(envGain);
    envGain.connect(destination);

    noise.start(now);
    noise.stop(now + duration + 0.05);

    // Aggression tone
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + duration);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.7);

    osc.connect(oscGain);
    oscGain.connect(destination);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /**
   * Zombie death: Descending pitch moan.
   * @private
   */
  _playZombieDeath(now, destination) {
    const ctx = this.audioContext;
    const duration = 1.2 + Math.random() * 0.5;
    const startFreq = 200 + Math.random() * 60;

    // Descending oscillator
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + duration);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(800, now);
    lp.frequency.exponentialRampToValueAtTime(150, now + duration);

    // Noise layer
    const noise = this._createNoiseSource(duration + 0.1);
    const noiseBP = ctx.createBiquadFilter();
    noiseBP.type = 'bandpass';
    noiseBP.frequency.value = 250;
    noiseBP.Q.value = 1;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.3, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.8);

    // Envelope
    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(0.001, now);
    envGain.gain.linearRampToValueAtTime(0.6, now + 0.05);
    envGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(lp);
    lp.connect(envGain);

    noise.connect(noiseBP);
    noiseBP.connect(noiseGain);
    noiseGain.connect(envGain);

    envGain.connect(destination);

    osc.start(now);
    osc.stop(now + duration + 0.05);
    noise.start(now);
    noise.stop(now + duration + 0.1);
  }

  /**
   * Zombie horde ambient: Multiple layered low growls/moans at low volume.
   * @private
   */
  _playZombieHorde(now, destination) {
    const ctx = this.audioContext;
    const duration = 3.0 + Math.random() * 2.0;

    // Layer 1: very low rumble
    const noise1 = this._createNoiseSource(duration + 0.2);
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.value = 100;
    bp1.Q.value = 1;

    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.001, now);
    g1.gain.linearRampToValueAtTime(0.15, now + 0.5);
    g1.gain.setValueAtTime(0.12, now + duration * 0.7);
    g1.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise1.connect(bp1);
    bp1.connect(g1);
    g1.connect(destination);

    noise1.start(now);
    noise1.stop(now + duration + 0.2);

    // Layer 2: mid growl
    const noise2 = this._createNoiseSource(duration + 0.2);
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 200;
    bp2.Q.value = 2;

    // Slow tremolo
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 2;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.05;

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.001, now);
    g2.gain.linearRampToValueAtTime(0.1, now + 0.8);
    g2.gain.setValueAtTime(0.08, now + duration * 0.6);
    g2.gain.exponentialRampToValueAtTime(0.001, now + duration);

    lfo.connect(lfoG);
    lfoG.connect(g2.gain);

    noise2.connect(bp2);
    bp2.connect(g2);
    g2.connect(destination);

    noise2.start(now);
    noise2.stop(now + duration + 0.2);
    lfo.start(now);
    lfo.stop(now + duration + 0.2);

    // Layer 3: occasional distant moan oscillator
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now + 0.5);
    osc.frequency.linearRampToValueAtTime(120, now + duration);

    const oscLP = ctx.createBiquadFilter();
    oscLP.type = 'lowpass';
    oscLP.frequency.value = 300;

    const g3 = ctx.createGain();
    g3.gain.setValueAtTime(0.001, now);
    g3.gain.linearRampToValueAtTime(0.06, now + 1.0);
    g3.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(oscLP);
    oscLP.connect(g3);
    g3.connect(destination);

    osc.start(now);
    osc.stop(now + duration + 0.1);
  }

  // =========================================================================
  // Impact Sound Synthesis
  // =========================================================================

  /**
   * Play an impact sound effect.
   * @param {string} type - 'wall' | 'flesh' | 'headshot'
   */
  playImpact(type) {
    if (!this.isInitialized) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    switch (type) {
      case 'wall':
        this._playWallImpact(now);
        break;
      case 'flesh':
        this._playFleshImpact(now);
        break;
      case 'headshot':
        this._playHeadshotImpact(now);
        break;
      default:
        this._playWallImpact(now);
        break;
    }
  }

  /**
   * Bullet impact on wall: Brief high noise burst (concrete dust).
   * @private
   */
  _playWallImpact(now) {
    const ctx = this.audioContext;

    const noise = this._createNoiseSource(0.08);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5000 + Math.random() * 2000;
    bp.Q.value = 1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    noise.connect(bp);
    bp.connect(gain);
    gain.connect(this.sfxGain);

    noise.start(now);
    noise.stop(now + 0.08);

    // Small thud
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(300, now);
    thud.frequency.exponentialRampToValueAtTime(80, now + 0.04);

    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.2, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

    thud.connect(thudGain);
    thudGain.connect(this.sfxGain);
    thud.start(now);
    thud.stop(now + 0.06);
  }

  /**
   * Bullet impact on flesh: Softer, wetter noise (lower bandpass).
   * @private
   */
  _playFleshImpact(now) {
    const ctx = this.audioContext;

    const noise = this._createNoiseSource(0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500 + Math.random() * 500;
    bp.Q.value = 0.8;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    noise.connect(bp);
    bp.connect(lp);
    lp.connect(gain);
    gain.connect(this.sfxGain);

    noise.start(now);
    noise.stop(now + 0.1);

    // Wet thump
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(180, now);
    thump.frequency.exponentialRampToValueAtTime(60, now + 0.06);

    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.25, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    thump.connect(thumpGain);
    thumpGain.connect(this.sfxGain);
    thump.start(now);
    thump.stop(now + 0.08);
  }

  /**
   * Headshot: Sharper crack + squelch.
   * @private
   */
  _playHeadshotImpact(now) {
    const ctx = this.audioContext;

    // Sharp crack
    const crack = this._createNoiseSource(0.05);
    const crackBP = ctx.createBiquadFilter();
    crackBP.type = 'bandpass';
    crackBP.frequency.value = 6000;
    crackBP.Q.value = 2;

    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.7, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    crack.connect(crackBP);
    crackBP.connect(crackGain);
    crackGain.connect(this.sfxGain);

    crack.start(now);
    crack.stop(now + 0.05);

    // Squelch (low wet noise)
    const squelch = this._createNoiseSource(0.12);
    const sqBP = ctx.createBiquadFilter();
    sqBP.type = 'bandpass';
    sqBP.frequency.value = 800;
    sqBP.Q.value = 1.5;

    const sqLP = ctx.createBiquadFilter();
    sqLP.type = 'lowpass';
    sqLP.frequency.value = 2000;

    const sqGain = ctx.createGain();
    sqGain.gain.setValueAtTime(0.001, now);
    sqGain.gain.linearRampToValueAtTime(0.45, now + 0.01);
    sqGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    squelch.connect(sqBP);
    sqBP.connect(sqLP);
    sqLP.connect(sqGain);
    sqGain.connect(this.sfxGain);

    squelch.start(now);
    squelch.stop(now + 0.12);

    // Impact thump
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(250, now);
    thump.frequency.exponentialRampToValueAtTime(50, now + 0.05);

    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.4, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    thump.connect(thumpGain);
    thumpGain.connect(this.sfxGain);
    thump.start(now);
    thump.stop(now + 0.07);
  }

  // =========================================================================
  // UI Sound Synthesis
  // =========================================================================

  /**
   * Play a UI feedback sound.
   * @param {string} type - 'points' | 'purchase' | 'roundStart' | 'roundEnd' | 'barrierRebuild'
   */
  playUI(type) {
    if (!this.isInitialized) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    switch (type) {
      case 'points':
        this._playPointsGain(now);
        break;
      case 'purchase':
        this._playPurchase(now);
        break;
      case 'roundStart':
        this._playRoundStart(now);
        break;
      case 'roundEnd':
        this._playRoundEnd(now);
        break;
      case 'barrierRebuild':
        this._playBarrierRebuild(now);
        break;
      default:
        break;
    }
  }

  /**
   * Points gain: Quick ascending tone (oscillator sweep up).
   * @private
   */
  _playPointsGain(now) {
    const ctx = this.audioContext;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(1600, now + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    osc.stop(now + 0.15);
  }

  /**
   * Purchase: Cash register-like ding (high oscillator with decay).
   * @private
   */
  _playPurchase(now) {
    const ctx = this.audioContext;

    // Main ding
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 2400;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.45);

    // Harmonic
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 3600;

    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.15, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc2.connect(gain2);
    gain2.connect(this.sfxGain);
    osc2.start(now);
    osc2.stop(now + 0.3);

    // Mechanical click
    this._playClick(now, 5000, 0.02, 0.25);
  }

  /**
   * Round start: Dramatic low horn with slow attack and reverb.
   * @private
   */
  _playRoundStart(now) {
    const ctx = this.audioContext;
    const duration = 2.5;

    // Low fundamental
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 65; // C2-ish

    const lp1 = ctx.createBiquadFilter();
    lp1.type = 'lowpass';
    lp1.frequency.setValueAtTime(200, now);
    lp1.frequency.linearRampToValueAtTime(400, now + 1.0);
    lp1.frequency.linearRampToValueAtTime(150, now + duration);

    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0.001, now);
    g1.gain.linearRampToValueAtTime(0.35, now + 0.8);
    g1.gain.setValueAtTime(0.3, now + 1.5);
    g1.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc1.connect(lp1);
    lp1.connect(g1);
    g1.connect(this.sfxGain);

    osc1.start(now);
    osc1.stop(now + duration + 0.1);

    // Minor fifth for tension
    const osc2 = ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.value = 77; // Eb2-ish (minor third)

    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 250;

    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.001, now + 0.1);
    g2.gain.linearRampToValueAtTime(0.2, now + 1.0);
    g2.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc2.connect(lp2);
    lp2.connect(g2);
    g2.connect(this.sfxGain);

    osc2.start(now + 0.1);
    osc2.stop(now + duration + 0.1);

    // Reverb noise tail
    const noise = this._createNoiseSource(duration);
    const noiseBP = ctx.createBiquadFilter();
    noiseBP.type = 'lowpass';
    noiseBP.frequency.value = 300;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.linearRampToValueAtTime(0.06, now + 0.5);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(noiseBP);
    noiseBP.connect(noiseGain);
    noiseGain.connect(this.sfxGain);

    noise.start(now);
    noise.stop(now + duration + 0.1);
  }

  /**
   * Round end: Short fanfare - ascending note sequence.
   * @private
   */
  _playRoundEnd(now) {
    const ctx = this.audioContext;
    const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
    const noteLength = 0.15;
    const gap = 0.12;

    for (let i = 0; i < notes.length; i++) {
      const startTime = now + i * (noteLength + gap);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = notes[i];

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + noteLength + 0.1);

      osc.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(startTime);
      osc.stop(startTime + noteLength + 0.15);

      // Harmonic overtone
      const harm = ctx.createOscillator();
      harm.type = 'sine';
      harm.frequency.value = notes[i] * 2;

      const harmGain = ctx.createGain();
      harmGain.gain.setValueAtTime(0.001, startTime);
      harmGain.gain.linearRampToValueAtTime(0.08, startTime + 0.02);
      harmGain.gain.exponentialRampToValueAtTime(0.001, startTime + noteLength);

      harm.connect(harmGain);
      harmGain.connect(this.sfxGain);
      harm.start(startTime);
      harm.stop(startTime + noteLength + 0.1);
    }
  }

  /**
   * Barrier rebuild: Wood creaking (filtered noise with resonance).
   * @private
   */
  _playBarrierRebuild(now) {
    const ctx = this.audioContext;
    const duration = 0.6;

    // Creaking noise
    const noise = this._createNoiseSource(duration + 0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(800, now);
    bp.frequency.linearRampToValueAtTime(1500, now + duration * 0.3);
    bp.frequency.linearRampToValueAtTime(600, now + duration);
    bp.Q.value = 8; // High resonance for creaking character

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.05);
    gain.gain.setValueAtTime(0.25, now + duration * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(bp);
    bp.connect(gain);
    gain.connect(this.sfxGain);

    noise.start(now);
    noise.stop(now + duration + 0.1);

    // Wood thud at the end (board snapping into place)
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(200, now + duration * 0.7);
    thud.frequency.exponentialRampToValueAtTime(80, now + duration * 0.7 + 0.06);

    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.3, now + duration * 0.7);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.7 + 0.08);

    thud.connect(thudGain);
    thudGain.connect(this.sfxGain);
    thud.start(now + duration * 0.7);
    thud.stop(now + duration + 0.1);
  }

  // =========================================================================
  // Ambient Sounds
  // =========================================================================

  /**
   * Start ambient sound loops (wind, distant thunder, creaking, dripping).
   */
  startAmbience() {
    if (!this.isInitialized) return;
    this.stopAmbience(); // Clear any existing ambience

    this._startWindLoop();
    this._startCreakingLoop();
    this._startDrippingLoop();
    this._startDistantThunderLoop();
  }

  /**
   * Stop all ambient sounds.
   */
  stopAmbience() {
    for (const src of this.ambientSources) {
      try {
        if (src.source && typeof src.source.stop === 'function') {
          src.source.stop();
        }
        if (src.osc && typeof src.osc.stop === 'function') {
          src.osc.stop();
        }
        if (src.lfo && typeof src.lfo.stop === 'function') {
          src.lfo.stop();
        }
      } catch (e) {
        // Already stopped
      }
      if (src.intervalId) {
        clearInterval(src.intervalId);
      }
      if (src.timeoutId) {
        clearTimeout(src.timeoutId);
      }
    }
    this.ambientSources = [];
  }

  /**
   * Wind: Slow-modulated filtered noise.
   * @private
   */
  _startWindLoop() {
    const ctx = this.audioContext;
    const duration = 8.0;

    const scheduleWind = () => {
      if (!this.isInitialized || !this.audioContext) return;
      const now = ctx.currentTime;

      const noise = this._createNoiseSource(duration + 1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 400;
      bp.Q.value = 0.5;

      // Slow modulation LFO on filter frequency
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.15 + Math.random() * 0.1;

      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 200;

      lfo.connect(lfoGain);
      lfoGain.connect(bp.frequency);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 2.0);
      gain.gain.setValueAtTime(0.1, now + duration - 2.0);
      gain.gain.linearRampToValueAtTime(0.001, now + duration);

      noise.connect(bp);
      bp.connect(gain);
      gain.connect(this.ambientGain);

      noise.start(now);
      noise.stop(now + duration + 1);
      lfo.start(now);
      lfo.stop(now + duration + 1);

      return { source: noise, lfo };
    };

    const entry = { source: null, lfo: null, intervalId: null };
    const initial = scheduleWind();
    if (initial) {
      entry.source = initial.source;
      entry.lfo = initial.lfo;
    }

    // Re-schedule looping wind
    entry.intervalId = setInterval(() => {
      const result = scheduleWind();
      if (result) {
        entry.source = result.source;
        entry.lfo = result.lfo;
      }
    }, (duration - 1) * 1000);

    this.ambientSources.push(entry);
  }

  /**
   * Creaking: Random metallic resonance at intervals.
   * @private
   */
  _startCreakingLoop() {
    const ctx = this.audioContext;
    const entry = { source: null, intervalId: null };

    const scheduleCreak = () => {
      if (!this.isInitialized || !this.audioContext) return;
      const now = ctx.currentTime;
      const duration = 0.3 + Math.random() * 0.4;

      const noise = this._createNoiseSource(duration + 0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1000 + Math.random() * 2000;
      bp.Q.value = 10 + Math.random() * 10;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.06 + Math.random() * 0.04, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(bp);
      bp.connect(gain);
      gain.connect(this.ambientGain);

      noise.start(now);
      noise.stop(now + duration + 0.1);

      entry.source = noise;
    };

    // Random interval between creaks (3-10 seconds)
    const scheduleNext = () => {
      const delay = 3000 + Math.random() * 7000;
      entry.intervalId = setTimeout(() => {
        scheduleCreak();
        scheduleNext();
      }, delay);
    };

    scheduleCreak();
    scheduleNext();
    this.ambientSources.push(entry);
  }

  /**
   * Dripping water: Periodic short high-pitched drops.
   * @private
   */
  _startDrippingLoop() {
    const ctx = this.audioContext;
    const entry = { osc: null, intervalId: null };

    const scheduleDrip = () => {
      if (!this.isInitialized || !this.audioContext) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const freq = 3000 + Math.random() * 2000;
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, now + 0.04);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      osc.connect(gain);
      gain.connect(this.ambientGain);

      osc.start(now);
      osc.stop(now + 0.08);

      entry.osc = osc;
    };

    // Drip interval: 1.5-4 seconds
    const scheduleNext = () => {
      const delay = 1500 + Math.random() * 2500;
      entry.intervalId = setTimeout(() => {
        scheduleDrip();
        scheduleNext();
      }, delay);
    };

    scheduleDrip();
    scheduleNext();
    this.ambientSources.push(entry);
  }

  /**
   * Distant thunder: Very low noise burst with long reverb, at long random intervals.
   * @private
   */
  _startDistantThunderLoop() {
    const ctx = this.audioContext;
    const entry = { source: null, intervalId: null };

    const scheduleThunder = () => {
      if (!this.isInitialized || !this.audioContext) return;
      const now = ctx.currentTime;
      const duration = 2.0 + Math.random() * 2.0;

      const noise = this._createNoiseSource(duration + 0.5);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 150 + Math.random() * 100;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.3);
      gain.gain.setValueAtTime(0.1, now + duration * 0.4);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      noise.connect(lp);
      lp.connect(gain);
      gain.connect(this.ambientGain);

      noise.start(now);
      noise.stop(now + duration + 0.5);

      // Sub-bass rumble
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = 30 + Math.random() * 20;

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.001, now);
      subGain.gain.linearRampToValueAtTime(0.1, now + 0.5);
      subGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      sub.connect(subGain);
      subGain.connect(this.ambientGain);

      sub.start(now);
      sub.stop(now + duration + 0.2);

      entry.source = noise;
    };

    // Thunder interval: 15-40 seconds
    const scheduleNext = () => {
      const delay = 15000 + Math.random() * 25000;
      entry.intervalId = setTimeout(() => {
        scheduleThunder();
        scheduleNext();
      }, delay);
    };

    // First thunder after a delay
    entry.timeoutId = setTimeout(() => {
      scheduleThunder();
      scheduleNext();
    }, 5000 + Math.random() * 10000);

    this.ambientSources.push(entry);
  }

  // =========================================================================
  // Music - Tension Drone
  // =========================================================================

  /**
   * Start the tension drone music. Intensity increases with round number.
   * Low sustained oscillator chord (minor), slowly evolving.
   * @private
   */
  _startMusic() {
    if (!this.isInitialized) return;
    this._stopMusic();

    const ctx = this.audioContext;
    this.musicState = { nodes: [], intervalId: null };

    const buildDrone = () => {
      if (!this.isInitialized || !this.audioContext) return;
      const now = ctx.currentTime;
      const duration = 12.0;
      const round = this.currentRound;

      // Intensity ramps with round (0.0 to 1.0 over ~20 rounds)
      const intensity = Math.min(1.0, (round - 1) / 20);

      // Root note: C2 = 65.41 Hz
      const root = 65.41;
      // Minor chord: root, minor third (Eb), fifth (G)
      const notes = [root, root * 1.189, root * 1.498];

      // Add dissonance at higher rounds: tritone, minor 2nd
      if (intensity > 0.3) {
        notes.push(root * 1.414); // tritone (F#)
      }
      if (intensity > 0.6) {
        notes.push(root * 1.059); // minor 2nd (Db)
      }

      const oscillators = [];

      for (let i = 0; i < notes.length; i++) {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? 'sawtooth' : 'triangle';
        osc.frequency.value = notes[i];

        // Slight detuning for width
        osc.detune.value = (Math.random() - 0.5) * 10;

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        const baseCutoff = 150 + intensity * 300;
        lp.frequency.setValueAtTime(baseCutoff, now);
        lp.frequency.linearRampToValueAtTime(baseCutoff + 100, now + duration * 0.5);
        lp.frequency.linearRampToValueAtTime(baseCutoff - 50, now + duration);

        const vol = (0.06 + intensity * 0.06) / notes.length;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(vol, now + 3.0);
        gain.gain.setValueAtTime(vol * 0.9, now + duration - 3.0);
        gain.gain.linearRampToValueAtTime(0.001, now + duration);

        osc.connect(lp);
        lp.connect(gain);
        gain.connect(this.musicGain);

        osc.start(now);
        osc.stop(now + duration + 0.5);

        oscillators.push(osc);
      }

      // Sub-bass pulse at higher intensity
      if (intensity > 0.2) {
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.value = root / 2;

        // Slow LFO for pulsation
        const pulseLFO = ctx.createOscillator();
        pulseLFO.type = 'sine';
        pulseLFO.frequency.value = 0.25 + intensity * 0.5;

        const pulseLFOGain = ctx.createGain();
        pulseLFOGain.gain.value = 0.03 + intensity * 0.03;

        const subGain = ctx.createGain();
        subGain.gain.setValueAtTime(0.001, now);
        subGain.gain.linearRampToValueAtTime(0.04 + intensity * 0.04, now + 2.0);
        subGain.gain.setValueAtTime(0.03 + intensity * 0.03, now + duration - 2.0);
        subGain.gain.linearRampToValueAtTime(0.001, now + duration);

        pulseLFO.connect(pulseLFOGain);
        pulseLFOGain.connect(subGain.gain);

        sub.connect(subGain);
        subGain.connect(this.musicGain);

        sub.start(now);
        sub.stop(now + duration + 0.5);
        pulseLFO.start(now);
        pulseLFO.stop(now + duration + 0.5);

        oscillators.push(sub, pulseLFO);
      }

      if (this.musicState) {
        this.musicState.nodes = oscillators;
      }
    };

    buildDrone();

    // Loop the drone with overlap
    this.musicState.intervalId = setInterval(() => {
      buildDrone();
    }, 10000);
  }

  /**
   * Stop the tension drone music.
   * @private
   */
  _stopMusic() {
    if (!this.musicState) return;

    if (this.musicState.intervalId) {
      clearInterval(this.musicState.intervalId);
    }

    for (const node of this.musicState.nodes) {
      try {
        if (typeof node.stop === 'function') {
          node.stop();
        }
      } catch (e) {
        // Already stopped
      }
    }

    this.musicState = null;
  }

  // =========================================================================
  // Generic Play Methods
  // =========================================================================

  /**
   * Play a named sound effect with options.
   * @param {string} soundName - Name of the sound
   * @param {object} [options] - Playback options
   * @param {number} [options.volume=1] - Volume multiplier 0-1
   * @param {number} [options.pitch=1] - Pitch multiplier (playback rate)
   * @param {number} [options.pan=0] - Stereo pan -1 to 1
   * @param {boolean} [options.loop=false] - Whether to loop
   * @param {{ x: number, y: number, z: number }} [options.position3D] - 3D position
   * @returns {object|null} Sound instance handle
   */
  playSound(soundName, options = {}) {
    if (!this.isInitialized) return null;

    const {
      volume = 1,
      pitch = 1,
      pan = 0,
      loop = false,
      position3D = null,
    } = options;

    // Map sound names to synthesis functions
    const soundMap = {
      gunshot_pistol: () => this.playGunshot('pistol'),
      gunshot_rifle: () => this.playGunshot('rifle'),
      gunshot_smg: () => this.playGunshot('smg'),
      gunshot_shotgun: () => this.playGunshot('shotgun'),
      gunshot_raygun: () => this.playGunshot('special'),
      gunshot_lmg: () => this.playGunshot('lmg'),
      reload: () => this.playReload('rifle'),
      zombie_growl: () => this.playZombieSound('growl', position3D),
      zombie_moan: () => this.playZombieSound('moan', position3D),
      zombie_attack: () => this.playZombieSound('attack', position3D),
      zombie_death: () => this.playZombieSound('death', position3D),
      zombie_horde: () => this.playZombieSound('horde', position3D),
      impact_wall: () => this.playImpact('wall'),
      impact_flesh: () => this.playImpact('flesh'),
      impact_headshot: () => this.playImpact('headshot'),
      ui_points: () => this.playUI('points'),
      ui_purchase: () => this.playUI('purchase'),
      ui_round_start: () => this.playUI('roundStart'),
      ui_round_end: () => this.playUI('roundEnd'),
      ui_barrier: () => this.playUI('barrierRebuild'),
    };

    const fn = soundMap[soundName];
    if (fn) {
      fn();
      return { name: soundName };
    }

    console.warn(`[AudioManager] Unknown sound: ${soundName}`);
    return null;
  }

  // =========================================================================
  // 3D Audio Helpers
  // =========================================================================

  /**
   * Compute volume attenuation and stereo pan for a 3D position
   * relative to the current listener.
   * @param {{ x: number, y: number, z: number }} position
   * @returns {{ volume: number, pan: number }}
   * @private
   */
  _computeSpatial(position) {
    const dx = position.x - this.listenerPos.x;
    const dy = position.y - this.listenerPos.y;
    const dz = position.z - this.listenerPos.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Inverse-distance-squared attenuation
    let volume;
    if (distance <= REF_DISTANCE) {
      volume = 1.0;
    } else if (distance >= MAX_DISTANCE) {
      volume = 0.0;
    } else {
      volume = REF_DISTANCE / (REF_DISTANCE + ROLLOFF * (distance - REF_DISTANCE));
    }

    // Stereo pan based on angle to listener's right vector
    let pan = 0;
    if (distance > 0.01) {
      const nx = dx / distance;
      const nz = dz / distance;
      // Dot with listener right vector gives panning
      pan = nx * this.listenerRight.x + nz * this.listenerRight.z;
      pan = Math.max(-1, Math.min(1, pan));
    }

    return { volume, pan };
  }

  /**
   * Update 3D audio positions and clean up finished sounds. Called each frame.
   * @param {number} deltaTime
   */
  update(deltaTime) {
    if (!this.isInitialized) return;

    // Update listener position from camera
    if (this.camera) {
      const pos = this.camera.position;
      this.listenerPos.x = pos.x;
      this.listenerPos.y = pos.y;
      this.listenerPos.z = pos.z;

      // Forward vector from camera quaternion
      // Camera looks down -Z in local space
      const q = this.camera.quaternion;
      // Compute forward (-Z axis rotated by quaternion)
      const fx = 2 * (q.x * q.z + q.w * q.y);
      const fy = 2 * (q.y * q.z - q.w * q.x);
      const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      this.listenerForward.x = -fx;
      this.listenerForward.y = -fy;
      this.listenerForward.z = -fz;

      // Right vector (X axis rotated by quaternion)
      const rx = 1 - 2 * (q.y * q.y + q.z * q.z);
      const ry = 2 * (q.x * q.y + q.w * q.z);
      const rz = 2 * (q.x * q.z - q.w * q.y);
      this.listenerRight.x = rx;
      this.listenerRight.y = ry;
      this.listenerRight.z = rz;
    }

    // Update active 3D sounds
    const now = this.audioContext.currentTime;
    for (let i = this.activeSounds.length - 1; i >= 0; i--) {
      const snd = this.activeSounds[i];

      // Remove finished sounds
      if (now > snd.startTime + snd.duration) {
        this.activeSounds.splice(i, 1);
        continue;
      }

      // Update spatial parameters
      const spatial = this._computeSpatial(snd.position);
      snd.gainNode.gain.value = spatial.volume;
      snd.pannerNode.pan.value = spatial.pan;
    }
  }

  // =========================================================================
  // Volume Controls
  // =========================================================================

  /**
   * Set master volume.
   * @param {number} v - Volume 0-1
   */
  setMasterVolume(v) {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, v));
    }
  }

  /**
   * Set SFX volume.
   * @param {number} v - Volume 0-1
   */
  setSFXVolume(v) {
    if (this.sfxGain) {
      this.sfxGain.gain.value = Math.max(0, Math.min(1, v));
    }
  }

  /**
   * Set music volume.
   * @param {number} v - Volume 0-1
   */
  setMusicVolume(v) {
    if (this.musicGain) {
      this.musicGain.gain.value = Math.max(0, Math.min(1, v));
    }
  }

  /**
   * Set ambient volume.
   * @param {number} v - Volume 0-1
   */
  setAmbientVolume(v) {
    if (this.ambientGain) {
      this.ambientGain.gain.value = Math.max(0, Math.min(1, v));
    }
  }

  // =========================================================================
  // Utility
  // =========================================================================

  /**
   * Create a BufferSourceNode loaded with white noise.
   * @param {number} duration - Duration in seconds
   * @returns {AudioBufferSourceNode}
   * @private
   */
  _createNoiseSource(duration) {
    const ctx = this.audioContext;

    // Use a pre-generated buffer if one is close enough in duration
    let buffer = null;
    if (duration <= 0.12) {
      buffer = this.buffers.get('whiteNoise_0.1');
    } else if (duration <= 0.25) {
      buffer = this.buffers.get('whiteNoise_0.2');
    } else if (duration <= 0.6) {
      buffer = this.buffers.get('whiteNoise_0.5');
    } else if (duration <= 1.2) {
      buffer = this.buffers.get('whiteNoise_1.0');
    } else if (duration <= 2.5) {
      buffer = this.buffers.get('whiteNoise_2.0');
    }

    // Fall back to generating a new buffer
    if (!buffer) {
      buffer = this.createWhiteNoise(duration);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    return source;
  }

  /**
   * Reset the audio manager (on game restart).
   */
  reset() {
    this.stopAmbience();
    this._stopMusic();
    this.activeSounds = [];
    this.currentRound = 1;
  }

  /**
   * Dispose of all audio resources.
   */
  dispose() {
    this.stopAmbience();
    this._stopMusic();
    this.activeSounds = [];

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }

    document.removeEventListener('click', this._gestureHandler);
    document.removeEventListener('keydown', this._gestureHandler);

    this.isInitialized = false;
    console.log('[AudioManager] Disposed.');
  }
}
