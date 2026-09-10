/* Упражнение — это данные, а не код.
 * Чтобы добавить отжимания, допиши сюда объект: ядро про упражнения не знает.
 */

export const EXERCISES = {
  squat: {
    id: "squat",
    name: "Приседания",
    intro: "Встань <b>боком</b> к камере и помести себя в рамку целиком.",

    // угол считается по тройке точек MediaPipe Pose
    joints: { left: [23, 25, 27], right: [24, 26, 28] },   // бедро → колено → щиколотка
    needs:  { left: [11, 23, 25, 27], right: [12, 24, 26, 28] },
    chain:  { left: [11, 23, 25, 27], right: [12, 24, 26, 28] },

    framing: {
      fillMin: 0.55,       // какую долю высоты рамки занимает тело
      fillMax: 0.96,
      sideRatioMax: 0.22,  // ширина плеч / рост; больше — значит стоит анфас
      holdMs: 2000,        // сколько держать верную позу до подтверждения
    },

    smoothWindow: 5,
    minRepMs: 600,         // короче — это дёрганье, а не повтор
    minRangeDeg: 35,       // амплитуда меньше — калибровка не удалась
    calibrateMs: 6000,
    enterDown: 0.25,       // пороги гистерезиса, в долях амплитуды
    enterUp: 0.75,
    fullDepth: 0.20,       // ниже — присед полный, выше — неполный
  },

  // pushup: { ... } — угол в локте [11,13,15], плюс валидатор прямого корпуса
  // crunch: { ... } — угол корпуса [11,23,25], амплитуда вдвое меньше
};

/* Что можно крутить ползунками в панели отладки */
export const TUNABLES = [
  { path: "framing.fillMin",      label: "Мин. заполнение рамки", min: 0.3,  max: 0.9,  step: 0.01 },
  { path: "framing.fillMax",      label: "Макс. заполнение",      min: 0.6,  max: 1.0,  step: 0.01 },
  { path: "framing.sideRatioMax", label: "Порог ракурса",         min: 0.10, max: 0.45, step: 0.01 },
  { path: "framing.holdMs",       label: "Удержание позы, мс",    min: 500,  max: 5000, step: 100  },
  { path: "smoothWindow",         label: "Окно сглаживания",      min: 1,    max: 15,   step: 1    },
  { path: "minRepMs",             label: "Мин. длит. повтора, мс",min: 200,  max: 2000, step: 50   },
  { path: "enterDown",            label: "Порог «ушёл вниз»",     min: 0.05, max: 0.5,  step: 0.01 },
  { path: "enterUp",              label: "Порог «встал»",         min: 0.5,  max: 0.95, step: 0.01 },
  { path: "fullDepth",            label: "Порог полной глубины",  min: 0.05, max: 0.5,  step: 0.01 },
];

export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}
export function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

const KEY = (id) => "tune:" + id;

/* Значения из панели живут в localStorage, а не в коде.
 * Нашёл рабочие — перенеси руками в объект выше и закоммить. */
export function applyOverrides(ex) {
  try {
    const raw = localStorage.getItem(KEY(ex.id));
    if (!raw) return ex;
    const saved = JSON.parse(raw);
    for (const [path, value] of Object.entries(saved)) setPath(ex, path, value);
  } catch (e) {}
  return ex;
}
export function saveOverrides(ex) {
  const out = {};
  for (const t of TUNABLES) out[t.path] = getPath(ex, t.path);
  localStorage.setItem(KEY(ex.id), JSON.stringify(out));
}
export function clearOverrides(ex) {
  localStorage.removeItem(KEY(ex.id));
}
