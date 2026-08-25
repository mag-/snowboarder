// Everything is synthesised — no audio assets to ship.

function noiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02; // brown-ish, less hissy
    data[i] = last * 3.2 + white * 0.25;
  }
  return buf;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
  }

  start() {
    if (this.started || !this.enabled) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.started = true;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    const buf = noiseBuffer(ctx);

    // Wind: broad low rumble that rises with speed.
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = buf;
    this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 420;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.windSrc.start();

    // Edge: narrow band that opens up as the board bites.
    this.carveSrc = ctx.createBufferSource();
    this.carveSrc.buffer = buf;
    this.carveSrc.loop = true;
    this.carveFilter = ctx.createBiquadFilter();
    this.carveFilter.type = 'bandpass';
    this.carveFilter.frequency.value = 1400;
    this.carveFilter.Q.value = 1.4;
    this.carveGain = ctx.createGain();
    this.carveGain.gain.value = 0;
    this.carveSrc.connect(this.carveFilter).connect(this.carveGain).connect(this.master);
    this.carveSrc.start();

    this.noiseBuf = buf;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(muted) {
    this.enabled = !muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  update(rider, dt) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const speed01 = Math.min(1, rider.speed / 30);
    const airborne = rider.grounded ? 0 : 1;

    this.windGain.gain.setTargetAtTime(0.055 + speed01 * 0.16, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + speed01 * 900, t, 0.2);

    const bite = rider.grounded ? Math.abs(rider.carve) * speed01 : 0;
    this.carveGain.gain.setTargetAtTime(bite * 0.13 * (1 - airborne), t, 0.06);
    this.carveFilter.frequency.setTargetAtTime(900 + bite * 2600, t, 0.08);
  }

  _burst({ duration = 0.35, freq = 260, type = 'lowpass', gain = 0.35, q = 1 }) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  land(power) {
    this._burst({ duration: 0.3, freq: 180 + power * 220, gain: 0.18 + power * 0.22 });
  }

  ollie() {
    this._burst({ duration: 0.18, freq: 1800, type: 'bandpass', gain: 0.1, q: 0.8 });
  }

  crash() {
    this._burst({ duration: 0.7, freq: 500, gain: 0.32 });
  }

  chime() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [880, 1320].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.06);
      g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.06 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.06 + 0.5);
      osc.connect(g).connect(this.master);
      osc.start(t + i * 0.06);
      osc.stop(t + i * 0.06 + 0.55);
    });
  }
}
