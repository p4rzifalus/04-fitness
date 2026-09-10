/* Панель порогов.
 * Смысл: подбирать числа стоя у стены, а не через коммит → пуш → ожидание Pages.
 * Значения живут в localStorage. Нашёл рабочие — перенеси в exercises.js и закоммить.
 */

import { TUNABLES, getPath, setPath, saveOverrides, clearOverrides } from "./exercises.js";

export function mountDebug(ex, onChange) {
  const panel = document.getElementById("debug");
  const rows = document.getElementById("debugRows");
  rows.innerHTML = "";

  for (const t of TUNABLES) {
    const row = document.createElement("div");
    row.className = "drow";

    const label = document.createElement("label");
    label.textContent = t.label;

    const out = document.createElement("span");
    out.className = "dval";
    out.textContent = getPath(ex, t.path);

    const input = document.createElement("input");
    input.type = "range";
    input.min = t.min; input.max = t.max; input.step = t.step;
    input.value = getPath(ex, t.path);
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      setPath(ex, t.path, v);
      out.textContent = v;
      saveOverrides(ex);
      onChange?.(t.path, v);
    });

    label.appendChild(out);
    row.append(label, input);
    rows.appendChild(row);
  }

  document.getElementById("debugBtn").addEventListener("click", () => {
    panel.classList.toggle("on");
  });
  document.getElementById("debugClose").addEventListener("click", () => {
    panel.classList.remove("on");
  });
  document.getElementById("debugReset").addEventListener("click", () => {
    clearOverrides(ex);
    location.reload();
  });

  // живое значение угла — самое полезное при подборе
  const live = document.getElementById("debugLive");
  return {
    live(angle, conf, phase) {
      if (!panel.classList.contains("on")) return;
      live.textContent = `угол ${angle == null ? "—" : angle.toFixed(1)}°  ·  видимость ${conf.toFixed(2)}  ·  ${phase}`;
    },
  };
}
