/* Всё, что рисует и звучит. Логики счёта здесь нет. */

export class UI {
  constructor() {
    this.video   = document.getElementById("cam");
    this.canvas  = document.getElementById("overlay");
    this.ctx     = this.canvas.getContext("2d");
    this.countEl = document.getElementById("count");
    this.hintEl  = document.getElementById("hint");
    this.holdEl  = document.getElementById("hold");
    this.holdFill= document.getElementById("holdFill");
    this.fillEl  = document.getElementById("fill");
    this.markUp  = document.getElementById("markUp");
    this.markDown= document.getElementById("markDown");
    this.voiceEl = document.getElementById("voice");
    this.mirrored = true;
    this.mode = "idle";
    this.audio = null;
  }

  /* — состояния экрана — */
  setMirrored(v) { this.mirrored = v; this.applyClass(); }
  setMode(m)     { this.mode = m;     this.applyClass(); }
  applyClass()   { document.body.className = (this.mirrored ? "mirrored " : "") + "state-" + this.mode; }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }
  clear() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }

  /* — рамка —
   * Видео обрезано по object-fit:cover, поэтому считаем, какая часть кадра
   * реально видна на экране, и рамку строим внутри неё.
   */
  visibleBox() {
    const r = this.canvas.getBoundingClientRect();
    const vw = this.video.videoWidth || 1, vh = this.video.videoHeight || 1;
    const scale = Math.max(r.width / vw, r.height / vh);
    const halfW = (r.width / scale) / vw / 2;
    const halfH = (r.height / scale) / vh / 2;
    return { x0: .5 - halfW, x1: .5 + halfW, y0: .5 - halfH, y1: .5 + halfH };
  }
  frameBox() {
    const b = this.visibleBox(), bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    return { x0: b.x0 + bw * .13, x1: b.x1 - bw * .13, y0: b.y0 + bh * .05, y1: b.y1 - bh * .10 };
  }
  drawFrame(tone) {
    const w = this.canvas.width, h = this.canvas.height, f = this.frameBox();
    const x0 = f.x0 * w, x1 = f.x1 * w, y0 = f.y0 * h, y1 = f.y1 * h;
    const arm = Math.min(x1 - x0, y1 - y0) * .13;
    const ctx = this.ctx;
    ctx.strokeStyle = tone;
    ctx.lineWidth = Math.max(3, w / 240);
    ctx.lineCap = "round";
    const corner = (cx, cy, dx, dy) => {
      ctx.beginPath();
      ctx.moveTo(cx + dx * arm, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * arm);
      ctx.stroke();
    };
    corner(x0, y0, 1, 1); corner(x1, y0, -1, 1);
    corner(x0, y1, 1, -1); corner(x1, y1, -1, -1);
  }

  drawSkeleton(lm, chain, tone) {
    const w = this.canvas.width, h = this.canvas.height, ctx = this.ctx;
    ctx.lineWidth = Math.max(2, w / 220);
    ctx.strokeStyle = tone;
    ctx.beginPath();
    chain.forEach((idx, k) => {
      const p = lm[idx]; if (!p) return;
      k === 0 ? ctx.moveTo(p.x * w, p.y * h) : ctx.lineTo(p.x * w, p.y * h);
    });
    ctx.stroke();
    ctx.fillStyle = "#F0EDE8";
    chain.forEach(idx => {
      const p = lm[idx]; if (!p) return;
      ctx.beginPath(); ctx.arc(p.x * w, p.y * h, Math.max(3, w / 200), 0, Math.PI * 2); ctx.fill();
    });
  }

  /* — подписи — */
  hint(html, tone = "") { this.hintEl.innerHTML = html; this.hintEl.className = tone; }
  hold(p) {
    this.holdEl.classList.toggle("on", p > 0);
    this.holdFill.style.width = Math.min(100, p * 100) + "%";
  }
  setCount(n) {
    this.countEl.textContent = n;
    this.countEl.classList.remove("pop");
    void this.countEl.offsetWidth;
    this.countEl.classList.add("pop");
  }
  gauge(progress, phase, ex) {
    this.fillEl.style.height = (progress * 100) + "%";
    this.fillEl.style.background = phase === "down" ? "#E8B23A" : "#79B3A5";
    this.markUp.style.bottom   = (ex.enterUp * 100) + "%";
    this.markDown.style.bottom = (ex.enterDown * 100) + "%";
  }

  /* — звук — */
  beep(freq, ms) {
    try {
      this.audio = this.audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = this.audio.createOscillator(), g = this.audio.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(.001, this.audio.currentTime);
      g.gain.exponentialRampToValueAtTime(.25, this.audio.currentTime + .01);
      g.gain.exponentialRampToValueAtTime(.001, this.audio.currentTime + ms / 1000);
      o.connect(g); g.connect(this.audio.destination);
      o.start(); o.stop(this.audio.currentTime + ms / 1000);
    } catch (e) {}
  }
  say(text) {
    if (!this.voiceEl.checked || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = "ru-RU"; u.rate = 1.15;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}
