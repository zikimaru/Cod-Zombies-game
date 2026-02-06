/**
 * InputManager - Handles keyboard input, mouse input, and pointer lock API.
 * Provides per-frame key press detection, continuous key hold detection,
 * mouse movement deltas, and mouse button state.
 */
export class InputManager {
  constructor() {
    /**
     * Current state of all keys. true = held down.
     * @type {Map<string, boolean>}
     */
    this.keys = new Map();

    /**
     * Keys that were pressed THIS frame (single-fire detection).
     * @type {Set<string>}
     */
    this.keysPressed = new Set();

    /**
     * Keys that were released THIS frame.
     * @type {Set<string>}
     */
    this.keysReleased = new Set();

    /**
     * Buffer for keys pressed between update() calls.
     * Prevents missed inputs between frames.
     * @type {Set<string>}
     */
    this._keyPressBuffer = new Set();

    /**
     * Buffer for keys released between update() calls.
     * @type {Set<string>}
     */
    this._keyReleaseBuffer = new Set();

    /**
     * Mouse button state. Index = button number (0=left, 1=middle, 2=right).
     * @type {Map<number, boolean>}
     */
    this.mouseButtons = new Map();

    /**
     * Mouse buttons pressed THIS frame.
     * @type {Set<number>}
     */
    this.mouseButtonsPressed = new Set();

    /**
     * Buffer for mouse buttons pressed between update() calls.
     * @type {Set<number>}
     */
    this._mouseButtonPressBuffer = new Set();

    /**
     * Accumulated mouse movement since last getMouseDelta() call.
     * @type {{ x: number, y: number }}
     */
    this.mouseDelta = { x: 0, y: 0 };

    /**
     * Whether the pointer is currently locked.
     * @type {boolean}
     */
    this.isPointerLocked = false;

    /**
     * The element to attach pointer lock to.
     * @type {HTMLElement}
     */
    this.lockTarget = document.body;

    // Bound event handlers (stored for removal in dispose)
    this._boundHandlers = {};

    this._initListeners();
  }

  /**
   * Initialize all event listeners for keyboard, mouse, and pointer lock.
   * @private
   */
  _initListeners() {
    // Keyboard handlers
    this._boundHandlers.keydown = this._onKeyDown.bind(this);
    this._boundHandlers.keyup = this._onKeyUp.bind(this);
    window.addEventListener('keydown', this._boundHandlers.keydown);
    window.addEventListener('keyup', this._boundHandlers.keyup);

    // Mouse handlers
    this._boundHandlers.mousedown = this._onMouseDown.bind(this);
    this._boundHandlers.mouseup = this._onMouseUp.bind(this);
    this._boundHandlers.mousemove = this._onMouseMove.bind(this);
    this._boundHandlers.contextmenu = (e) => e.preventDefault();
    window.addEventListener('mousedown', this._boundHandlers.mousedown);
    window.addEventListener('mouseup', this._boundHandlers.mouseup);
    window.addEventListener('mousemove', this._boundHandlers.mousemove);
    window.addEventListener('contextmenu', this._boundHandlers.contextmenu);

    // Pointer lock handlers
    this._boundHandlers.pointerlockchange = this._onPointerLockChange.bind(this);
    this._boundHandlers.pointerlockerror = this._onPointerLockError.bind(this);
    document.addEventListener('pointerlockchange', this._boundHandlers.pointerlockchange);
    document.addEventListener('pointerlockerror', this._boundHandlers.pointerlockerror);
  }

  /**
   * Handle keydown events.
   * @param {KeyboardEvent} event
   * @private
   */
  _onKeyDown(event) {
    const key = event.code;

    // Only register as "pressed" if it wasn't already held
    if (!this.keys.get(key)) {
      this._keyPressBuffer.add(key);
    }

    this.keys.set(key, true);

    // Prevent default for game-relevant keys to stop browser behavior
    const preventDefaults = [
      'Tab', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'KeyR', 'KeyE', 'KeyQ', 'KeyF', 'Digit1', 'Digit2',
      'ShiftLeft', 'ShiftRight',
    ];
    if (preventDefaults.includes(key)) {
      event.preventDefault();
    }
  }

  /**
   * Handle keyup events.
   * @param {KeyboardEvent} event
   * @private
   */
  _onKeyUp(event) {
    const key = event.code;
    this.keys.set(key, false);
    this._keyReleaseBuffer.add(key);
  }

  /**
   * Handle mousedown events.
   * @param {MouseEvent} event
   * @private
   */
  _onMouseDown(event) {
    this.mouseButtons.set(event.button, true);

    if (!this.mouseButtonsPressed.has(event.button)) {
      this._mouseButtonPressBuffer.add(event.button);
    }
  }

  /**
   * Handle mouseup events.
   * @param {MouseEvent} event
   * @private
   */
  _onMouseUp(event) {
    this.mouseButtons.set(event.button, false);
  }

  /**
   * Handle mousemove events. Accumulates delta while pointer is locked.
   * @param {MouseEvent} event
   * @private
   */
  _onMouseMove(event) {
    if (this.isPointerLocked) {
      this.mouseDelta.x += event.movementX || 0;
      this.mouseDelta.y += event.movementY || 0;
    }
  }

  /**
   * Handle pointer lock state changes.
   * @private
   */
  _onPointerLockChange() {
    this.isPointerLocked = document.pointerLockElement === this.lockTarget;

    if (!this.isPointerLocked) {
      // Clear mouse delta when pointer lock is lost to prevent jumps
      this.mouseDelta.x = 0;
      this.mouseDelta.y = 0;
    }
  }

  /**
   * Handle pointer lock errors.
   * @private
   */
  _onPointerLockError() {
    console.warn('InputManager: Pointer lock request failed.');
  }

  /**
   * Request pointer lock on the lock target element.
   */
  requestPointerLock() {
    if (!this.isPointerLocked && this.lockTarget.requestPointerLock) {
      this.lockTarget.requestPointerLock();
    }
  }

  /**
   * Release pointer lock.
   */
  releasePointerLock() {
    if (this.isPointerLocked && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  /**
   * Check if a key is currently held down.
   * @param {string} keyCode - The KeyboardEvent.code value (e.g., 'KeyW', 'Space')
   * @returns {boolean}
   */
  isKeyDown(keyCode) {
    return this.keys.get(keyCode) === true;
  }

  /**
   * Check if a key was pressed THIS frame (single-frame detection).
   * Useful for actions that should only fire once per key press (reload, use, etc.).
   * @param {string} keyCode - The KeyboardEvent.code value
   * @returns {boolean}
   */
  isKeyPressed(keyCode) {
    return this.keysPressed.has(keyCode);
  }

  /**
   * Check if a key was released THIS frame.
   * @param {string} keyCode - The KeyboardEvent.code value
   * @returns {boolean}
   */
  isKeyReleased(keyCode) {
    return this.keysReleased.has(keyCode);
  }

  /**
   * Check if a mouse button is currently held down.
   * @param {number} button - 0=left, 1=middle, 2=right
   * @returns {boolean}
   */
  isMouseButtonDown(button) {
    return this.mouseButtons.get(button) === true;
  }

  /**
   * Check if a mouse button was pressed THIS frame.
   * @param {number} button - 0=left, 1=middle, 2=right
   * @returns {boolean}
   */
  isMouseButtonPressed(button) {
    return this.mouseButtonsPressed.has(button);
  }

  /**
   * Get the accumulated mouse movement delta since last call, then reset.
   * @returns {{ x: number, y: number }}
   */
  getMouseDelta() {
    const delta = { x: this.mouseDelta.x, y: this.mouseDelta.y };
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    return delta;
  }

  /**
   * Update per-frame input state. Must be called at the START of each game loop tick.
   * Flushes the press/release buffers into the per-frame sets so systems can
   * query isKeyPressed / isKeyReleased during the frame.
   */
  update() {
    // Move buffered presses into the per-frame sets
    this.keysPressed.clear();
    for (const key of this._keyPressBuffer) {
      this.keysPressed.add(key);
    }
    this._keyPressBuffer.clear();

    this.keysReleased.clear();
    for (const key of this._keyReleaseBuffer) {
      this.keysReleased.add(key);
    }
    this._keyReleaseBuffer.clear();

    this.mouseButtonsPressed.clear();
    for (const btn of this._mouseButtonPressBuffer) {
      this.mouseButtonsPressed.add(btn);
    }
    this._mouseButtonPressBuffer.clear();
  }

  /**
   * Clean up all event listeners.
   */
  dispose() {
    window.removeEventListener('keydown', this._boundHandlers.keydown);
    window.removeEventListener('keyup', this._boundHandlers.keyup);
    window.removeEventListener('mousedown', this._boundHandlers.mousedown);
    window.removeEventListener('mouseup', this._boundHandlers.mouseup);
    window.removeEventListener('mousemove', this._boundHandlers.mousemove);
    window.removeEventListener('contextmenu', this._boundHandlers.contextmenu);
    document.removeEventListener('pointerlockchange', this._boundHandlers.pointerlockchange);
    document.removeEventListener('pointerlockerror', this._boundHandlers.pointerlockerror);

    this.keys.clear();
    this.keysPressed.clear();
    this.keysReleased.clear();
    this._keyPressBuffer.clear();
    this._keyReleaseBuffer.clear();
    this.mouseButtons.clear();
    this.mouseButtonsPressed.clear();
    this._mouseButtonPressBuffer.clear();
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;

    this.releasePointerLock();
  }
}
