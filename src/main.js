import * as THREE from 'three';
import { CAMERA, FOG_FAR, FOG_NEAR, PALETTE } from './config.js';
import { Terrain, terrainHeight } from './terrain.js';
import { Scenery, buildBackdrop, buildSky } from './scenery.js';
import { Rider } from './rider.js';
import { Effects } from './particles.js';
import { Input } from './input.js';
import { Hud, trickName } from './hud.js';
import { Audio } from './audio.js';

const STORE_KEY = 'powder-line-best';

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(PALETTE.haze, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(CAMERA.baseFov, 1, 0.5, 9000);
    this.camera.position.set(0, 6, -10);

    this._setupLights();

    this.sky = buildSky();
    this.scene.add(this.sky);
    this.backdrop = buildBackdrop();
    this.scene.add(this.backdrop);

    this.scenery = new Scenery(this.scene);
    this.terrain = new Terrain(this.scene);
    this.terrain.onRebuild = (chunk, index) => this.scenery.populate(chunk, index);
    this.terrain.reset();

    this.rider = new Rider(this.scene);
    this.effects = new Effects(this.scene);
    this.hud = new Hud();
    this.audio = new Audio();
    this.input = new Input(canvas);

    this.state = 'ready';
    this.score = 0;
    this.flow = 0;          // seconds of clean carving
    this.multiplier = 1;
    this.muted = false;
    this.chaseCam = true;
    this.camYaw = 0;
    this.events = [];
    this.stats = { crashes: 0, rescues: 0, frames: 0, airs: 0, byTree: 0, byLanding: 0, maxAir: 0 };
    this._obstacles = [];
    this._chimneys = [];
    this._camPos = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this.best = this._loadBest();

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._showTitle();

    this._lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _setupLights() {
    // Blue sky bounce keeps shadowed snow cold rather than grey.
    const hemi = new THREE.HemisphereLight(0xb6d6f4, 0xa6c4e2, 1.0);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(PALETTE.sun, 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -46;
    c.right = 46;
    c.top = 46;
    c.bottom = -46;
    c.near = 20;
    c.far = 260;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.05;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  _loadBest() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || { score: 0, distance: 0 };
    } catch {
      return { score: 0, distance: 0 };
    }
  }

  _saveBest() {
    const best = {
      score: Math.max(this.best.score, Math.round(this.score)),
      distance: Math.max(this.best.distance, this.rider.distance),
    };
    this.best = best;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(best));
    } catch {
      /* private browsing — best stays in memory */
    }
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Pixels per metre at one metre from the camera.
    const scale = h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.effects.spray.material.uniforms.uScale.value = scale;
    this.effects.smoke.material.uniforms.uScale.value = scale;
  }

  _showTitle() {
    const bestLine =
      this.best.score > 0
        ? `<p class="best">Best run · ${this.best.score.toLocaleString()} pts · ${(
            this.best.distance / 1000
          ).toFixed(2)} km</p>`
        : '';
    this.hud.showOverlay(`
      <div class="panel">
        <h1>Powder<span>Line</span></h1>
        <p class="tag">An endless alpine descent</p>
        <div class="keys keyboard-only">
          <div><kbd>A</kbd><kbd>D</kbd><span>carve</span></div>
          <div><kbd>Space</kbd><span>ollie</span></div>
          <div><kbd>Shift</kbd><span>tuck</span></div>
          <div><kbd>S</kbd><span>grab</span></div>
        </div>
        <div class="keys touch-only">
          <div><span>drag left / right to carve</span></div>
          <div><span>tap to ollie</span></div>
        </div>
        ${bestLine}
        <button id="startBtn">Drop in</button>
        <p class="hint">
          Hold a carve to build <b>flow</b> and multiply your score.
          Spin off a kicker and land it pointing downhill.
          <span class="keyboard-only"><br /><kbd>P</kbd> pause · <kbd>R</kbd> restart · <kbd>H</kbd> hide HUD · <kbd>M</kbd> mute · <kbd>C</kbd> camera</span>
        </p>
      </div>
    `);
    document.getElementById('startBtn').addEventListener('click', () => this._start());
  }

  _start() {
    this.audio.start();
    this.audio.resume();
    this.hud.hideOverlay();
    this.state = 'playing';
    this.score = 0;
    this.flow = 0;
    this.multiplier = 1;
    this.rider.distance = 0;
    this.rider.topSpeed = 0;
    this.canvas.focus();
  }

  _pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.hud.showOverlay(`
      <div class="panel">
        <h2>Paused</h2>
        <div class="stats">
          <div><b>${Math.round(this.score).toLocaleString()}</b><span>points</span></div>
          <div><b>${(this.rider.distance / 1000).toFixed(2)}</b><span>km</span></div>
          <div><b>${Math.round(this.rider.topSpeed * 3.6)}</b><span>top km/h</span></div>
        </div>
        <button id="resumeBtn">Resume</button>
        <p class="hint"><kbd>R</kbd> restart the run</p>
      </div>
    `);
    document.getElementById('resumeBtn').addEventListener('click', () => this._resume());
    this._saveBest();
  }

  _resume() {
    this.hud.hideOverlay();
    this.state = 'playing';
    this.audio.resume();
  }

  _restart() {
    this._saveBest();
    this.rider.reset();
    this.terrain.reset();
    this.score = 0;
    this.flow = 0;
    this.multiplier = 1;
    this.hud._shownScore = 0;
    this.hud.hideOverlay();
    this.state = 'playing';
  }

  _handleActions() {
    for (const action of this.input.takeActions()) {
      if (action === 'pause') {
        if (this.state === 'playing') this._pause();
        else if (this.state === 'paused') this._resume();
        else if (this.state === 'ready') this._start();
      } else if (action === 'restart') {
        if (this.state !== 'ready') this._restart();
      } else if (action === 'mute') {
        this.muted = !this.muted;
        this.audio.setMuted(this.muted);
      } else if (action === 'hud') {
        this.hud.toggle();
      } else if (action === 'camera') {
        this.chaseCam = !this.chaseCam;
      }
    }
  }

  _scoreEvents(dt) {
    const rider = this.rider;
    for (const ev of this.events) {
      if (ev.type === 'ollie') {
        this.audio.ollie();
      } else if (ev.type === 'crash') {
        this.stats.crashes++;
        if (ev.reason === 'tree') this.stats.byTree++;
        else this.stats.byLanding++;
        this.hud.hit();
        this.hud.toast('Wipeout!', 'flow lost');
        this.audio.crash();
        this.effects.burst(rider.pos.x, rider.pos.y + 0.4, rider.pos.z, 60, 1.5);
        this.flow = 0;
        this.multiplier = 1;
      } else if (ev.type === 'land') {
        if (ev.airTime > 0.3) this.stats.airs++;
        this.stats.maxAir = Math.max(this.stats.maxAir, ev.airTime);
        this.effects.burst(rider.pos.x, rider.pos.y + 0.1, rider.pos.z, 18 + ev.airTime * 26, 1);
        this.audio.land(Math.min(1, ev.airTime));
        if (this.state !== 'playing') continue;

        const spins = ev.spins;
        const airPts = ev.airTime * 210;
        const spinPts = spins * 620;
        const grabPts = ev.grabbed ? 180 + ev.airTime * 90 : 0;
        // A scrappy landing still pays — you kept your feet.
        const quality = 0.45 + 0.55 * ev.cleanliness;
        const gained = (airPts + spinPts + grabPts) * quality * this.multiplier;
        this.score += gained;

        const name = trickName(spins, ev.grabbed, ev.spinDir);
        if (name) {
          this.hud.toast(name, `+${Math.round(gained)}`);
          this.audio.chime();
        } else if (ev.airTime > 0.55) {
          this.hud.toast(`${ev.airTime.toFixed(1)}s air`, `+${Math.round(gained)}`);
        }
      }
    }
    this.events.length = 0;

    if (this.state !== 'playing') return;

    // Flow builds while you hold a clean, committed carve.
    const carving = rider.grounded && Math.abs(rider.carve) > 0.25 && !rider.wiping;
    if (carving) {
      this.flow = Math.min(30, this.flow + dt);
      this.score += rider.speed * dt * 0.9 * this.multiplier * Math.abs(rider.carve);
    } else if (!rider.wiping) {
      this.flow = Math.max(0, this.flow - dt * 0.55);
    }
    const nextMult = 1 + Math.min(4, Math.floor(this.flow / 3) * 0.5);
    if (nextMult > this.multiplier) this.audio.chime();
    this.multiplier = nextMult;
    this.score += rider.speed * dt * 0.12; // steady distance trickle
  }

  _collide() {
    const rider = this.rider;
    if (rider.wiping || !rider.grounded) return;
    this.scenery.collectObstacles(rider.pos.z, 9, this._obstacles);
    for (const o of this._obstacles) {
      const dx = o.x - rider.pos.x;
      const dz = o.z - rider.pos.z;
      const r = o.radius + 0.25;
      if (dx * dx + dz * dz < r * r) {
        if (rider.wipeout()) this.events.push({ type: 'crash', reason: 'tree' });
        return;
      }
    }
  }

  _updateCamera(dt) {
    const rider = this.rider;

    // The camera only partly follows the board's heading. Tracking it fully
    // throws the horizon on its side through every carve; lagging it keeps the
    // fall line in view and lets the rider swing across the frame.
    const targetYaw = rider.yaw * CAMERA.headingFollow;
    this.camYaw += (targetYaw - this.camYaw) * (1 - Math.exp(-4.5 * dt));
    const dirX = Math.sin(this.camYaw);
    const dirZ = Math.cos(this.camYaw);

    if (this.chaseCam) {
      this._camPos.set(
        rider.pos.x - dirX * CAMERA.distance - dirZ * rider.carve * 1.6,
        rider.pos.y + CAMERA.height,
        rider.pos.z - dirZ * CAMERA.distance + dirX * rider.carve * 1.6
      );
    } else {
      // Fixed-heading "cinematic" cam: stays square to the fall line.
      this._camPos.set(
        rider.pos.x - rider.carve * 2.4,
        rider.pos.y + CAMERA.height + 0.6,
        rider.pos.z - CAMERA.distance
      );
    }

    // Never let the camera clip into the slope behind the rider.
    const groundAtCam = terrainHeight(this._camPos.x, this._camPos.z) + 1.4;
    if (this._camPos.y < groundAtCam) this._camPos.y = groundAtCam;

    const k = 1 - Math.exp(-CAMERA.stiffness * dt);
    this.camera.position.lerp(this._camPos, k);

    this._camTarget.set(
      rider.pos.x + dirX * CAMERA.lookAhead,
      rider.pos.y + 1.5 + (rider.grounded ? 0 : 0.4),
      rider.pos.z + dirZ * CAMERA.lookAhead
    );
    this._tmp.copy(this._camTarget);
    this.camera.lookAt(this._tmp);

    // A touch of speed-driven FOV and roll for the sense of rushing snow.
    const speed01 = Math.min(1, rider.speed / 30);
    const targetFov = CAMERA.baseFov + speed01 * CAMERA.speedFov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.rotation.z += rider.carve * 0.045;
    this.camera.updateProjectionMatrix();
  }

  _frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._lastTime) / 1000);
    this._lastTime = now;
    this._handleActions();
    const input = this.input.poll();

    const active = this.state === 'playing';
    const controls = active
      ? input
      : { steer: 0, tuck: false, grab: false, jump: false };

    if (this.state !== 'paused') {
      this.rider.update(dt, controls, this.events);
      this._collide();
      if (this.rider.needsRescue) {
        this.rider.rescue();
        this.stats.rescues++;
        this.flow = 0;
        this.multiplier = 1;
        if (this.state === 'playing') this.hud.toast('Back on piste', null);
      }
      this._scoreEvents(dt);

      this.terrain.update(this.rider.pos.z);
      this.effects.emitCarve(this.rider, dt);
      this.scenery.collectChimneys(this.rider.pos.z, 260, this._chimneys);
      this.effects.emitSmoke(this._chimneys, dt);
      this.effects.update(dt);
      this._updateCamera(dt);
      this.audio.update(this.rider, dt);
    }

    // Sky and painted peaks ride along so they read as infinitely distant.
    this.sky.position.copy(this.camera.position);
    this.backdrop.position.set(this.camera.position.x, this.rider.pos.y, this.camera.position.z);

    // Keep the shadow volume centred on the rider.
    const r = this.rider.pos;
    // Sun over the rider's left shoulder and slightly down-valley, so shadows
    // rake across the piste towards the camera like the reference footage.
    this.sun.position.set(r.x - 50, r.y + 88, r.z + 34);
    this.sun.target.position.copy(r);
    this.sun.target.updateMatrixWorld();

    this.hud.setStats(this.rider.speed * 3.6, this.rider.distance, this.score);
    this.hud.setCombo(this.multiplier, (this.flow % 3) / 3);

    this.stats.frames++;
    this.renderer.render(this.scene, this.camera);
  }
}

const canvas = document.getElementById('game');
try {
  window.game = new Game(canvas);
} catch (err) {
  console.error(err);
  document.getElementById('overlay').classList.add('active');
  document.getElementById('overlay').innerHTML = `
    <div class="panel">
      <h2>Could not start</h2>
      <p class="tag">${err && err.message ? err.message : err}</p>
      <p class="hint">This game needs WebGL2. Try a recent Chrome, Firefox or Safari.</p>
    </div>`;
}
