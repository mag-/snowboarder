const STEER_KEYS_LEFT = ['ArrowLeft', 'KeyA'];
const STEER_KEYS_RIGHT = ['ArrowRight', 'KeyD'];

export class Input {
  constructor(target) {
    this.keys = new Set();
    this.steer = 0;
    this.tuck = false;
    this.grab = false;
    this.jump = false;      // edge-triggered, cleared by consume()
    this._jumpQueued = false;
    this.actions = [];      // one-shot named actions (pause, restart, ...)

    this.pointerSteer = 0;
    this._pointerId = null;
    this._pointerStartX = 0;
    this._pointerStartT = 0;
    this._pointerMoved = 0;

    const onKeyDown = (e) => {
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      if (e.code === 'Space') {
        this._jumpQueued = true;
        e.preventDefault();
      }
      if (e.code === 'KeyP' || e.code === 'Escape') this.actions.push('pause');
      if (e.code === 'KeyR') this.actions.push('restart');
      if (e.code === 'KeyM') this.actions.push('mute');
      if (e.code === 'KeyH') this.actions.push('hud');
      if (e.code === 'KeyC') this.actions.push('camera');
      if (STEER_KEYS_LEFT.includes(e.code) || STEER_KEYS_RIGHT.includes(e.code)) {
        e.preventDefault();
      }
    };
    const onKeyUp = (e) => this.keys.delete(e.code);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());

    // Touch / mouse drag: slide to carve, tap to ollie.
    target.addEventListener('pointerdown', (e) => {
      if (this._pointerId !== null) return;
      this._pointerId = e.pointerId;
      this._pointerStartX = e.clientX;
      this._pointerStartT = performance.now();
      this._pointerMoved = 0;
      target.setPointerCapture?.(e.pointerId);
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._pointerId) return;
      const dx = e.clientX - this._pointerStartX;
      this._pointerMoved = Math.max(this._pointerMoved, Math.abs(dx));
      const span = Math.max(90, Math.min(220, window.innerWidth * 0.18));
      this.pointerSteer = Math.max(-1, Math.min(1, dx / span));
    });
    const endPointer = (e) => {
      if (e.pointerId !== this._pointerId) return;
      const quick = performance.now() - this._pointerStartT < 260;
      if (quick && this._pointerMoved < 12) this._jumpQueued = true;
      this._pointerId = null;
      this.pointerSteer = 0;
    };
    target.addEventListener('pointerup', endPointer);
    target.addEventListener('pointercancel', endPointer);
  }

  /** Samples the current frame's control state. */
  poll() {
    let s = 0;
    for (const k of STEER_KEYS_LEFT) if (this.keys.has(k)) s -= 1;
    for (const k of STEER_KEYS_RIGHT) if (this.keys.has(k)) s += 1;
    if (s === 0) s = this.pointerSteer;

    // Screen space is mirrored against world X: the chase camera looks down +Z,
    // so world +X lands on the left of the frame. Flip once here and every
    // downstream sign — yaw, body lean, spray side, camera offset — follows, so
    // D carves right on screen and leans into that turn.
    this.steer = -Math.max(-1, Math.min(1, s));

    this.tuck =
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      this.keys.has('ArrowUp') ||
      this.keys.has('KeyW');
    this.grab =
      this.keys.has('ArrowDown') ||
      this.keys.has('KeyS') ||
      this.keys.has('ControlLeft');

    this.jump = this._jumpQueued;
    this._jumpQueued = false;
    return this;
  }

  takeActions() {
    const a = this.actions.slice();
    this.actions.length = 0;
    return a;
  }
}
