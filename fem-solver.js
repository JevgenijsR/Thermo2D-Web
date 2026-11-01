/* Thermo2D P1 FEM. Coordinates mm, lambda W/(m K), Q' W/m.
 * Conforming vertical decomposition of disjoint polygonal materials, including
 * holes. Every shared vertical trace uses the same nodes. No raster geometry.
 * Sweep refinement is graded but anisotropic; it is not a Delaunay mesher.
 */
(function thermoSolver(root) {
  "use strict";
  const EPS = 1e-7,
    finite = Number.isFinite;
  const cross = (a, b, c) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const unique = (a) =>
    a.sort((a, b) => a - b).filter((v, i, a) => !i || v - a[i - 1] > EPS);
  function distance(p, a, b) {
    const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = d
      ? Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / d,
          ),
        )
      : 0;
    return Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y));
  }
  const area = (poly) =>
    Math.abs(
      poly.reduce(
        (s, p, i) =>
          s +
          p.x * poly[(i + 1) % poly.length].y -
          p.y * poly[(i + 1) % poly.length].x,
        0,
      ),
    ) / 2;
  function inside(p, poly) {
    let yes = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i],
        b = poly[j];
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      )
        yes = !yes;
    }
    return yes;
  }
  function validate(model) {
    if (!model.regions?.length) throw Error("Нет материальных областей.");
    const segments = [];
    model.regions.forEach((r, ri) => {
      if (r.temperature !== undefined && !finite(r.temperature))
        throw Error("Некорректная температура области.");
      if (!(finite(r.lambda) && r.lambda > 0))
        throw Error(`Не назначена положительная λ: ${r.name || ri}`);
      if (r.h !== undefined && !(finite(r.h) && r.h > EPS))
        throw Error("Локальный размер должен быть положительным.");
      for (const poly of [r.points, ...(r.holes || [])]) {
        if (
          !poly ||
          poly.length < 3 ||
          poly.some((p) => !finite(p.x) || !finite(p.y)) ||
          area(poly) < EPS
        )
          throw Error("Нулевой или некорректный контур.");
        poly.forEach((a, i) => {
          const b = poly[(i + 1) % poly.length];
          if (length(a, b) < EPS) throw Error("Нулевое ребро контура.");
          segments.push({ a, b, ri });
        });
      }
    });
    for (let i = 0; i < segments.length; i++)
      for (let j = i + 1; j < segments.length; j++) {
        const { a, b } = segments[i],
          { a: c, b: d } = segments[j];
        if (
          cross(a, b, c) * cross(a, b, d) < -(EPS ** 2) &&
          cross(c, d, a) * cross(c, d, b) < -(EPS ** 2)
        )
          throw Error(
            "Пересечение контуров. Разбейте материалы по общим интерфейсам.",
          );
      }
    for (const bc of model.boundaries || [])
      if (
        !finite(bc.temperature) ||
        !bc.a ||
        !bc.b ||
        length(bc.a, bc.b) < EPS ||
        ![bc.a.x, bc.a.y, bc.b.x, bc.b.y].every(finite) ||
        (bc.type === "film" && !(finite(bc.h) && bc.h > 0))
      )
        throw Error("Некорректное граничное условие.");
    return segments;
  }
  function mesh(model, options = {}) {
    const start = Date.now(),
      segments = validate(model),
      base = options.base ?? 20,
      minimum = options.minimum ?? 0.8;
    if (!(finite(base) && finite(minimum) && base >= minimum && minimum > EPS))
      throw Error("Размеры сетки: 0 < минимальный ≤ базовый.");
    const regions = model.regions,
      pts = segments.map((e) => e.a);
    const features = regions.map((r, ri) => {
      const a =
        area(r.points) - (r.holes || []).reduce((s, p) => s + area(p), 0);
      if (a <= EPS) throw Error("Отверстия превышают площадь области.");
      const perimeter = r.points.reduce(
        (s, p, i) => s + length(p, r.points[(i + 1) % r.points.length]),
        0,
      );
      return {
        ri,
        rectangle:
          r.points.length === 4 &&
          !(r.holes || []).length &&
          r.points.every(
            (p, i) =>
              Math.abs(p.x - r.points[(i + 1) % 4].x) < EPS ||
              Math.abs(p.y - r.points[(i + 1) % 4].y) < EPS,
          ),
        minX: Math.min(...r.points.map((p) => p.x)),
        maxX: Math.max(...r.points.map((p) => p.x)),
        minY: Math.min(...r.points.map((p) => p.y)),
        maxY: Math.max(...r.points.map((p) => p.y)),
        h: Math.max(minimum, Math.min(base, r.h ?? (2 * a) / perimeter / 5)),
      };
    });
    const refinement = options.refinement || [];
    if (
      refinement.length > 64 ||
      refinement.some((p) => ![p.x, p.y, p.h].every(finite) || p.h <= 0)
    )
      throw Error("Некорректные точки локального сгущения.");
    const size = (x, y) => {
      const local = refinement.reduce(
        (h, p) =>
          Math.min(
            h,
            Math.max(minimum, p.h) +
              0.35 * Math.hypot(x - p.x, y === undefined ? 0 : y - p.y),
          ),
        base,
      );
      return features.reduce((h, f) => {
        let d = Math.hypot(
          Math.max(f.minX - x, 0, x - f.maxX),
          y === undefined ? 0 : Math.max(f.minY - y, 0, y - f.maxY),
        );
        if (y !== undefined && !f.rectangle && f.h + 0.35 * d < h) {
          const r = regions[f.ri],
            p = { x, y };
          d =
            inside(p, r.points) &&
            !(r.holes || []).some((poly) => inside(p, poly))
              ? 0
              : segments
                  .filter((e) => e.ri === f.ri)
                  .reduce(
                    (v, e) => Math.min(v, distance(p, e.a, e.b)),
                    Infinity,
                  );
        }
        return Math.min(h, f.h + 0.35 * d);
      }, local);
    };
    const knots = unique([
      ...pts.map((p) => p.x),
      ...(model.boundaries || []).flatMap((b) => [b.a.x, b.b.x]),
    ]);
    const xs = [knots[0]];
    for (let k = 1; k < knots.length; k++) {
      let x = knots[k - 1];
      while (x < knots[k] - EPS) {
        const d = Math.min(size(x), size(Math.min(knots[k], x + size(x))));
        x = knots[k] - x <= 1.5 * d ? knots[k] : x + d;
        xs.push(x);
        if (xs.length > 15000)
          throw Error("Слишком много полос сетки. Увеличьте размер элемента.");
      }
    }
    const ys = xs.map(() => []),
      slabs = [];
    const yAt = (e, x) =>
      e.a.y + ((e.b.y - e.a.y) * (x - e.a.x)) / (e.b.x - e.a.x);
    for (let i = 0; i < xs.length - 1; i++) {
      const xm = (xs[i] + xs[i + 1]) / 2,
        parts = [];
      regions.forEach((r, ri) => {
        const hits = segments
          .filter(
            (e) =>
              e.ri === ri &&
              xm > Math.min(e.a.x, e.b.x) &&
              xm < Math.max(e.a.x, e.b.x),
          )
          .sort((a, b) => yAt(a, xm) - yAt(b, xm));
        if (hits.length % 2) throw Error("Незамкнутая область.");
        for (let k = 0; k < hits.length; k += 2) {
          const lo = hits[k],
            hi = hits[k + 1];
          const part = {
            ri,
            l0: yAt(lo, xs[i]),
            l1: yAt(hi, xs[i]),
            r0: yAt(lo, xs[i + 1]),
            r1: yAt(hi, xs[i + 1]),
            mid0: yAt(lo, xm),
            mid1: yAt(hi, xm),
          };
          if (part.mid1 - part.mid0 <= EPS) throw Error("Вырожденная область.");
          parts.push(part);
          ys[i].push(part.l0, part.l1);
          ys[i + 1].push(part.r0, part.r1);
        }
      });
      parts.sort((a, b) => a.mid0 - b.mid0);
      for (let j = 1; j < parts.length; j++)
        if (parts[j].mid0 < parts[j - 1].mid1 - EPS)
          throw Error("Наложение материалов или отверстие вне своего контура.");
      slabs.push(parts);
    }
    // Insert BC endpoints on traces before subdivision so partial edges are exact.
    for (const bc of model.boundaries || [])
      for (const p of [bc.a, bc.b]) {
        const i = xs.findIndex((x) => Math.abs(x - p.x) < EPS);
        if (i >= 0) ys[i].push(p.y);
      }
    const nodes = [],
      traces = ys.map((values, i) => {
        const v = unique(values),
          out = [];
        for (let j = 0; j < v.length; j++) {
          if (j) {
            let y = v[j - 1];
            while (y < v[j] - EPS) {
              const d = Math.min(
                size(xs[i], y),
                size(xs[i], Math.min(v[j], y + size(xs[i], y))),
              );
              y = v[j] - y <= 1.5 * d ? v[j] : y + d;
              out.push(y);
              if (!options.unlimited && out.length + nodes.length > 200000)
                throw Error(
                  "Сетка превышает 200 000 узлов. Увеличьте размер элемента.",
                );
            }
          } else out.push(v[j]);
        }
        if (!options.unlimited && out.length + nodes.length > 200000)
          throw Error(
            "Сетка превышает 200 000 узлов. Увеличьте размер элемента.",
          );
        return out.map((y) => {
          const id = nodes.length;
          nodes.push({ x: xs[i], y });
          return id;
        });
      });
    let triangles = [];
    const add = (a, b, c, ri) => {
      const det = cross(nodes[a], nodes[b], nodes[c]);
      if (Math.abs(det) < EPS) return;
      triangles.push({ v: det > 0 ? [a, b, c] : [a, c, b], region: ri });
    };
    slabs.forEach((parts, i) =>
      parts.forEach((p) => {
        const l = traces[i].filter(
            (n) => nodes[n].y >= p.l0 - EPS && nodes[n].y <= p.l1 + EPS,
          ),
          r = traces[i + 1].filter(
            (n) => nodes[n].y >= p.r0 - EPS && nodes[n].y <= p.r1 + EPS,
          );
        let a = 0,
          b = 0;
        while (a < l.length - 1 || b < r.length - 1) {
          if (
            b === r.length - 1 ||
            (a < l.length - 1 &&
              length(nodes[l[a + 1]], nodes[r[b]]) <=
                length(nodes[l[a]], nodes[r[b + 1]]))
          ) {
            add(l[a], r[b], l[a + 1], p.ri);
            a++;
          } else {
            add(l[a], r[b], r[b + 1], p.ri);
            b++;
          }
        }
      }),
    );
    // Remove unused trace nodes outside materials; no artificial air elements.
    const used = new Set(triangles.flatMap((t) => t.v)),
      map = new Map(),
      compact = [];
    nodes.forEach((p, i) => {
      if (used.has(i)) {
        map.set(i, compact.length);
        compact.push(p);
      }
    });
    triangles.forEach((t) => (t.v = t.v.map((i) => map.get(i))));
    if (!options.unlimited && triangles.length > 300000)
      throw Error("Сетка превышает 300 000 треугольников.");
    const edges = new Map(),
      areas = regions.map(() => 0);
    let minEdge = Infinity,
      maxEdge = 0,
      minAngle = 180;
    triangles.forEach((t, ti) => {
      const p = t.v.map((i) => compact[i]),
        a = cross(...p) / 2;
      areas[t.region] += a;
      for (let k = 0; k < 3; k++) {
        const u = t.v[k],
          v = t.v[(k + 1) % 3],
          key = edgeKey(u, v),
          e = edges.get(key) || { v: [u, v], triangles: [] };
        e.triangles.push(ti);
        edges.set(key, e);
        const d = length(compact[u], compact[v]);
        minEdge = Math.min(minEdge, d);
        maxEdge = Math.max(maxEdge, d);
        const b = p[(k + 1) % 3],
          c = p[(k + 2) % 3];
        minAngle = Math.min(
          minAngle,
          (Math.acos(
            Math.max(
              -1,
              Math.min(
                1,
                ((b.x - p[k].x) * (c.x - p[k].x) +
                  (b.y - p[k].y) * (c.y - p[k].y)) /
                  (length(p[k], b) * length(p[k], c)),
              ),
            ),
          ) *
            180) /
            Math.PI,
        );
      }
    });
    regions.forEach((r, i) => {
      const expected =
        area(r.points) - (r.holes || []).reduce((s, p) => s + area(p), 0);
      if (Math.abs(areas[i] - expected) > 1e-6 * Math.max(1, expected))
        throw Error(
          "Площадь сетки не совпадает с геометрией. Проверьте отверстия.",
        );
    });
    const boundaryEdges = [];
    for (const e of edges.values()) {
      if (e.triangles.length > 2) throw Error("Несогласованный интерфейс.");
      if (e.triangles.length === 1) {
        const [a, b] = e.v.map((i) => compact[i]);
        if (
          !segments.some(
            (s) => distance(a, s.a, s.b) < EPS && distance(b, s.a, s.b) < EPS,
          )
        )
          throw Error("Внутренняя трещина сетки.");
        boundaryEdges.push(e);
      }
    }
    return {
      nodes: compact,
      triangles,
      boundaryEdges,
      stats: {
        nodes: compact.length,
        elements: triangles.length,
        minEdge,
        maxEdge,
        minAngle,
        areas,
        meshMs: Date.now() - start,
      },
      options: { base, minimum, refinement },
    };
  }
  function solve(model, options = {}, progress = () => {}) {
    const start = Date.now();
    progress("Построение согласованной сетки");
    // options.mesh reuses an existing mesh (vapour on the thermal mesh); its
    // triangles must be fresh copies because solve() stores data on them.
    const m = options.mesh || mesh(model, options),
      { nodes, triangles } = m,
      n = nodes.length;
    const rows = Array.from({ length: n }, () => new Map()),
      rhs = new Float64Array(n),
      fixed = new Map(),
      boundary = [],
      add = (i, j, v) => rows[i].set(j, (rows[i].get(j) || 0) + v);
    triangles.forEach((t) => {
      const p = t.v.map((i) => nodes[i]),
        det = cross(...p),
        lambda = model.regions[t.region].lambda;
      t.grad = [
        [p[1].y - p[2].y, p[2].x - p[1].x],
        [p[2].y - p[0].y, p[0].x - p[2].x],
        [p[0].y - p[1].y, p[1].x - p[0].x],
      ].map((g) => g.map((v) => v / det));
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          add(
            t.v[i],
            t.v[j],
            ((lambda * det) / 2) *
              (t.grad[i][0] * t.grad[j][0] + t.grad[i][1] * t.grad[j][1]),
          );
    });
    function prescribe(i, value) {
      if (fixed.has(i) && Math.abs(fixed.get(i) - value) > EPS)
        throw Error("Конфликт температур в общей вершине.");
      fixed.set(i, value);
    }
    // Surface temperatures may jump at a shared vertex (ISO 10211 case 1).
    // The vertex takes the mean; the error is local and shrinks with the mesh.
    const surface = new Map(),
      matched = new Set(),
      covered = (model.boundaries || []).map(() => 0);
    for (const e of m.boundaryEdges) {
      const [i, j] = e.v,
        [a, b] = e.v.map((i) => nodes[i]);
      const hits = (model.boundaries || [])
        .map((bc, index) => ({ bc, index }))
        .filter(
          ({ bc }) =>
            distance(a, bc.a, bc.b) < EPS && distance(b, bc.a, bc.b) < EPS,
        );
      if (!hits.length) continue;
      const { bc, index } = hits[0];
      hits.forEach((h) => {
        matched.add(h.index);
        covered[h.index] += length(a, b);
        if (
          h.bc.type !== bc.type ||
          h.bc.temperature !== bc.temperature ||
          h.bc.h !== bc.h
        )
          throw Error("Конфликт условий на совпадающих гранях.");
      });
      const L = length(a, b) / 1000;
      if (bc.type === "film") {
        add(i, i, (bc.h * L) / 3);
        add(j, j, (bc.h * L) / 3);
        add(i, j, (bc.h * L) / 6);
        add(j, i, (bc.h * L) / 6);
        rhs[i] += (bc.h * L * bc.temperature) / 2;
        rhs[j] += (bc.h * L * bc.temperature) / 2;
      } else
        for (const k of [i, j])
          surface.set(k, [...(surface.get(k) || []), bc.temperature]);
      boundary.push({ v: [i, j], index, L, bc });
    }
    if (matched.size !== (model.boundaries || []).length)
      throw Error(
        "Условие не совпадает с внешней гранью. Внутренние температурные грани FEM пока не поддерживает.",
      );
    (model.boundaries || []).forEach((bc, i) => {
      if (Math.abs(covered[i] - length(bc.a, bc.b)) > EPS * 10)
        throw Error(
          "Граничное условие покрывает зазор или только часть внешней грани. Разбейте условие по геометрии.",
        );
    });
    const temperatureJumps = [];
    for (const [i, values] of surface) {
      const low = Math.min(...values),
        high = Math.max(...values);
      if (high - low > EPS) {
        if (!options.allowTemperatureJumps) throw Error("Конфликт температур в общей вершине. Разрыв допускается только в явно заданном проверочном расчёте.");
        temperatureJumps.push({ ...nodes[i], low, high });
      }
      prescribe(i, (low + high) / 2);
    }
    triangles.forEach((t) => {
      const v = model.regions[t.region].temperature;
      if (finite(v)) t.v.forEach((i) => prescribe(i, v));
    });
    // Extra node values (Glaser clamps); nodes already fixed keep their value.
    const clamped = [];
    for (const [i, v] of options.fixedNodes || [])
      if (!fixed.has(i)) {
        fixed.set(i, v);
        clamped.push(i);
      }
    // A separate connected component needs its own temperature anchor.
    const anchored = new Set([
        ...fixed.keys(),
        ...boundary.filter((e) => e.bc.type === "film").flatMap((e) => e.v),
      ]),
      seen = new Set();
    for (let i = 0; i < n; i++)
      if (!seen.has(i)) {
        const queue = [i];
        seen.add(i);
        let anchor = false;
        for (let k = 0; k < queue.length; k++) {
          const v = queue[k];
          anchor ||= anchored.has(v);
          for (const j of rows[v].keys())
            if (!seen.has(j)) {
              seen.add(j);
              queue.push(j);
            }
        }
        if (!anchor) throw Error("Отдельная область без температурной опоры.");
      }
    const original = rows.map((r) => new Map(r)),
      originalRhs = rhs.slice();
    for (let i = 0; i < n; i++) {
      if (fixed.has(i)) {
        rows[i] = new Map([[i, 1]]);
        rhs[i] = fixed.get(i);
      } else
        for (const [j, v] of rows[i])
          if (fixed.has(j)) {
            rhs[i] -= v * fixed.get(j);
            rows[i].delete(j);
          }
    }
    const sparse = rows.map((r) => [...r]),
      diag = rows.map((r, i) => r.get(i));
    // Symmetric Gauss-Seidel preconditioner remains positive for SPD matrices,
    // including obtuse elements; no unsafe IC pivot clipping.
    const lower = sparse.map((r, i) => r.filter(([j]) => j < i)),
      upper = sparse.map((r, i) => r.filter(([j]) => j > i));
    const x = new Float64Array(n),
      r = new Float64Array(n),
      z = new Float64Array(n),
      p = new Float64Array(n),
      ap = new Float64Array(n);
    const multiply = (v, out) => {
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (const [j, a] of sparse[i]) s += a * v[j];
        out[i] = s;
      }
    };
    const precondition = () => {
      for (let i = 0; i < n; i++) {
        let s = r[i];
        for (const [j, a] of lower[i]) s -= a * z[j];
        z[i] = s / diag[i];
      }
      for (let i = n - 1; i >= 0; i--) {
        let s = z[i] * diag[i];
        for (const [j, a] of upper[i]) s -= a * z[j];
        z[i] = s / diag[i];
      }
    };
    const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
    const residual = () => {
      multiply(x, ap);
      let max = 0;
      for (let i = 0; i < n; i++) {
        r[i] = rhs[i] - ap[i];
        max = Math.max(max, Math.abs(r[i]));
      }
      return max;
    };
    const tolerance = options.tolerance ?? 1e-9,
      maxIterations = options.maxIterations ?? 20000;
    let error = residual(),
      iteration = 0;
    precondition();
    p.set(z);
    let rz = dot(r, z);
    while (error > tolerance && iteration < maxIterations) {
      multiply(p, ap);
      const den = dot(p, ap);
      if (!(den > 0)) break;
      const alpha = rz / den;
      for (let i = 0; i < n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * ap[i];
      }
      iteration++;
      error = r.reduce((s, v) => Math.max(s, Math.abs(v)), 0);
      if (iteration % 100 === 0 || error <= tolerance) {
        error = residual();
        progress(
          `Решение · ${n} узлов · ${iteration} итераций · ${error.toExponential(1)} Вт/м`,
        );
      }
      precondition();
      const next = dot(r, z),
        beta = next / rz;
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
      rz = next;
    }
    error = residual();
    const reactions = new Float64Array(n);
    for (const [i] of fixed) {
      let v = -originalRhs[i];
      for (const [j, a] of original[i]) v += a * x[j];
      reactions[i] = v;
    }
    const heatRows = [],
      byIndex = new Map();
    let incoming = 0,
      outgoing = 0,
      minSurface = Infinity,
      minSurfacePoint = null;
    function flow(q) {
      incoming += Math.max(0, -q);
      outgoing += Math.max(0, q);
    }
    const claimed = new Set();
    for (const e of boundary) {
      let q = 0;
      if (e.bc.type === "film")
        q = e.bc.h * e.L * ((x[e.v[0]] + x[e.v[1]]) / 2 - e.bc.temperature);
      else
        for (const i of e.v)
          if (!claimed.has(i)) {
            q -= reactions[i];
            claimed.add(i);
          }
      const row = byIndex.get(e.index) || {
        name: e.bc.name || `Грань ${e.index + 1}`,
        boundaryIndex: e.index,
        outward: 0,
        length: 0,
      };
      row.outward += q;
      row.length += e.L;
      byIndex.set(e.index, row);
      if (e.bc.interior)
        for (const i of e.v)
          if (x[i] < minSurface) {
            minSurface = x[i];
            minSurfacePoint = nodes[i];
          }
    }
    for (const row of byIndex.values()) {
      heatRows.push(row);
      flow(row.outward);
    }
    let source = 0;
    for (const [i] of fixed) if (!claimed.has(i)) source -= reactions[i];
    if (source) {
      heatRows.push({ name: "Фиксированные области", outward: source });
      flow(source);
    }
    triangles.forEach((t) => {
      const k = model.regions[t.region].lambda;
      t.q = [0, 0];
      t.v.forEach((i, j) => {
        t.q[0] -= k * 1000 * t.grad[j][0] * x[i];
        t.q[1] -= k * 1000 * t.grad[j][1] * x[i];
      });
      delete t.grad;
    });
    // A posteriori jump indicator: identifies locations to refine, not a
    // certified upper bound for heat-loss or surface-temperature error.
    const adjacent = new Map(),
      hotspots = [],
      { base, minimum } = m.options;
    let jumpEnergy = 0,
      energy = 0;
    triangles.forEach((t, ti) => {
      const k = model.regions[t.region].lambda;
      energy +=
        ((cross(...t.v.map((i) => nodes[i])) / 2e6) *
          (t.q[0] ** 2 + t.q[1] ** 2)) /
        k;
      for (let j = 0; j < 3; j++) {
        const a = t.v[j],
          b = t.v[(j + 1) % 3],
          key = edgeKey(a, b),
          other = adjacent.get(key);
        if (other === undefined) {
          adjacent.set(key, ti);
          continue;
        }
        const s = triangles[other],
          pa = nodes[a],
          pb = nodes[b],
          L = length(pa, pb);
        const jump =
          ((t.q[0] - s.q[0]) * (pb.y - pa.y) -
            (t.q[1] - s.q[1]) * (pb.x - pa.x)) /
          L;
        const score =
          ((L / 1000) ** 2 * jump ** 2) / (k + model.regions[s.region].lambda);
        jumpEnergy += score;
        if (score > 1e-20) {
          const p = {
            x: (pa.x + pb.x) / 2,
            y: (pa.y + pb.y) / 2,
            h: Math.max(minimum / 2, Math.min(base / 2, L / 2)),
            score,
          };
          const near = hotspots.findIndex(
            (q) =>
              Math.hypot(q.x - p.x, q.y - p.y) <
              Math.max(minimum * 4, base / 4),
          );
          if (near >= 0) {
            if (score > hotspots[near].score) hotspots[near] = p;
          } else {
            hotspots.push(p);
            hotspots.sort((a, b) => b.score - a.score);
            if (hotspots.length > 24) hotspots.pop();
          }
        }
        adjacent.delete(key);
      }
    });
    const balance =
        Math.abs(outgoing - incoming) / Math.max(incoming, outgoing, 1e-12),
      converged =
        error <= tolerance &&
        Math.abs(outgoing - incoming) <
          1e-7 + Math.max(incoming, outgoing) * 1e-6;
    return {
      ...m,
      values: Array.from(x),
      model,
      estimator: {
        relativeIndicator: energy > 1e-20 ? Math.sqrt(jumpEnergy / energy) : 0,
        hotspots,
      },
      heat: {
        incoming,
        outgoing,
        balance,
        rows: heatRows,
        minSurface: finite(minSurface) ? minSurface : null,
        minSurfacePoint,
      },
      temperatureJumps,
      clampedReactions: clamped.map((i) => [i, reactions[i]]),
      stats: {
        ...m.stats,
        iterations: iteration,
        residual: error,
        elapsedMs: Date.now() - start,
      },
      converged,
    };
  }
  // Saturation pressure and its inverse, ISO 13788 (Pa, °C).
  const psat = (t) =>
    610.5 *
    Math.exp(t >= 0 ? (17.269 * t) / (237.3 + t) : (21.875 * t) / (265.5 + t));
  function dewPoint(p) {
    const x = Math.log(p / 610.5);
    return x >= 0 ? (237.3 * x) / (17.269 - x) : (265.5 * x) / (21.875 - x);
  }
  const DELTA0 = 2e-10; // kg/(m·s·Pa), vapour permeability of still air, ISO 13788
  // μ of a region; a thin layer may give sd (m) instead, then μ = sd / thickness,
  // with thickness 2·area/perimeter (exact for a long thin strip).
  function regionMu(r) {
    if (!(r.sd > 0)) return r.mu;
    const a =
        area(r.points) - (r.holes || []).reduce((s, p) => s + area(p), 0),
      perimeter = r.points.reduce(
        (s, p, i) => s + length(p, r.points[(i + 1) % r.points.length]),
        0,
      );
    return r.sd / ((2 * a) / perimeter / 1000);
  }
  /* Steady vapour diffusion on the thermal mesh: Glaser method of ISO 13788,
   * extended to 2D (engineering extension, not a standardised 2D method).
   * δ = δ0/μ. Faces with role room / outside get p = φ·psat(θ of their air),
   * ground faces p = psat (saturated soil); faces without a role are
   * vapour-tight. Where p would exceed psat(T) the node is clamped to psat and
   * the excess inflow is the condensation rate; clamps that would dry are
   * released and the field is solved again until the set is stable.
   * No capillary transport, sorption, rain or air leakage. */
  function vapour(model, thermal, climate, progress = () => {}) {
    const missing = model.regions.filter(
      (r) => !(r.sd > 0) && !(finite(r.mu) && r.mu > 0),
    );
    if (missing.length)
      throw Error(
        `Для расчёта влаги задайте μ (или sd): ${missing
          .slice(0, 5)
          .map((r) => r.name)
          .join(", ")}${missing.length > 5 ? " …" : ""}.`,
      );
    if (!(climate.room > 0 && climate.room <= 100) || !(climate.outside > 0 && climate.outside <= 100))
      throw Error("Относительная влажность должна быть от 0 до 100 %.");
    const phi = { room: climate.room / 100, outside: climate.outside / 100, ground: 1 },
      faces = (model.boundaries || []).filter((b) => b.role in phi);
    if (!faces.some((b) => b.role === "room"))
      throw Error("Для расчёта влаги отметьте грани комнаты: «Куда» = Комната.");
    if (faces.some(b => b.role !== "ground" && b.type !== "film"))
      throw Error("Для расчёта влажности задайте температуру воздуха и h у комнаты/улицы; температура поверхности не является температурой воздуха.");
    const vm = {
      regions: model.regions.map((r) => ({
        name: r.name,
        points: r.points,
        holes: r.holes,
        lambda: 1 / regionMu(r),
      })),
      boundaries: faces.map((b) => ({
        name: b.name,
        a: b.a,
        b: b.b,
        type: "temperature",
        temperature: phi[b.role] * psat(b.temperature),
      })),
    };
    const { nodes, boundaryEdges } = thermal,
      T = thermal.values,
      n = nodes.length,
      sat = Float64Array.from(T, psat),
      onFace = (bcs, e) =>
        bcs.some((bc) =>
          e.v.every((i) => distance(nodes[i], bc.a, bc.b) < EPS),
        ),
      faceNodes = new Set(
        boundaryEdges.filter((e) => onFace(faces, e)).flatMap((e) => e.v),
      );
    const run = (fixedNodes) =>
      solve(
        vm,
        {
          tolerance: 1e-7,
          fixedNodes,
          mesh: {
            nodes,
            boundaryEdges,
            stats: thermal.stats,
            options: thermal.options,
            triangles: thermal.triangles.map((t) => ({ v: t.v, region: t.region })),
          },
        },
        (message) => progress(`Влага · ${message}`),
      );
    let clamp = new Map(),
      r,
      iterations = 0,
      stable = false;
    const maxIterations = climate.maxIterations ?? 200;
    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 1000) throw Error("Недопустимый лимит итераций конденсации.");
    while (iterations < maxIterations) {
      iterations++;
      r = run(clamp);
      if (!r.converged) throw Error("Расчёт диффузии пара не сошёлся; результат не принят.");
      const g = new Map(r.clampedReactions),
        next = new Map();
      for (const [i] of clamp) if (g.get(i) < 0) next.set(i, sat[i]);
      for (let i = 0; i < n; i++)
        if (!clamp.has(i) && !faceNodes.has(i) && r.values[i] > sat[i] * (1 + 1e-9))
          next.set(i, sat[i]);
      if (next.size === clamp.size && [...next.keys()].every((i) => clamp.has(i))) {
        stable = true;
        break;
      }
      clamp = next;
    }
    if (!stable) throw Error(`Зона конденсации не сошлась за ${maxIterations} итераций; результат не принят.`);
    // Inflow into a clamped node = −reaction; that is the condensation rate.
    const condensing = r.clampedReactions
      .map(([i, v]) => ({ node: i, x: nodes[i].x, y: nodes[i].y, rate: -v * DELTA0 }))
      .filter((c) => c.rate > 0);
    const regionsOf = Array.from({ length: n }, () => new Set());
    thermal.triangles.forEach((t) => t.v.forEach((i) => regionsOf[i].add(t.region)));
    const byRegion = new Map();
    for (const c of condensing)
      for (const ri of regionsOf[c.node])
        byRegion.set(ri, (byRegion.get(ri) || 0) + c.rate / regionsOf[c.node].size);
    let inside = { rh: 0, x: null, y: null };
    for (let i = 0; i < n; i++)
      if (!faceNodes.has(i) && r.values[i] / sat[i] > inside.rh)
        inside = { rh: r.values[i] / sat[i], x: nodes[i].x, y: nodes[i].y };
    const assessment=surfaceHumidity(model,thermal,climate);
    const {surface,factor}=assessment;
    const boundaryNet=r.heat.rows.filter(row=>row.boundaryIndex!==undefined).reduce((sum,row)=>sum+row.outward*DELTA0,0);
    const totalRate=condensing.reduce((sum,c)=>sum+c.rate,0);
    const massResidual=boundaryNet+totalRate;
    if(Math.abs(massResidual)>1e-12+1e-5*Math.max(totalRate,Math.abs(boundaryNet))) throw Error("Нарушен баланс массы пара; результат не принят.");
    return {
      values: r.values,
      saturation: Array.from(sat),
      condensing,
      total: condensing.reduce((s, c) => s + c.rate, 0),
      byRegion: [...byRegion].map(([ri, rate]) => ({ name: model.regions[ri].name, rate })),
      inside,
      surface,
      factor,
      climate: assessment.climate,
      massResidual,
      iterations,
      stable,
      converged: stable && r.converged,
    };
  }
  function surfaceHumidity(model, thermal, climate) {
    if (!(finite(climate.room) && climate.room > 0 && climate.room <= 100)) throw Error("Задайте влажность комнаты от 0 до 100 %.");
    const {nodes,boundaryEdges}=thermal, T=thermal.values, sat=Float64Array.from(T,psat),
      phi={room:climate.room/100}, faces=(model.boundaries||[]).filter(b=>["room","outside","ground"].includes(b.role)),
      onFace=(bcs,e)=>bcs.some(b=>e.v.every(i=>distance(nodes[i],b.a,b.b)<EPS));
    const interiors=(model.boundaries||[]).filter(b=>b.interior);
    if(!interiors.length && climate.mode === "surface") throw Error("Отметьте внутреннюю поверхность для оценки влажности.");
    if(interiors.some(b=>b.type!=="film")) throw Error("Для оценки влажности поверхности задайте температуру воздуха и h.");

    let surface = null;
    for (const bc of (model.boundaries || []).filter((b) => b.interior)) {
      const p = phi.room * psat(bc.temperature);
      for (const e of boundaryEdges)
        if (onFace([bc], e))
          for (const i of e.v) {
            const rh = p / sat[i];
            if (!surface || rh > surface.rh)
              surface = { rh, t: T[i], x: nodes[i].x, y: nodes[i].y, air: bc.temperature, p, h: bc.type === "film" ? bc.h : null };
          }
    }
    const temps = (role) => [...new Set(faces.filter((b) => b.role === role).map((b) => b.temperature))],
      room = temps("room"),
      outside = temps("outside"),
      p0 = room.length === 1 ? phi.room * psat(room[0]) : null,
      single = room.length === 1 && outside.length === 1 && room[0] !== outside[0] && !model.regions.some(r=>finite(r.temperature)) && !faces.some(b=>b.role==="ground");
    const factor = single && thermal.heat.minSurface !== null
      ? {
          fRsi: (thermal.heat.minSurface - outside[0]) / (room[0] - outside[0]),
          // Mould: surface RH ≤ 80 %, ISO 13788.
          fRsiMin: (dewPoint(p0 / 0.8) - outside[0]) / (room[0] - outside[0]),
        }
      : null;
    return {surfaceOnly:true, surface, factor, condensing:[], climate:{...climate, roomTemperatures:room,outsideTemperatures:outside,roomPressure:p0,dewPoint:p0?dewPoint(p0):null,mouldTemperature:p0?dewPoint(p0/0.8):null}};
  }
  // Volumetric heat capacity ρc, J/(m³·K): given directly (ground, ISO 13370)
  // or as density × specific heat.
  const heatCapacityOf = (r) =>
    r.rhoC > 0 ? r.rhoC : r.density > 0 && r.heatCapacity > 0 ? r.density * r.heatCapacity : null;
  // Temperatures per role at time t (s): linear between key frames, constant
  // outside them. Roles not set in any frame are absent (faces keep their own T).
  function scenarioAt(frames, t) {
    const out = {};
    for (const role of ["room", "outside", "ground"]) {
      const keyed = frames.filter((f) => finite(f[role]));
      if (!keyed.length) continue;
      const k = keyed.findIndex((f) => f.t >= t);
      if (k < 0) out[role] = keyed.at(-1)[role];
      else if (k === 0) out[role] = keyed[0][role];
      else {
        const a = keyed[k - 1],
          b = keyed[k],
          s = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        out[role] = a[role] + s * (b[role] - a[role]);
      }
    }
    return out;
  }
  /* Transient conduction ρc·∂T/∂t = ∇·(λ∇T) on the steady mesh. Implicit
   * Euler with a lumped mass matrix: stable for SPD systems, first order in time.
   * A discrete maximum principle additionally depends on mesh and boundary matrices. The step is constant, so the matrix is
   * assembled once; each step is a PCG solve warm-started from the last one.
   * Starts from the steady field of the first key frame. Key frames give air
   * or surface temperatures per role (room / outside / ground); faces without
   * a role, or with a role not set in the frames, keep their own temperature.
   * Fixed-temperature regions stay fixed. No latent heat (freezing). */
  function transient(model, options, scenario, progress = () => {}) {
    const frames = (scenario.frames || []).slice().sort((a, b) => a.t - b.t),
      duration = scenario.duration,
      steps = Math.round(scenario.steps),
      outputs = Math.max(1, Math.min(steps, Math.round(scenario.outputs || 100)));
    if (!(finite(duration) && duration > 0))
      throw Error("Длительность процесса должна быть положительной.");
    if (!(steps >= 1 && steps <= 100000))
      throw Error("Число шагов по времени: от 1 до 100 000.");
    if (!frames.length || frames.some((f) => !finite(f.t) || f.t < 0))
      throw Error("Нужен хотя бы один ключевой кадр с временем ≥ 0.");
    const missing = model.regions.filter(
      (r) => r.temperature === undefined && !(heatCapacityOf(r) > 0),
    );
    if (missing.length)
      throw Error(
        `Для расчёта во времени задайте ρ и c: ${missing
          .slice(0, 5)
          .map((r) => r.name)
          .join(", ")}${missing.length > 5 ? " …" : ""}.`,
      );
    const bcs = model.boundaries || [],
      temperaturesAt = (t) => {
        const v = scenarioAt(frames, t);
        return bcs.map((b) => (b.role in v ? v[b.role] : b.temperature));
      },
      initial = temperaturesAt(0);
    const start = solve(
      { ...model, boundaries: bcs.map((b, i) => ({ ...b, temperature: initial[i] })) },
      options,
      (message) => progress(`Начальное состояние · ${message}`),
    );
    if (!start.converged)
      throw Error("Начальное стационарное состояние не сошлось.");
    const { nodes, triangles, boundaryEdges } = start,
      n = nodes.length,
      dt = duration / steps,
      rows = Array.from({ length: n }, () => new Map()),
      add = (i, j, v) => rows[i].set(j, (rows[i].get(j) || 0) + v),
      mass = new Float64Array(n),
      fixedRegion = new Map();
    triangles.forEach((t) => {
      const p = t.v.map((i) => nodes[i]),
        det = cross(...p),
        r = model.regions[t.region],
        g = [
          [p[1].y - p[2].y, p[2].x - p[1].x],
          [p[2].y - p[0].y, p[0].x - p[2].x],
          [p[0].y - p[1].y, p[1].x - p[0].x],
        ];
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++)
          add(t.v[i], t.v[j], (r.lambda / (2 * det)) * (g[i][0] * g[j][0] + g[i][1] * g[j][1]));
      if (finite(r.temperature)) t.v.forEach((i) => fixedRegion.set(i, r.temperature));
      else {
        const share = (heatCapacityOf(r) * det) / 2 / 1e6 / 3; // J/(m·K) per node
        t.v.forEach((i) => (mass[i] += share));
      }
    });
    const film = [],
      surface = new Map(),
      interior = new Set();
    for (const e of boundaryEdges) {
      const [a, b] = e.v.map((i) => nodes[i]),
        face = bcs.findIndex(
          (bc) => distance(a, bc.a, bc.b) < EPS && distance(b, bc.a, bc.b) < EPS,
        );
      if (face < 0) continue;
      const bc = bcs[face],
        [i, j] = e.v,
        L = length(a, b) / 1000;
      if (bc.interior) e.v.forEach((k) => interior.add(k));
      if (bc.type === "film") {
        add(i, i, (bc.h * L) / 3);
        add(j, j, (bc.h * L) / 3);
        add(i, j, (bc.h * L) / 6);
        add(j, i, (bc.h * L) / 6);
        film.push({ i, j, w: (bc.h * L) / 2, index: face, role: bc.role });
      } else
        for (const k of e.v)
          surface.set(k, [...(surface.get(k) || []), face]);
    }
    // Fixed nodes: surface temperatures (mean at a jump, as in solve) and
    // fixed-temperature regions.
    const fixedValue = (k, temps) => {
      if (fixedRegion.has(k)) {
        if((surface.get(k)||[]).some(i=>Math.abs(temps[i]-fixedRegion.get(k))>EPS)) throw Error("Конфликт температур источника и поверхности во времени.");
        return fixedRegion.get(k);
      }
      const v = surface.get(k).map((b) => temps[b]);
      if(Math.max(...v)-Math.min(...v)>EPS && !options.allowTemperatureJumps) throw Error("Конфликт температур поверхностей во времени.");
      return (Math.min(...v) + Math.max(...v)) / 2;
    };
    const fixedNodes = [...new Set([...surface.keys(), ...fixedRegion.keys()])],
      isFixed = new Uint8Array(n);
    fixedNodes.forEach((k) => (isFixed[k] = 1));
    const free = [],
      index = new Int32Array(n).fill(-1);
    for (let k = 0; k < n; k++) if (!isFixed[k]) index[k] = free.push(k) - 1;
    const m = free.length,
      rowStart = new Int32Array(m + 1),
      cols = [],
      vals = [],
      diag = new Float64Array(m),
      couple = [];
    free.forEach((k, r) => {
      for (const [j, v] of rows[k]) {
        const value = j === k ? v + mass[k] / dt : v;
        if (isFixed[j]) couple.push(r, j, value);
        else {
          cols.push(index[j]);
          vals.push(value);
          if (j === k) diag[r] = value;
        }
      }
      rowStart[r + 1] = cols.length;
    });
    const col = Int32Array.from(cols),
      val = Float64Array.from(vals),
      x = new Float64Array(m),
      rhs = new Float64Array(m),
      res = new Float64Array(m),
      z = new Float64Array(m),
      p = new Float64Array(m),
      ap = new Float64Array(m);
    const multiply = (v, out) => {
      for (let r = 0; r < m; r++) {
        let s = 0;
        for (let k = rowStart[r]; k < rowStart[r + 1]; k++) s += val[k] * v[col[k]];
        out[r] = s;
      }
    };
    // Symmetric Gauss–Seidel preconditioner, as in solve().
    const precondition = () => {
      for (let r = 0; r < m; r++) {
        let s = res[r];
        for (let k = rowStart[r]; k < rowStart[r + 1]; k++) if (col[k] < r) s -= val[k] * z[col[k]];
        z[r] = s / diag[r];
      }
      for (let r = m - 1; r >= 0; r--) {
        let s = z[r] * diag[r];
        for (let k = rowStart[r]; k < rowStart[r + 1]; k++) if (col[k] > r) s -= val[k] * z[col[k]];
        z[r] = s / diag[r];
      }
    };
    const dot = (a, b) => {
      let s = 0;
      for (let r = 0; r < m; r++) s += a[r] * b[r];
      return s;
    };
    let iterationsTotal = 0;
    function step() {
      multiply(x, ap);
      let scale = 0;
      for (let r = 0; r < m; r++) scale = Math.max(scale, Math.abs(rhs[r]));
      const tolerance = 1e-10 * Math.max(1, scale);
      let error = 0;
      for (let r = 0; r < m; r++) {
        res[r] = rhs[r] - ap[r];
        error = Math.max(error, Math.abs(res[r]));
      }
      if (error <= tolerance) return;
      precondition();
      p.set(z);
      let rz = dot(res, z);
      for (let it = 0; it < 20000; it++) {
        multiply(p, ap);
        const alpha = rz / dot(p, ap);
        error = 0;
        for (let r = 0; r < m; r++) {
          x[r] += alpha * p[r];
          res[r] -= alpha * ap[r];
          error = Math.max(error, Math.abs(res[r]));
        }
        iterationsTotal++;
        if (error <= tolerance) {
          multiply(x, ap);
          error=0;
          for(let r=0;r<m;r++) { res[r]=rhs[r]-ap[r]; error=Math.max(error,Math.abs(res[r])); }
          if(error<=tolerance) return;
          precondition(); p.set(z); rz=dot(res,z); continue;
        }
        precondition();
        const next = dot(res, z),
          beta = next / rz;
        for (let r = 0; r < m; r++) p[r] = z[r] + beta * p[r];
        rz = next;
      }
      throw Error("Шаг по времени не сошёлся. Уменьшите шаг или проверьте модель.");
    }
    const T = Float64Array.from(start.values);
    free.forEach((k, r) => (x[r] = T[k]));
    const out = [],
      times = [],
      minNode = [],
      series = { t: [], tsiMin: [], roomFlow: [], outsideFlow: [], groundFlow: [], otherFlow: [], sourceFlow: [], storageRate: [], energyResidual: [] };
    const previousT = Float64Array.from(T);
    const record = (t, temps, save) => {
      let low = Infinity,
        node = -1;
      for (const k of interior)
        if (T[k] < low) {
          low = T[k];
          node = k;
        }
      const flows={room:0,outside:0,ground:0,other:0};
      const load=new Float64Array(n);
      const bucket=role=>role in flows ? role : "other";
      for (const f of film) {
        const q=2*f.w*((T[f.i]+T[f.j])/2-temps[f.index]);
        flows[bucket(f.role)]+=q;
        load[f.i]+=f.w*temps[f.index]; load[f.j]+=f.w*temps[f.index];
      }
      let storage=0, sourceIn=0;
      for(let k=0;k<n;k++) {
        const accumulation=t>0 ? mass[k]*(T[k]-previousT[k])/dt : 0;
        storage+=accumulation;
        if(!isFixed[k]) continue;
        let reaction=accumulation-load[k];
        for(const [j,v] of rows[k]) reaction+=v*T[j];
        if(fixedRegion.has(k)) sourceIn+=reaction;
        else {
          const faces=[...new Set(surface.get(k))];
          for(const i of faces) flows[bucket(bcs[i].role)]-=reaction/faces.length;
        }
      }
      const residual=storage+Object.values(flows).reduce((a,b)=>a+b,0)-sourceIn;
      const scale=Math.max(1,Math.abs(storage),Math.abs(sourceIn),...Object.values(flows).map(Math.abs));
      if(!Number.isFinite(residual)||Math.abs(residual)>1e-6+1e-5*scale) throw Error("Нарушен баланс энергии временного шага; результат не принят.");
      series.storageRate.push(storage); series.energyResidual.push(residual);
      series.groundFlow.push(flows.ground); series.otherFlow.push(flows.other); series.sourceFlow.push(sourceIn);
      const room=-flows.room, outside=flows.outside;
      series.t.push(t);
      series.tsiMin.push(node < 0 ? null : low);
      series.roomFlow.push(room);
      series.outsideFlow.push(outside);
      if (save) {
        out.push(Float32Array.from(T));
        times.push(t);
        minNode.push(node);
      }
    };
    const saveAt = new Set(Array.from({ length: outputs + 1 }, (_, k) => Math.round((k * steps) / outputs)));
    record(0, initial, true);
    for (let s = 1; s <= steps; s++) {
      const t = s * dt,
        temps = temperaturesAt(t);
      previousT.set(T);
      for (const k of fixedNodes) T[k] = fixedValue(k, temps);
      free.forEach((k, r) => (rhs[r] = (mass[k] / dt) * T[k]));
      for (const f of film) {
        const v = f.w * temps[f.index];
        if (!isFixed[f.i]) rhs[index[f.i]] += v;
        if (!isFixed[f.j]) rhs[index[f.j]] += v;
      }
      for (let c = 0; c < couple.length; c += 3) rhs[couple[c]] -= couple[c + 2] * T[couple[c + 1]];
      step();
      free.forEach((k, r) => (T[k] = x[r]));
      record(t, temps, saveAt.has(s));
      if (s % Math.max(1, Math.round(steps / 50)) === 0)
        progress(`Расчёт во времени · шаг ${s}/${steps} · ${n} узлов`);
    }
    return {
      start,
      frames: out,
      times,
      minNode,
      series,
      dt,
      steps,
      iterations: iterationsTotal,
      scenario: { ...scenario, frames },
    };
  }
  const api = {
    mesh,
    solve,
    validate,
    distance,
    vapour,
    surfaceHumidity,
    transient,
    scenarioAt,
    psat,
    dewPoint,
    factory: thermoSolver,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.ThermoFEM = api;
})(globalThis);
