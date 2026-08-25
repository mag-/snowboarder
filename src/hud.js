// The board's heading is its direction of travel, so only whole rotations can
// be landed — half spins would leave the rider riding back up the hill.

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.speedEl = document.getElementById('speed');
    this.distEl = document.getElementById('distance');
    this.scoreEl = document.getElementById('score');
    this.comboEl = document.getElementById('combo');
    this.popups = document.getElementById('popups');
    this.overlay = document.getElementById('overlay');
    this.flash = document.getElementById('flash');
    this.visible = true;
    this._shownScore = 0;
  }

  setStats(speedKmh, distance, score) {
    this.speedEl.textContent = Math.round(speedKmh);
    this.distEl.textContent = `${(distance / 1000).toFixed(2)} km`;
    // Ease the score upward so big tricks read as a count-up.
    this._shownScore += (score - this._shownScore) * 0.18;
    if (Math.abs(score - this._shownScore) < 1) this._shownScore = score;
    this.scoreEl.textContent = Math.round(this._shownScore).toLocaleString();
  }

  setCombo(multiplier, fraction) {
    if (multiplier > 1) {
      this.comboEl.style.opacity = '1';
      this.comboEl.textContent = `FLOW ×${multiplier.toFixed(1)}`;
      this.comboEl.style.setProperty('--fill', `${Math.round(fraction * 100)}%`);
    } else {
      this.comboEl.style.opacity = '0';
    }
  }

  toast(title, detail) {
    const el = document.createElement('div');
    el.className = 'popup';
    el.innerHTML = detail
      ? `<span class="popup-title">${title}</span><span class="popup-detail">${detail}</span>`
      : `<span class="popup-title">${title}</span>`;
    this.popups.appendChild(el);
    setTimeout(() => el.classList.add('out'), 900);
    setTimeout(() => el.remove(), 1600);
  }

  hit() {
    this.flash.classList.remove('active');
    void this.flash.offsetWidth; // restart the animation
    this.flash.classList.add('active');
  }

  showOverlay(html) {
    this.overlay.innerHTML = html;
    this.overlay.classList.add('active');
  }

  hideOverlay() {
    this.overlay.classList.remove('active');
  }

  toggle() {
    this.visible = !this.visible;
    this.root.style.opacity = this.visible ? '1' : '0';
  }
}

export function trickName(spins, grabbed, spinDir = 1) {
  const turns = Math.round(spins);
  if (turns >= 1) {
    // Negative yaw spins the board towards the right of the frame.
    const base = `${spinDir < 0 ? 'Frontside' : 'Backside'} ${turns * 360}`;
    return grabbed ? `${base} Grab` : base;
  }
  return grabbed ? 'Method Grab' : null;
}
