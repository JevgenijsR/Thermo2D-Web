/* Thermo2D P1 FEM. Coordinates mm, lambda W/(m K), Q' W/m.
 * Conforming vertical decomposition of disjoint polygonal materials, including
 * holes. Every shared vertical trace uses the same nodes. No raster geometry.
 * Sweep refinement is graded but anisotropic; it is not a Delaunay mesher.
 */
(function (root) {
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
              if (out.length + nodes.length > 200000)
                throw Error(
                  "Сетка превышает 200 000 узлов. Увеличьте размер элемента.",
                );
            }
          } else out.push(v[j]);
        }
        if (out.length + nodes.length > 200000)
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
    if (triangles.length > 300000)
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
    const m = mesh(model, options),
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
    const matched = new Set(),
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
      } else {
        prescribe(i, bc.temperature);
        prescribe(j, bc.temperature);
      }
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
    triangles.forEach((t) => {
      const v = model.regions[t.region].temperature;
      if (finite(v)) t.v.forEach((i) => prescribe(i, v));
    });
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
      stats: {
        ...m.stats,
        iterations: iteration,
        residual: error,
        elapsedMs: Date.now() - start,
      },
      converged,
    };
  }
  const api = { mesh, solve, validate, distance };
  if (typeof module !== "undefined") module.exports = api;
  else root.ThermoFEM = api;
})(globalThis);
