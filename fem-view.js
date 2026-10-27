/* Explicit FEM saves use a separate storage key. Existing editor projects are never overwritten. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id),
    canvases = [$("materials"), $("temperature")];
  const fmt = (n, d = 3) =>
    n === null
      ? "—"
      : Number(n).toLocaleString("ru-RU", { maximumFractionDigits: d });
  const catalog = (() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("thermo2d.material-library.v1") || "[]",
      );
      if (!Array.isArray(saved)) return ThermoMaterials;
      return [
        ...ThermoMaterials.filter((m) => !saved.some((s) => s.id === m.id)),
        ...saved.filter(
          (m) => m && typeof m.id === "string" && Number(m.lambda) > 0,
        ),
      ];
    } catch {
      return ThermoMaterials;
    }
  })();
  let selectedEdge = null;
  let model = FEMExamples.windowNode(),
    result = null,
    results = [],
    worker = null,
    revision = 0,
    zoom = 1,
    pan = { x: 0, y: 0 },
    drag = null,
    renderPending = false;
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function stop() {
    revision++;
    worker?.terminate();
    worker = null;
    $("run").disabled = $("study").disabled = false;
    $("cancel").disabled = true;
    $("adapt").disabled = !result;
  }
  function invalidate() {
    stop();
    result = null;
    $("adapt").disabled = true;
    results = [];
    $("result-choice").hidden = true;
    $("metrics").replaceChildren();
    $("heat-report").replaceChildren();
    $("convergence").replaceChildren();
    $("export-image").disabled = $("export-result").disabled = true;
    $("status").textContent = "Параметры изменены. Пересчитайте модель.";
    draw();
  }
  function catalogNote() {
    const m = catalog.find((m) => m.id === $("catalog-choice").value);
    $("catalog-note").textContent = m
      ? `λ=${m.lambda}; ρ=${m.density ?? "—"}; c=${m.heatCapacity ?? "—"}. ${m.note || "Пользовательский материал"}`
      : "";
  }
  function changed() {
    model.userEdited = true;
    model.description =
      "Пользовательская модель. Актуальные материалы и условия показаны в таблицах; размеры — в мм.";
    $("example").value = "custom";
    invalidate();
    controls();
    draw();
  }
  function controls() {
    selectedEdge = null;
    $("edge-info").textContent = "Грань не выбрана";
    const regionChoice = $("region-choice").value;
    $("region-choice").replaceChildren(
      ...model.regions.map(
        (r, i) =>
          new Option(
            `${r.name || i}${r.materialPending ? " · материал не назначен" : ""}`,
            i,
          ),
      ),
    );
    if (regionChoice !== "" && +regionChoice < model.regions.length)
      $("region-choice").value = regionChoice;
    if (!$("catalog-choice").options.length)
      $("catalog-choice").replaceChildren(
        ...catalog.map((m) => new Option(`${m.name} · λ ${m.lambda}`, m.id)),
      );
    catalogNote();
    $("study").textContent = ["steel", "wood"].includes($("example").value)
      ? "Сравнить металл / без · 3 сетки"
      : ["hole", "solid"].includes($("example").value)
        ? "Сравнить отверстие / сплошная · 3 сетки"
        : "Сходимость моего узла · 3 сетки";
    $("description").textContent =
      model.description ||
      "Пользовательская модель: проверьте единицы, материалы и граничные условия.";
    $("model-json").value = JSON.stringify(model, null, 2);
    $("model-controls").innerHTML =
      "<h3>λ и локальный размер h</h3><table><tr><th>Область</th><th>λ</th><th>h, мм</th></tr>" +
      model.regions
        .map(
          (r, i) =>
            `<tr><td>${esc(r.name || i)}<small>${esc(r.materialName || (r.materialPending ? "Материал не назначен" : "Задано в модели"))}</small></td><td><input data-region="${i}" data-prop="lambda" type="number" min=".000001" step=".01" value="${r.lambda}"></td><td><input data-region="${i}" data-prop="h" type="number" min=".001" step=".1" value="${r.h ?? ""}" placeholder="Авто"></td></tr>`,
        )
        .join("") +
      "</table><h3>Граничные условия</h3><table><tr><th>Грань</th><th>Тип</th><th>T, °C</th><th>h</th><th>Внутри</th></tr>" +
      (model.boundaries || [])
        .map(
          (b, i) =>
            `<tr><td>${esc(b.name || i)}</td><td><select data-boundary="${i}" data-prop="type"><option value="temperature" ${b.type !== "film" ? "selected" : ""}>Поверхность</option><option value="film" ${b.type === "film" ? "selected" : ""}>Воздух + h</option></select></td><td><input data-boundary="${i}" data-prop="temperature" type="number" value="${b.temperature}"></td><td><input data-boundary="${i}" data-prop="h" type="number" min=".001" value="${b.h ?? ""}"></td><td><input aria-label="Внутренняя поверхность ${esc(b.name || i)}" data-boundary="${i}" data-prop="interior" type="checkbox" ${b.interior ? "checked" : ""}></td></tr>`,
        )
        .join("") +
      "</table>";
    $("model-controls")
      .querySelectorAll("input,select")
      .forEach(
        (e) =>
          (e.oninput = () => {
            invalidate();
            $("status").textContent =
              "Примените параметры материалов и границ перед расчётом.";
            $("run").disabled = $("study").disabled = true;
          }),
      );
  }
  function select() {
    invalidate();
    if (["hole", "solid"].includes($("example").value)) {
      model = FEMExamples.holeNode($("example").value === "hole");
      $("base").value = 8;
      $("minimum").value = 1;
    } else if ($("example").value === "wall") model = FEMExamples.wall(true);
    else if ($("example").value !== "custom")
      model = FEMExamples.windowNode($("example").value === "steel");
    controls();
    zoom = 1;
    pan = { x: 0, y: 0 };
    draw();
  }
  function applyControls() {
    try {
      const next = structuredClone(model);
      for (const e of $("model-controls").querySelectorAll("input,select")) {
        const o =
          e.dataset.region !== undefined
            ? next.regions[+e.dataset.region]
            : next.boundaries[+e.dataset.boundary];
        const p = e.dataset.prop;
        if (e.type === "checkbox") o[p] = e.checked;
        else if (e.value === "") delete o[p];
        else o[p] = p === "type" ? e.value : Number(e.value);
      }
      ThermoFEM.validate(next);
      model = next;
      changed();
    } catch (e) {
      $("status").textContent = e.message;
    }
  }
  function range() {
    let min = +$("scale-min").value,
      max = +$("scale-max").value;
    if ($("auto").checked && result) {
      min = Infinity;
      max = -Infinity;
      for (const t of result.values) {
        min = Math.min(min, t);
        max = Math.max(max, t);
      }
    }
    return { min, max };
  }
  function geometry() {
    const pts = model.regions.flatMap((r) => r.points);
    return {
      minX: Math.min(...pts.map((p) => p.x)),
      maxX: Math.max(...pts.map((p) => p.x)),
      minY: Math.min(...pts.map((p) => p.y)),
      maxY: Math.max(...pts.map((p) => p.y)),
    };
  }
  function view(w, h) {
    const b = geometry(),
      s =
        Math.min((w - 50) / (b.maxX - b.minX), (h - 50) / (b.maxY - b.minY)) *
        zoom;
    return {
      s,
      x: w / 2 - ((b.maxX + b.minX) / 2) * s + pan.x * w,
      y: h / 2 + ((b.maxY + b.minY) / 2) * s + pan.y * h,
    };
  }
  const screen = (p, v) => ({ x: v.x + p.x * v.s, y: v.y - p.y * v.s });
  function paint(canvas, thermal, exporting = false) {
    const ctx = canvas.getContext("2d"),
      w = canvas.width,
      h = canvas.height,
      v = view(w, exporting ? h - 200 : h),
      { min, max } = range();
    if (exporting) v.y += 200;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, w, h);
    if (result && thermal && max >= min) {
      const image = ctx.createImageData(w, h),
        data = image.data;
      data.fill(255);
      const lut = Array.from({ length: 4097 }, (_, i) =>
        ThermoPalette.color(min + ((max - min) * i) / 4096, min, max),
      );
      for (const t of result.triangles) {
        const p = t.v.map((i) => screen(result.nodes[i], v)),
          values = t.v.map((i) => result.values[i]);
        const det =
          (p[1].y - p[2].y) * (p[0].x - p[2].x) +
          (p[2].x - p[1].x) * (p[0].y - p[2].y);
        const x0 = Math.max(0, Math.floor(Math.min(...p.map((p) => p.x)))),
          x1 = Math.min(w - 1, Math.ceil(Math.max(...p.map((p) => p.x))));
        const y0 = Math.max(0, Math.floor(Math.min(...p.map((p) => p.y)))),
          y1 = Math.min(h - 1, Math.ceil(Math.max(...p.map((p) => p.y))));
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const a =
                ((p[1].y - p[2].y) * (x + 0.5 - p[2].x) +
                  (p[2].x - p[1].x) * (y + 0.5 - p[2].y)) /
                det,
              b =
                ((p[2].y - p[0].y) * (x + 0.5 - p[2].x) +
                  (p[0].x - p[2].x) * (y + 0.5 - p[2].y)) /
                det,
              c = 1 - a - b;
            if (a < -1e-8 || b < -1e-8 || c < -1e-8) continue;
            const temp = a * values[0] + b * values[1] + c * values[2],
              u =
                max > min
                  ? Math.max(0, Math.min(1, (temp - min) / (max - min)))
                  : 0.5,
              rgb = lut[Math.round(u * 4096)],
              i = 4 * (y * w + x);
            data[i] = rgb[0];
            data[i + 1] = rgb[1];
            data[i + 2] = rgb[2];
            data[i + 3] = 255;
          }
      }
      ctx.putImageData(image, 0, 0);
    }
    const colors = [
      "#dce8ed",
      "#eadcc7",
      "#e2c9a5",
      "#e2c9a5",
      "#e2c9a5",
      "#e2c9a5",
      "#869ca8",
      "#bdd8cc",
    ];
    model.regions.forEach((r, i) => {
      ctx.beginPath();
      for (const ring of [r.points, ...(r.holes || [])]) {
        ring.forEach((p, k) => {
          const q = screen(p, v);
          k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
        });
        ctx.closePath();
      }
      if (!thermal || !result) {
        ctx.fillStyle = r.color || colors[i % colors.length];
        ctx.fill("evenodd");
      }
      ctx.strokeStyle = "#182529";
      ctx.lineWidth = exporting ? 1.3 : 0.7 * (devicePixelRatio || 1);
      ctx.stroke();
    });
    if (result && $("mesh").checked) {
      ctx.strokeStyle = "rgba(0,0,0,.32)";
      ctx.lineWidth = exporting ? 0.6 : 0.4 * (devicePixelRatio || 1);
      let batch = 0;
      ctx.beginPath();
      for (const t of result.triangles) {
        const p = t.v.map((i) => screen(result.nodes[i], v));
        if (
          p.every((p) => p.x < 0) ||
          p.every((p) => p.x > w) ||
          p.every((p) => p.y < 0) ||
          p.every((p) => p.y > h)
        )
          continue;
        ctx.moveTo(p[0].x, p[0].y);
        ctx.lineTo(p[1].x, p[1].y);
        ctx.lineTo(p[2].x, p[2].y);
        ctx.closePath();
        if (++batch === 512) {
          ctx.stroke();
          ctx.beginPath();
          batch = 0;
        }
      }
      ctx.stroke();
    }
    if (result && thermal && $("iso").checked) {
      const iso = +$("iso-value").value,
        lines = [];
      for (const t of result.triangles) {
        const hits = [];
        for (let k = 0; k < 3; k++) {
          const a = t.v[k],
            b = t.v[(k + 1) % 3],
            ta = result.values[a],
            tb = result.values[b];
          if (ta < iso === tb < iso || Math.abs(tb - ta) < 1e-12) continue;
          const f = (iso - ta) / (tb - ta),
            pa = result.nodes[a],
            pb = result.nodes[b];
          hits.push(
            screen(
              { x: pa.x + f * (pb.x - pa.x), y: pa.y + f * (pb.y - pa.y) },
              v,
            ),
          );
        }
        if (hits.length === 2) lines.push(hits);
      }
      ctx.beginPath();
      lines.forEach(([a, b]) => {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      });
      ctx.strokeStyle = "white";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = "#de2028";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const label = lines.find(
        ([a]) => a.x > 20 && a.x < w - 80 && a.y > 20 && a.y < h - 20,
      );
      if (label) {
        ctx.font = `bold ${13 * (canvas.clientWidth ? w / canvas.clientWidth : w / 1000)}px system-ui`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "white";
        ctx.strokeText(`${iso} °C`, label[0].x + 4, label[0].y - 5);
        ctx.fillStyle = "#de2028";
        ctx.fillText(`${iso} °C`, label[0].x + 4, label[0].y - 5);
      }
    }
    if (result && thermal && $("flux").checked) {
      const occupied = new Set();
      ctx.strokeStyle = "#12292c";
      ctx.lineWidth = 1;
      for (const t of result.triangles) {
        const p = screen(
            {
              x: t.v.reduce((s, i) => s + result.nodes[i].x / 3, 0),
              y: t.v.reduce((s, i) => s + result.nodes[i].y / 3, 0),
            },
            v,
          ),
          key = `${Math.floor(p.x / 40)}:${Math.floor(p.y / 40)}`,
          q = Math.hypot(...t.q);
        if (
          occupied.has(key) ||
          q < 1e-6 ||
          p.x < 0 ||
          p.x > w ||
          p.y < 0 ||
          p.y > h
        )
          continue;
        occupied.add(key);
        const dx = (t.q[0] / q) * 13,
          dy = (-t.q[1] / q) * 13;
        ctx.beginPath();
        ctx.moveTo(p.x - dx / 2, p.y - dy / 2);
        ctx.lineTo(p.x + dx / 2, p.y + dy / 2);
        ctx.lineTo(
          p.x + dx / 2 - dx * 0.35 + dy * 0.25,
          p.y + dy / 2 - dy * 0.35 - dx * 0.25,
        );
        ctx.moveTo(p.x + dx / 2, p.y + dy / 2);
        ctx.lineTo(
          p.x + dx / 2 - dx * 0.35 - dy * 0.25,
          p.y + dy / 2 - dy * 0.35 + dx * 0.25,
        );
        ctx.stroke();
      }
    }
    ctx.font = `bold ${13 * (canvas.clientWidth ? w / canvas.clientWidth : w / 1000)}px system-ui`;
    for (const b of model.boundaries || []) {
      const p = screen({ x: (b.a.x + b.b.x) / 2, y: (b.a.y + b.b.y) / 2 }, v);
      const label = `${fmt(b.temperature)} °C${b.type === "film" ? " (воздух)" : ""}`;
      const lx = Math.max(
          6,
          Math.min(w - ctx.measureText(label).width - 6, p.x + 5),
        ),
        ly = Math.max(25, Math.min(h - 10, p.y - 7));
      ctx.lineWidth = 3;
      ctx.strokeStyle = "white";
      ctx.strokeText(label, lx, ly);
      ctx.fillStyle = "#de2028";
      ctx.fillText(label, lx, ly);
    }
    if (selectedEdge) {
      const a = screen(selectedEdge.a, v),
        b = screen(selectedEdge.b, v);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#a000cc";
      ctx.stroke();
    }
    if (result?.heat.minSurfacePoint && thermal) {
      const p = screen(result.heat.minSurfacePoint, v);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.strokeStyle = "white";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  function draw() {
    const { min, max } = range();
    $("ramp").style.background = ThermoPalette.css;
    $("ticks").replaceChildren();
    const ticks =
      max === min
        ? [min]
        : [
            min,
            ...Array.from(
              {
                length: Math.min(100, Math.max(0, Math.ceil((max - min) / 5))),
              },
              (_, i) => (Math.floor(min / 5) + 1 + i) * 5,
            ).filter((t) => t > min && t < max && max - t > (max - min) * 0.04),
            max,
          ];
    ticks.forEach((t) => {
      const e = document.createElement("span");
      e.textContent = fmt(t, 1);
      e.style.left = `${max > min ? ((t - min) / (max - min)) * 100 : 50}%`;
      $("ticks").append(e);
    });
    let outside = 0;
    if (result)
      outside = result.values.filter(
        (t) => t < min - 1e-6 || t > max + 1e-6,
      ).length;
    $("scale-note").textContent =
      max < min
        ? "Ошибка: максимум шкалы меньше минимума."
        : `${$("auto").checked ? "Автоматический" : "Фиксированный общий"} диапазон ${fmt(min)}…${fmt(max)} °C${outside ? ` · Вне шкалы: ${outside} узлов (цвет ограничен)` : ""}`;
    canvases.forEach((canvas, i) => {
      const rect = canvas.getBoundingClientRect(),
        dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      paint(canvas, i === 1);
    });
  }
  function schedule() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      draw();
    });
  }
  function show(r) {
    result = r;
    model = r.model;
    $("example").value = model.userEdited
      ? "custom"
      : model.name === FEMExamples.windowNode(true).name
        ? "steel"
        : model.name === FEMExamples.windowNode(false).name
          ? "wood"
          : model.name === FEMExamples.holeNode(true).name
            ? "hole"
            : model.name === FEMExamples.holeNode(false).name
              ? "solid"
              : model.name === FEMExamples.wall().name
                ? "wall"
                : "custom";
    $("description").textContent = model.description || model.name;
    const s = r.stats,
      h = r.heat;
    $("metrics").innerHTML = [
      ["Потери Q′, Вт/м", fmt(h.outgoing, 5)],
      ["Минимум внутри, °C", fmt(h.minSurface, 4)],
      ["Баланс мощности, %", fmt(h.balance * 100, 8)],
      [
        "Узлы / треугольники",
        `${s.nodes.toLocaleString()} / ${s.elements.toLocaleString()}`,
      ],
      ["Рёбра min…max, мм", `${fmt(s.minEdge, 4)}…${fmt(s.maxEdge, 2)}`],
      ["Время / итерации", `${fmt(s.elapsedMs / 1000, 1)} с / ${s.iterations}`],
    ]
      .map(
        ([label, value]) =>
          `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`,
      )
      .join("");
    $("heat-report").innerHTML =
      `<p>Минимальный угол: ${fmt(s.minAngle, 2)}°. Невязка: ${s.residual.toExponential(2)} Вт/м. Минимум внутренней поверхности: ${h.minSurfacePoint ? `x=${fmt(h.minSurfacePoint.x)}, y=${fmt(h.minSurfacePoint.y)} мм` : "внутренняя поверхность не назначена"}.</p><table><tr><th>Грань</th><th>Наружу, Вт/м (− вход)</th><th>Длина, м</th></tr>` +
      h.rows
        .map(
          (row) =>
            `<tr><td>${esc(row.name)}</td><td>${fmt(row.outward, 6)}</td><td>${fmt(row.length, 4)}</td></tr>`,
        )
        .join("") +
      "</table>" +
      (s.minAngle < 10
        ? '<p class="fail">Есть вытянутые элементы с углом менее 10°. Проверяйте сходимость, особенно у наклонных тонких деталей.</p>'
        : "");
    $("heat-report").insertAdjacentHTML(
      "beforeend",
      `<p>Индикатор скачка нормального потока: ${fmt((r.estimator?.relativeIndicator || 0) * 100, 2)} %. Он указывает места локального сгущения; это не гарантированная ошибка Q′ или Tsi.</p>`,
    );
    $("adapt").disabled = !!worker || !r.estimator?.hotspots.length;
    $("export-image").disabled = $("export-result").disabled = false;
    draw();
  }
  function studyTable() {
    if (results.length < 2) return;
    const qTol = +$("target-q").value,
      tTol = +$("target-t").value;
    $("convergence").innerHTML =
      "<h2>Численная сходимость</h2><p>Сравниваются последовательные сетки одного варианта. Баланс и невязка проверены отдельно. Порог: ΔQ′ &lt; " +
      qTol +
      " %, ΔTsi &lt; " +
      tTol +
      " °C.</p><table><tr><th>Вариант</th><th>h min, мм</th><th>Элементы</th><th>Q′, Вт/м</th><th>Tsi min, °C</th><th>ΔQ′ / ΔTsi</th></tr>" +
      results
        .map((r, i) => {
          const prev = results[i - 1],
            same = prev && prev.model.name === r.model.name,
            dq = same
              ? (Math.abs(r.heat.outgoing - prev.heat.outgoing) /
                  Math.max(Math.abs(r.heat.outgoing), 1e-12)) *
                100
              : null,
            dt =
              same &&
              r.heat.minSurface !== null &&
              prev.heat.minSurface !== null
                ? Math.abs(r.heat.minSurface - prev.heat.minSurface)
                : null;
          return `<tr><td>${esc(r.model.name)}</td><td>${r.options.minimum}</td><td>${r.stats.elements}</td><td>${fmt(r.heat.outgoing, 5)}</td><td>${fmt(r.heat.minSurface, 4)}</td><td class="${dq !== null && dt !== null && dq < qTol && dt < tTol ? "pass" : "fail"}">${dq === null ? "—" : `${fmt(dq, 4)} % / ${fmt(dt, 4)} °C`}</td></tr>`;
        })
        .join("") +
      "</table>";
  }
  function run(study = false, adaptive = false) {
    if (model.regions.some((r) => r.materialPending)) {
      $("status").textContent =
        "Назначьте материалы всем импортированным областям.";
      return;
    }
    const previous = result;
    stop();
    results = adaptive && previous ? [previous] : [];
    result = null;
    $("adapt").disabled = true;
    const base = adaptive ? previous.options.base : +$("base").value,
      minimum = adaptive ? previous.options.minimum / 2 : +$("minimum").value;
    if (!(base >= minimum && minimum > 0)) {
      $("status").textContent = "Нужны 0 < минимальный размер ≤ базовый.";
      return;
    }
    $("run").disabled = $("study").disabled = true;
    $("cancel").disabled = false;
    $("export-image").disabled = $("export-result").disabled = true;
    $("metrics").replaceChildren();
    $("convergence").replaceChildren();
    $("heat-report").replaceChildren();
    $("result-choice").hidden = true;
    draw();
    const holeMode = ["hole", "solid"].includes($("example").value);
    const jobs = adaptive
      ? [
          {
            model: structuredClone(previous.model),
            options: {
              base,
              minimum,
              refinement: [
                ...(previous.options.refinement || []).map((p) => ({
                  ...p,
                  h: p.h / 2,
                })),
                ...previous.estimator.hotspots,
              ].slice(0, 64),
            },
          },
        ]
      : study
        ? (["steel", "wood", "hole", "solid"].includes($("example").value)
            ? [false, true]
            : [null]
          ).flatMap((metal) =>
            [1, 0.5, 0.25].map((f) => {
              const m =
                metal === null
                  ? structuredClone(model)
                  : holeMode
                    ? FEMExamples.holeNode(metal)
                    : FEMExamples.windowNode(metal);
              if (metal === null)
                m.regions.forEach((r) => {
                  if (r.h) r.h *= f;
                });
              else if (!holeMode) m.regions[6].h = minimum * f;
              return {
                model: m,
                options: { base: base * f, minimum: minimum * f },
              };
            }),
          )
        : [{ model: structuredClone(model), options: { base, minimum } }];
    if (!study && !adaptive && ["steel", "wood"].includes($("example").value))
      jobs[0].model.regions[6].h = minimum;
    const id = revision;
    worker = new Worker("fem-worker.js?v=20261026-2");
    $("status").textContent = "Строю сетку…";
    worker.onmessage = ({ data }) => {
      if (data.id !== revision) return;
      if (data.message) $("status").textContent = data.message;
      if (data.error) {
        stop();
        $("status").textContent = "Расчёт не принят: " + data.error;
        return;
      }
      if (data.partial) {
        results.push(data.partial);
        show(data.partial);
        studyTable();
      }
      if (data.done) {
        stop();
        show(results.at(-1));
        controls();
        $("status").textContent =
          `Готово. ${results.length} расчёт(ов). Проверьте сходимость и ограничения.`;
        const select = $("result-choice");
        select.replaceChildren();
        results.forEach((r, i) => {
          const o = document.createElement("option");
          o.value = i;
          o.textContent = `${r.model.name} · h=${r.options.minimum} мм`;
          select.append(o);
        });
        select.value = results.length - 1;
        select.hidden = results.length < 2;
        studyTable();
      }
    };
    worker.onerror = (e) => {
      stop();
      $("status").textContent = "Ошибка Worker: " + e.message;
    };
    worker.postMessage({ id, jobs });
  }
  function download(name, blob) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function jsonDownload(name, data) {
    download(
      name,
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
  }
  $("example").onchange = select;
  $("run").onclick = () => run();
  $("study").onclick = () => run(true);
  $("cancel").onclick = () => {
    stop();
    $("status").textContent =
      "Расчёт отменён. Завершённые варианты доступны; незавершённое решение не принято.";
  };
  $("apply").onclick = applyControls;
  $("adapt").onclick = () => run(false, true);
  $("apply-json").onclick = () => {
    try {
      const m = JSON.parse($("model-json").value);
      if (!m.regions?.length) throw Error("Нужен массив regions.");
      ThermoFEM.validate(m);
      m.userEdited = true;
      model = m;
      $("example").value = "custom";
      invalidate();
      controls();
    } catch (e) {
      $("status").textContent = e.message;
    }
  };
  function savedModels() {
    const v = JSON.parse(localStorage.getItem("thermo2d.fem-nodes.v1") || "[]");
    if (!Array.isArray(v)) throw Error("Неверный формат сохранённых FEM-узлов");
    return v;
  }
  function savedModelChoices() {
    try {
      $("saved-model-choice").replaceChildren(
        ...savedModels().map((v, i) => new Option(v.name, i)),
      );
    } catch (e) {
      $("status").textContent = e.message;
    }
  }
  savedModelChoices();
  $("save-browser-model").onclick = () => {
    try {
      const saved = savedModels();
      saved.push({
        name: `${model.name || "Узел"} · ${new Date().toLocaleString("ru-RU")}`,
        model: structuredClone(model),
      });
      localStorage.setItem("thermo2d.fem-nodes.v1", JSON.stringify(saved));
      savedModelChoices();
      $("status").textContent =
        "Узел сохранён в этом браузере. Для переноса скачайте JSON.";
    } catch (e) {
      $("status").textContent = e.message;
    }
  };
  $("load-browser-model").onclick = () => {
    try {
      const saved = savedModels()[+$("saved-model-choice").value];
      if (!saved) return;
      const next = structuredClone(saved.model);
      ThermoFEM.validate(next);
      model = next;
      changed();
      zoom = 1;
      pan = { x: 0, y: 0 };
      draw();
    } catch (e) {
      $("status").textContent = e.message;
    }
  };
  $("save-custom-material").onclick = () => {
    try {
      const name = $("custom-material-name").value.trim(),
        lambda = +$("custom-material-lambda").value;
      if (!name || !Number.isFinite(lambda) || lambda <= 0)
        throw Error("Укажите название и положительную λ.");
      const optional = (id) => {
        const s = $(id).value;
        if (!s) return null;
        const v = +s;
        if (!Number.isFinite(v) || v <= 0)
          throw Error("ρ и c должны быть положительными или пустыми.");
        return v;
      };
      const m = {
        id: "user-" + crypto.randomUUID(),
        name,
        lambda,
        density: optional("custom-material-density"),
        heatCapacity: optional("custom-material-capacity"),
        color: "#bddcc2",
        hatch: "solid",
        note: "Задано пользователем",
      };
      const saved = JSON.parse(
        localStorage.getItem("thermo2d.material-library.v1") || "[]",
      );
      if (!Array.isArray(saved))
        throw Error("Неверный формат существующей библиотеки");
      localStorage.setItem(
        "thermo2d.material-library.v1",
        JSON.stringify([...saved, m]),
      );
      catalog.push(m);
      $("catalog-choice").add(new Option(`${m.name} · λ ${m.lambda}`, m.id));
      $("catalog-choice").value = m.id;
      catalogNote();
    } catch (e) {
      $("status").textContent = e.message;
    }
  };
  $("catalog-choice").onchange = catalogNote;
  $("assign-catalog").onclick = () => {
    const r = model.regions[+$("region-choice").value],
      m = catalog.find((m) => m.id === $("catalog-choice").value);
    if (!r || !m) return;
    Object.assign(r, {
      lambda: m.lambda,
      color: m.color,
      materialId: m.id,
      materialName: m.name,
      density: m.density,
      heatCapacity: m.heatCapacity,
      materialNote: m.note,
      materialSource: m.source,
    });
    delete r.materialPending;
    changed();
  };
  $("make-hole").onclick = () => {
    if (model.regions.length < 2) {
      $("status").textContent = "Нельзя удалить единственную область.";
      return;
    }
    const i = +$("region-choice").value;
    model.regions.splice(i, 1);
    model.boundaries = [];
    changed();
    $("status").textContent =
      "Область удалена. Граничные условия сброшены: назначьте их заново. Остальные контуры сохранены.";
  };
  $("import-dxf").onchange = async (e) => {
    try {
      const file = e.target.files[0];
      if (!file) return;
      const next = ThermoDXF.importModel(
        await file.text(),
        $("dxf-units").value,
      );
      model = next;
      model.name = file.name;
      zoom = 1;
      pan = { x: 0, y: 0 };
      changed();
      $("status").textContent =
        `Импортировано областей: ${model.regions.length}. Назначьте материалы и условия граням.`;
    } catch (e) {
      $("status").textContent = e.message;
    }
  };
  function setEdge(clear = false) {
    if (!selectedEdge) {
      $("status").textContent =
        "Включите «Выбрать грань» и щёлкните внешний контур.";
      return;
    }
    const temperature = +$("edge-temperature").value;
    if (
      !clear &&
      (!$("edge-temperature").value || !Number.isFinite(temperature))
    )
      return;
    const { a, b } = selectedEdge;
    // Remove only conditions collinear with this edge. Preserve their uncovered tails.
    const retained = [];
    for (const bc of model.boundaries || []) {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        l2 = dx * dx + dy * dy;
      const cross = (p) =>
        Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / Math.sqrt(l2);
      if (cross(bc.a) > 1e-6 || cross(bc.b) > 1e-6) {
        retained.push(bc);
        continue;
      }
      const t = (p) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
      const lo = Math.min(t(bc.a), t(bc.b)),
        hi = Math.max(t(bc.a), t(bc.b));
      const point = (u) => ({ x: a.x + u * dx, y: a.y + u * dy });
      if (hi <= 0 || lo >= 1) {
        retained.push(bc);
        continue;
      }
      if (lo < 0) retained.push({ ...bc, a: point(lo), b: point(0) });
      if (hi > 1) retained.push({ ...bc, a: point(1), b: point(hi) });
    }
    if (!clear)
      retained.push({
        name: `T=${temperature} °C`,
        a,
        b,
        type: "temperature",
        temperature,
      });
    model.boundaries = retained;
    changed();
  }
  $("set-edge").onclick = () => setEdge();
  $("clear-edge").onclick = () => setEdge(true);
  $("import").onchange = async (e) => {
    try {
      $("model-json").value = await e.target.files[0].text();
      $("apply-json").click();
    } catch (e) {
      $("status").textContent = e.message;
    }
  };
  $("save-model").onclick = () =>
    jsonDownload("Thermo2D-FEM-model.json", model);
  $("export-result").onclick = () =>
    jsonDownload("Thermo2D-FEM-result.json", {
      result,
      convergence: results.map((r) => ({
        name: r.model.name,
        options: r.options,
        stats: r.stats,
        heat: r.heat,
      })),
    });
  $("export-image").onclick = () => {
    const limits = range();
    if (
      !(
        Number.isFinite(limits.min) &&
        Number.isFinite(limits.max) &&
        limits.max >= limits.min
      )
    ) {
      $("status").textContent =
        "Укажите корректный диапазон шкалы перед экспортом.";
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 2200;
    paint(canvas, true, true);
    const ctx = canvas.getContext("2d"),
      { min, max } = range();
    ctx.fillStyle = "rgba(255,255,255,.96)";
    ctx.fillRect(0, 0, 2400, 180);
    ctx.fillStyle = "#18383d";
    ctx.font = "28px system-ui";
    ctx.fillText(
      `${model.name} · Q′=${fmt(result.heat.outgoing, 5)} Вт/м · Tsi,min=${fmt(result.heat.minSurface, 3)} °C`,
      40,
      42,
    );
    for (let x = 0; x < 2320; x++) {
      ctx.fillStyle = `rgb(${ThermoPalette.color(min + ((max - min) * x) / 2319, min, max)})`;
      ctx.fillRect(40 + x, 65, 1, 26);
    }
    ctx.fillStyle = "#18383d";
    ctx.font = "23px system-ui";
    for (let i = 0; i <= 8; i++) {
      ctx.textAlign = i === 8 ? "right" : i === 0 ? "left" : "center";
      ctx.fillText(
        `${fmt(min + ((max - min) * i) / 8, 1)} °C`,
        40 + (2320 * i) / 8,
        125,
      );
    }
    ctx.textAlign = "left";
    ctx.font = "19px system-ui";
    ctx.fillText(
      `2D — непрерывное включение; ${result.stats.elements} треугольников; рёбра ${fmt(result.stats.minEdge, 4)}…${fmt(result.stats.maxEdge, 2)} мм; баланс ${fmt(result.heat.balance * 100, 8)} %`,
      40,
      163,
    );
    canvas.toBlob((b) => download("Thermo2D-FEM.png", b));
  };
  $("result-choice").onchange = () => {
    show(results[+$("result-choice").value]);
    controls();
  };
  for (const id of [
    "mesh",
    "flux",
    "iso",
    "iso-value",
    "auto",
    "scale-min",
    "scale-max",
  ])
    $(id).oninput = schedule;
  for (const id of ["base", "minimum"]) $(id).oninput = invalidate;
  for (const id of ["target-q", "target-t"]) $(id).oninput = studyTable;
  $("fit").onclick = () => {
    zoom = 1;
    pan = { x: 0, y: 0 };
    draw();
  };
  for (const canvas of canvases) {
    canvas.onwheel = (e) => {
      e.preventDefault();
      zoom = Math.max(0.3, Math.min(60, zoom * Math.exp(-e.deltaY * 0.001)));
      schedule();
    };
    canvas.onpointerdown = (e) => {
      if ($("pick-edge").checked) {
        const box = canvas.getBoundingClientRect(),
          v = view(canvas.width, canvas.height);
        const p = {
          x: (((e.clientX - box.left) * canvas.width) / box.width - v.x) / v.s,
          y: (v.y - ((e.clientY - box.top) * canvas.height) / box.height) / v.s,
        };
        const edges = ThermoEdges.external(model),
          near = edges
            .map((edge) => ({
              edge,
              d: ThermoEdges.distance(p, edge.a, edge.b),
            }))
            .sort((a, b) => a.d - b.d)[0];
        selectedEdge =
          near && near.d * v.s < (14 * canvas.width) / box.width
            ? near.edge
            : null;
        $("edge-info").textContent = selectedEdge
          ? `Грань ${fmt(Math.hypot(selectedEdge.b.x - selectedEdge.a.x, selectedEdge.b.y - selectedEdge.a.y), 2)} мм`
          : "Внешняя грань не найдена";
        schedule();
        return;
      }
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointerup = () => (drag = null);
    canvas.onpointercancel = () => (drag = null);
    canvas.onpointermove = (e) => {
      const box = canvas.getBoundingClientRect();
      if (drag) {
        pan.x += (e.clientX - drag.x) / box.width;
        pan.y += (e.clientY - drag.y) / box.height;
        drag = { x: e.clientX, y: e.clientY };
        schedule();
        return;
      }
      if (!result) return;
      const v = view(canvas.width, canvas.height),
        p = {
          x: (((e.clientX - box.left) * canvas.width) / box.width - v.x) / v.s,
          y: (v.y - ((e.clientY - box.top) * canvas.height) / box.height) / v.s,
        };
      for (const t of result.triangles) {
        const [a, b, c] = t.v.map((i) => result.nodes[i]),
          det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y),
          u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / det,
          w = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / det;
        if (u >= -1e-8 && w >= -1e-8 && u + w <= 1 + 1e-8) {
          const temp =
            u * result.values[t.v[0]] +
            w * result.values[t.v[1]] +
            (1 - u - w) * result.values[t.v[2]];
          $("hover").textContent =
            `x=${fmt(p.x, 2)}, y=${fmt(p.y, 2)} мм · ${model.regions[t.region].name || t.region} · T=${fmt(temp, 3)} °C · |q|=${fmt(Math.hypot(...t.q), 2)} Вт/м²`;
          return;
        }
      }
      $("hover").textContent = "Вне расчётного материала.";
    };
  }
  window.addEventListener("resize", schedule);
  if (location.hash === "#editor") {
    try {
      const saved = sessionStorage.getItem("thermo2d.fem-transfer.v1");
      if (saved) {
        model = JSON.parse(saved);
        $("example").value = "custom";
      }
    } catch (e) {
      $("status").textContent = e.message;
    }
  }
  controls();
  draw();
})();
