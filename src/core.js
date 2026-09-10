/* Ядро: геометрия, проверка постановки, машина состояний повторов, запись сессии.
 * Ничего не знает ни про DOM, ни про конкретное упражнение.
 */

import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const WASM  = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
// точнее, но тяжелее для телефона:
// pose_landmarker_full/float16/1/pose_landmarker_full.task

/* ─── геометрия ─── */

// Нормализованные координаты растягиваем в пиксели, иначе угол врёт на неквадратном кадре.
export function angleAt(a, b, c, w, h) {
  if (!a || !b || !c) return null;
  const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h, cx = c.x * w, cy = c.y * h;
  const v1x = ax - bx, v1y = ay - by, v2x = cx - bx, v2y = cy - by;
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (!m1 || !m2) return null;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return Math.acos(cos) * 180 / Math.PI;
}

export function visibility(lm, idxs) {
  return idxs.reduce((s, i) => s + (lm[i]?.visibility ?? 0), 0) / idxs.length;
}

export class Smoother {
  constructor(size = 5) { this.size = size; this.buf = []; }
  push(v) {
    this.buf.push(v);
    while (this.buf.length > this.size) this.buf.shift();
    return this.buf.reduce((a, b) => a + b, 0) / this.buf.length;
  }
  reset() { this.buf = []; }
}

/* ─── проверка постановки ───
 * frame — прямоугольник в нормализованных координатах видео (даёт UI).
 * Возвращаем одну претензию за раз, самую важную из непройденных.
 */
export function checkFraming(lm, w, h, ex, side, frame) {
  const F = ex.framing;
  const i = side === "left"
    ? { sh: 11, hip: 23, ank: 27, osh: 12 }
    : { sh: 12, hip: 24, ank: 28, osh: 11 };
  const sh = lm[i.sh], hip = lm[i.hip], ank = lm[i.ank], osh = lm[i.osh], head = lm[0];

  if (!head || !sh || !ank || visibility(lm, ex.needs[side]) < 0.5)
    return { ok: false, msg: "Не вижу тебя целиком. Отойди дальше и добавь света." };

  const bodyPx  = Math.abs(ank.y - head.y) * h;
  const framePx = (frame.y1 - frame.y0) * h;
  const fill = bodyPx / framePx;

  if (fill < F.fillMin) return { ok: false, msg: "Подойди <b>ближе</b> к камере." };
  if (fill > F.fillMax) return { ok: false, msg: "Отойди <b>дальше</b> — не помещаешься." };

  const inside = [head, sh, hip, ank].every(p =>
    p.x > frame.x0 && p.x < frame.x1 && p.y > frame.y0 && p.y < frame.y1);
  if (!inside) return { ok: false, msg: "Встань <b>в центр рамки</b>, целиком." };

  // Про «левее/правее» не пишем: фронталка зеркалит, подсказка прочтётся наоборот.

  const shoulderSpan = Math.abs(sh.x - osh.x) * w;
  if (shoulderSpan / bodyPx > F.sideRatioMax)
    return { ok: false, msg: "Повернись <b>боком</b> к камере." };

  return { ok: true };
}

/* ─── машина состояний повторов ─── */
export class RepCounter {
  constructor(ex) { this.ex = ex; this.reset(); }

  reset() {
    this.phase = "up";
    this.count = 0;
    this.partials = 0;
    this.calMin = null;
    this.calMax = null;
    this.repMin = null;
    this.downAt = 0;
  }

  calibrate(min, max) {
    if (max - min < this.ex.minRangeDeg) return false;
    this.calMin = min; this.calMax = max;
    this.phase = "up";
    return true;
  }

  get ready() { return this.calMin != null; }

  thresholds() {
    const range = this.calMax - this.calMin;
    return {
      range,
      down: this.calMin + this.ex.enterDown * range,
      up:   this.calMin + this.ex.enterUp   * range,
      deep: this.calMin + this.ex.fullDepth * range,
    };
  }

  // Возвращает событие повтора либо null.
  update(angle, now) {
    if (!this.ready) return null;
    const t = this.thresholds();
    let event = null;

    if (this.phase === "up" && angle < t.down) {
      this.phase = "down";
      this.repMin = angle;
      this.downAt = now;
    } else if (this.phase === "down") {
      this.repMin = Math.min(this.repMin, angle);
      if (angle > t.up) {
        this.phase = "up";
        if (now - this.downAt >= this.ex.minRepMs) {
          const full = this.repMin <= t.deep;
          this.count++;
          if (!full) this.partials++;
          event = { count: this.count, full, repMin: this.repMin, durationMs: now - this.downAt };
        }
      }
    }

    // амплитуда могла вырасти по ходу подхода
    if (angle > this.calMax) this.calMax = angle;
    if (angle < this.calMin) this.calMin = angle;

    return event;
  }

  progress(angle) {
    if (!this.ready) return 0;
    const range = this.calMax - this.calMin;
    return Math.min(1, Math.max(0, (angle - this.calMin) / range));
  }
}

/* ─── запись сессии ───
 * Сохранённый подход можно прогнать в lab/ без камеры и без приседа.
 */
export class Recorder {
  constructor(exerciseId) { this.exerciseId = exerciseId; this.frames = []; this.t0 = null; }
  reset() { this.frames = []; this.t0 = null; }
  push(now, angle, conf) {
    if (this.t0 == null) this.t0 = now;
    this.frames.push({ t: Math.round(now - this.t0), a: +angle.toFixed(2), c: +conf.toFixed(2) });
  }
  toJSON(meta = {}) {
    return JSON.stringify({
      exercise: this.exerciseId,
      recordedAt: new Date().toISOString(),
      ...meta,
      frames: this.frames,
    });
  }
  download(meta = {}) {
    const blob = new Blob([this.toJSON(meta)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${this.exerciseId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

/* ─── камера и модель ─── */
export class PoseEngine {
  constructor(video) { this.video = video; this.landmarker = null; this.stream = null; this.lastTime = -1; }

  async initModel() {
    if (this.landmarker) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  async startCamera(facing) {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  // undefined, если кадр тот же самый — считать его заново незачем
  detect() {
    if (!this.landmarker || this.video.readyState < 2) return undefined;
    if (this.video.currentTime === this.lastTime) return undefined;
    this.lastTime = this.video.currentTime;
    return this.landmarker.detectForVideo(this.video, performance.now()).landmarks?.[0] ?? null;
  }
}
