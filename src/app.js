/* Оркестровка: рамка → подтверждение → калибровка → счёт. */

import { EXERCISES, applyOverrides } from "./exercises.js";
import { PoseEngine, RepCounter, Recorder, Smoother, angleAt, visibility, checkFraming } from "./core.js";
import { UI } from "./ui.js";
import { mountDebug } from "./debug.js";

const ex = applyOverrides(EXERCISES.squat);
const ui = new UI();
const engine = new PoseEngine(ui.video);
const counter = new RepCounter(ex);
const recorder = new Recorder(ex.id);
let smoother = new Smoother(ex.smoothWindow);
let dbg = null;

const S = {
  mode: "idle",       // idle | framing | calibrating | counting
  side: "left",
  goodSince: 0,
  calSamples: [],
  calStart: 0,
};

let facing = "user";
let wakeLock = null;

function setMode(m) { S.mode = m; ui.setMode(m); }

/* ─── фаза 1: постановка ─── */
function runFraming(lm) {
  const res = checkFraming(lm, ui.canvas.width, ui.canvas.height, ex, S.side, ui.frameBox());
  const now = performance.now();

  if (!res.ok) {
    S.goodSince = 0;
    ui.hold(0);
    ui.drawFrame("#F0EDE8");
    ui.hint(res.msg, "warn");
    return;
  }

  if (!S.goodSince) { S.goodSince = now; ui.beep(600, 50); }
  const held = (now - S.goodSince) / ex.framing.holdMs;
  ui.drawFrame("#79B3A5");
  ui.drawSkeleton(lm, ex.chain[S.side], "#79B3A5");
  ui.hold(held);
  ui.hint("Стоишь <b>правильно</b>. Не двигайся.", "good");

  if (held >= 1) {
    ui.hold(0);
    ui.beep(760, 90);
    ui.say("Сделай один медленный присед");
    S.calSamples = [];
    S.calStart = now;
    setMode("calibrating");
  }
}

/* ─── фаза 2: калибровка ───
 * Пороги берём из фактической амплитуды человека, а не из зашитых градусов.
 */
function runCalibration(angle, lm) {
  S.calSamples.push(angle);
  ui.drawFrame("rgba(240,237,232,.35)");
  ui.drawSkeleton(lm, ex.chain[S.side], "#E8B23A");

  const elapsed = performance.now() - S.calStart;
  const left = Math.max(0, Math.ceil((ex.calibrateMs - elapsed) / 1000));
  ui.hint(`Сделай <b>один медленный присед</b> — замеряю твою амплитуду. ${left}`, "warn");
  ui.hold(elapsed / ex.calibrateMs);

  if (elapsed < ex.calibrateMs) return;

  ui.hold(0);
  const max = Math.max(...S.calSamples), min = Math.min(...S.calSamples);
  counter.reset();
  if (!counter.calibrate(min, max)) {
    ui.hint("Приседа не увидел. Начнём заново.", "warn");
    S.goodSince = 0;
    setMode("framing");
    return;
  }
  recorder.reset();
  ui.setCount(0);
  ui.beep(880, 120);
  ui.say("Начали");
  ui.hint("Считаю.");
  setMode("counting");
}

/* ─── фаза 3: счёт ─── */
function runCounting(angle, lm, conf) {
  ui.drawSkeleton(lm, ex.chain[S.side], counter.phase === "down" ? "#E8B23A" : "#79B3A5");
  const now = performance.now();
  recorder.push(now, angle, conf);

  const rep = counter.update(angle, now);
  if (rep) {
    ui.setCount(rep.count);
    ui.beep(rep.full ? 880 : 440, rep.full ? 90 : 180);
    ui.say(rep.count);
    ui.hint(rep.full ? "Глубина в порядке." : "Неполный присед — опускайся ниже.", rep.full ? "" : "warn");
  }
  ui.gauge(counter.progress(angle), counter.phase, ex);
}

/* ─── цикл ─── */
function loop() {
  requestAnimationFrame(loop);
  if (S.mode === "idle") return;

  const lm = engine.detect();
  if (lm === undefined) return;              // кадр не обновился

  ui.resize(ui.video.videoWidth, ui.video.videoHeight);
  ui.clear();

  if (!lm) {
    S.goodSince = 0;
    ui.hold(0);
    ui.drawFrame("#F0EDE8");
    ui.hint("Встань в рамку.", "warn");
    if (S.mode !== "framing") setMode("framing");
    return;
  }

  const vl = visibility(lm, ex.needs.left), vr = visibility(lm, ex.needs.right);
  S.side = vl >= vr ? "left" : "right";
  const conf = Math.max(vl, vr);

  if (S.mode === "framing") { dbg?.live(null, conf, "рамка"); return runFraming(lm); }

  const [a, b, c] = ex.joints[S.side];
  const raw = angleAt(lm[a], lm[b], lm[c], ui.canvas.width, ui.canvas.height);
  if (raw == null) return;
  if (smoother.size !== ex.smoothWindow) smoother = new Smoother(ex.smoothWindow);
  const angle = smoother.push(raw);
  dbg?.live(angle, conf, counter.phase);

  if (S.mode === "calibrating") runCalibration(angle, lm);
  else if (S.mode === "counting") runCounting(angle, lm, conf);
}

/* ─── управление ─── */
document.getElementById("startBtn").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "Загружаю модель…";
  try {
    await engine.startCamera(facing);
    await engine.initModel();
    try { wakeLock = await navigator.wakeLock.request("screen"); } catch (err) {}
    ui.beep(520, 60);                        // разблокировать звук по жесту
    S.goodSince = 0;
    setMode("framing");
    ui.hint(ex.intro);
    btn.textContent = "Работает";
    for (const id of ["flipBtn", "resetBtn", "saveBtn", "debugBtn"])
      document.getElementById(id).disabled = false;
    loop();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Включить камеру";
    ui.hint("Камера не открылась: " + err.message + ". Нужен https и разрешение на камеру.", "warn");
  }
});

document.getElementById("flipBtn").addEventListener("click", async () => {
  facing = facing === "user" ? "environment" : "user";
  await engine.startCamera(facing);
  ui.setMirrored(facing === "user");
});

document.getElementById("resetBtn").addEventListener("click", () => {
  counter.reset();
  smoother.reset();
  recorder.reset();
  S.goodSince = 0;
  ui.setCount(0);
  ui.hold(0);
  setMode("framing");
  ui.hint(ex.intro);
});

document.getElementById("saveBtn").addEventListener("click", () => {
  if (!recorder.frames.length) { ui.hint("Записывать нечего — сначала сделай подход.", "warn"); return; }
  const expected = prompt("Сколько повторов было на самом деле?", String(counter.count));
  if (expected === null) return;
  recorder.download({
    expected: parseInt(expected, 10),
    detected: counter.count,
    calMin: counter.calMin,
    calMax: counter.calMax,
  });
});

dbg = mountDebug(ex, () => {});
ui.setMirrored(true);
