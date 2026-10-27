/* DXF LINE/LWPOLYLINE reader and planar face extraction, shared editor conventions. */
(function (root) {
  const unitFactors = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 },
    headerUnits = { 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m" };
  function importModel(text, unit = "auto") {
    const parsed = parseDxf(text);
    if (unit === "auto" && !parsed.unitsKnown)
      throw Error("В DXF нет известных единиц. Выберите единицы явно.");
    if (parsed.unsupported)
      throw Error(
        "Есть неподдерживаемые сущности: " +
          parsed.unsupported +
          ". Экспортируйте только расчётные контуры LINE/LWPOLYLINE.",
      );
    const factor = unitFactors[unit === "auto" ? parsed.sourceUnit : unit];
    if (!factor) throw Error("Неизвестные единицы");
    const unitSelect = { value: "mm" };
    const entities = parsed.entities.map((e) => ({
      ...e,
      points: e.points.map((p) => ({ x: p.x * factor, y: p.y * factor })),
    }));
    const pts = entities.flatMap((e) => e.points),
      bounds = {
        minX: Math.min(...pts.map((p) => p.x)),
        maxX: Math.max(...pts.map((p) => p.x)),
        minY: Math.min(...pts.map((p) => p.y)),
        maxY: Math.max(...pts.map((p) => p.y)),
      };
    function canonicalPolygonKey(points) {
      const factor = unitFactors[unitSelect.value] || 1;
      const tokens = points.map(
        (p) => `${(p.x / factor).toFixed(5)},${(p.y / factor).toFixed(5)}`,
      );
      const sequences = [];
      for (const sequence of [tokens, [...tokens].reverse()]) {
        for (let i = 0; i < sequence.length; i++)
          sequences.push(
            [...sequence.slice(i), ...sequence.slice(0, i)].join(";"),
          );
      }
      return sequences.sort()[0];
    }
    function polygonArea(points) {
      let area = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += a.x * b.y - b.x * a.y;
      }
      return area / 2;
    }
    function discoverRegions() {
      const raw = [];
      entities.forEach((entity) => {
        const count = entity.closed
          ? entity.points.length
          : entity.points.length - 1;
        for (let i = 0; i < count; i++) {
          const a = entity.points[i];
          const b = entity.points[(i + 1) % entity.points.length];
          if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-8)
            raw.push({ a, b, splits: [0, 1] });
        }
      });
      if (raw.length > 3000) return [];

      const cross = (a, b) => a.x * b.y - a.y * b.x;
      for (let i = 0; i < raw.length; i++) {
        const first = raw[i];
        const r = { x: first.b.x - first.a.x, y: first.b.y - first.a.y };
        for (let j = i + 1; j < raw.length; j++) {
          const second = raw[j];
          const s = { x: second.b.x - second.a.x, y: second.b.y - second.a.y };
          const q = { x: second.a.x - first.a.x, y: second.a.y - first.a.y };
          const denominator = cross(r, s);
          if (Math.abs(denominator) < 1e-10) continue;
          const t = cross(q, s) / denominator;
          const u = cross(q, r) / denominator;
          if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
            first.splits.push(Math.max(0, Math.min(1, t)));
            second.splits.push(Math.max(0, Math.min(1, u)));
          }
        }
      }

      const extent = bounds
        ? Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
        : 1;
      const epsilon = Math.max(extent * 1e-8, 1e-7);
      const nodeKey = (p) =>
        `${Math.round(p.x / epsilon)},${Math.round(p.y / epsilon)}`;
      const nodes = new Map();
      const adjacency = new Map();
      const edges = new Set();
      function addNode(point) {
        const key = nodeKey(point);
        if (!nodes.has(key)) nodes.set(key, point);
        if (!adjacency.has(key)) adjacency.set(key, new Set());
        return key;
      }
      for (const segment of raw) {
        const sorted = [...segment.splits]
          .sort((a, b) => a - b)
          .filter((t, i, list) => i === 0 || Math.abs(t - list[i - 1]) > 1e-8);
        for (let i = 0; i + 1 < sorted.length; i++) {
          const pointAt = (t) => ({
            x: segment.a.x + (segment.b.x - segment.a.x) * t,
            y: segment.a.y + (segment.b.y - segment.a.y) * t,
          });
          const ka = addNode(pointAt(sorted[i]));
          const kb = addNode(pointAt(sorted[i + 1]));
          if (ka === kb) continue;
          const edge = [ka, kb].sort().join("|");
          if (edges.has(edge)) continue;
          edges.add(edge);
          adjacency.get(ka).add(kb);
          adjacency.get(kb).add(ka);
        }
      }

      const visited = new Set();
      const found = [];
      const directedKey = (a, b) => `${a}>${b}`;
      for (const node of adjacency.keys()) {
        for (const neighbor of adjacency.get(node)) {
          const startKey = directedKey(node, neighbor);
          if (visited.has(startKey)) continue;
          let from = node;
          let to = neighbor;
          const cycle = [];
          let closed = false;
          for (let step = 0; step < edges.size * 2 + 2; step++) {
            const key = directedKey(from, to);
            if (visited.has(key)) {
              closed = key === startKey;
              break;
            }
            visited.add(key);
            cycle.push(nodes.get(from));
            const neighbors = [...(adjacency.get(to) || [])].sort((a, b) => {
              const p = nodes.get(to);
              const pa = nodes.get(a);
              const pb = nodes.get(b);
              return (
                Math.atan2(pa.y - p.y, pa.x - p.x) -
                Math.atan2(pb.y - p.y, pb.x - p.x)
              );
            });
            const reverseIndex = neighbors.indexOf(from);
            if (reverseIndex < 0 || !neighbors.length) break;
            const next =
              neighbors[
                (reverseIndex - 1 + neighbors.length) % neighbors.length
              ];
            from = to;
            to = next;
            if (directedKey(from, to) === startKey) {
              closed = true;
              break;
            }
          }
          if (
            !closed ||
            cycle.length < 3 ||
            polygonArea(cycle) <= epsilon * epsilon
          )
            continue;
          const key = canonicalPolygonKey(cycle);
          if (!found.some((region) => region.key === key))
            found.push({
              key,
              points: cycle,
              area: Math.abs(polygonArea(cycle)),
            });
        }
      }
      const parentByKey = new Map();
      for (const region of found) {
        const parents = found
          .filter(
            (candidate) =>
              candidate.key !== region.key &&
              candidate.area > region.area &&
              // Adjacent faces can share a vertex. A hole must be strictly enclosed;
              // testing just the first vertex can erase a neighbouring region at render time.
              region.points.every(
                (point) =>
                  pointInside(point, candidate.points) &&
                  candidate.points.every(
                    (a, index) =>
                      distanceToSegment(
                        point,
                        a,
                        candidate.points[(index + 1) % candidate.points.length],
                      ) > epsilon,
                  ),
              ),
          )
          .sort((a, b) => a.area - b.area);
        if (parents.length) parentByKey.set(region.key, parents[0].key);
      }
      return found
        .map((region) => {
          const holes = found.filter(
            (candidate) => parentByKey.get(candidate.key) === region.key,
          );
          return {
            ...region,
            holes: holes.map((hole) => hole.points),
            area: region.area - holes.reduce((sum, hole) => sum + hole.area, 0),
          };
        })
        .filter((region) => region.area > epsilon * epsilon);
    }
    function distanceToSegment(point, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length2 = dx * dx + dy * dy;
      const t = length2
        ? Math.max(
            0,
            Math.min(
              1,
              ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2,
            ),
          )
        : 0;
      return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    }
    function pointInside(point, polygon) {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        const crosses =
          a.y > point.y !== b.y > point.y &&
          point.x <
            ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-12) + a.x;
        if (crosses) inside = !inside;
      }
      return inside;
    }
    const faces = discoverRegions();
    if (!faces.length)
      throw Error(
        "Нет замкнутых областей либо превышен предел 3000 сегментов.",
      );
    const faceEdges = faces.flatMap((r) =>
      [r.points, ...r.holes].flatMap((ring) =>
        ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] })),
      ),
    );
    for (const e of entities)
      for (
        let i = 0;
        i < (e.closed ? e.points.length : e.points.length - 1);
        i++
      ) {
        const a = e.points[i],
          b = e.points[(i + 1) % e.points.length],
          mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (
          !faceEdges.some(
            (edge) => distanceToSegment(mid, edge.a, edge.b) < 1e-6,
          )
        )
          throw Error(
            "Есть незамкнутые или лишние линии. Очистите DXF до замкнутых расчётных контуров.",
          );
      }
    return {
      name: "DXF · импорт",
      description:
        "DXF: размеры в мм. Назначьте материал каждой области и температуры внешних граней. Вложенные контуры импортированы как отдельные области: удалите внутреннюю область кнопкой «Отверстие», если это пустота.",
      regions: faces.map((r, i) => ({
        id: "dxf-" + i,
        name: "Область " + (i + 1),
        points: r.points,
        holes: r.holes,
        lambda: 1,
        materialPending: true,
      })),
      boundaries: [],
    };
  }
  function parseDxf(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = Number(lines[i].trim());
      if (Number.isFinite(code))
        pairs.push({ code, value: lines[i + 1].trim() });
    }

    let insUnits = null;
    let inHeader = false;
    let inEntities = false;
    const parsedEntities = [];
    let unsupported = 0;

    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      if (p.code === 0 && p.value === "SECTION") {
        const sectionName = pairs[i + 1]?.value;
        inHeader = sectionName === "HEADER";
        inEntities = sectionName === "ENTITIES";
        continue;
      }
      if (p.code === 0 && p.value === "ENDSEC") {
        inHeader = false;
        inEntities = false;
        continue;
      }
      if (inHeader && p.code === 9 && p.value === "$INSUNITS") {
        if (pairs[i + 1]?.code === 70) insUnits = Number(pairs[i + 1].value);
      }
      if (!inEntities || p.code !== 0) continue;

      const type = p.value;
      const data = [];
      i++;
      while (i < pairs.length && pairs[i].code !== 0) data.push(pairs[i++]);
      i--;
      const get = (code) => data.find((entry) => entry.code === code)?.value;
      const layer = get(8) || "0";

      if (type === "LINE") {
        const x1 = Number(get(10));
        const y1 = Number(get(20));
        const x2 = Number(get(11));
        const y2 = Number(get(21));
        if ([x1, y1, x2, y2].every(Number.isFinite))
          parsedEntities.push({
            type,
            layer,
            points: [
              { x: x1, y: y1 },
              { x: x2, y: y2 },
            ],
            closed: false,
          });
        else unsupported++;
      } else if (type === "LWPOLYLINE") {
        if (
          data.some(
            (entry) =>
              entry.code === 42 && Math.abs(Number(entry.value)) > 1e-12,
          )
        ) {
          throw new Error(
            "DXF содержит дуговые сегменты bulge. Их точная аппроксимация пока не реализована: экспортируйте полилинии с явно заданной погрешностью в мм. Дуги не заменены хордами.",
          );
        }
        const points = [];
        let current = null;
        for (const entry of data) {
          if (entry.code === 10) {
            if (
              current &&
              Number.isFinite(current.x) &&
              Number.isFinite(current.y)
            )
              points.push(current);
            current = { x: Number(entry.value), y: NaN };
          } else if (entry.code === 20 && current)
            current.y = Number(entry.value);
        }
        if (current && Number.isFinite(current.x) && Number.isFinite(current.y))
          points.push(current);
        const flags = Number(get(70) || 0);
        if (points.length >= 2)
          parsedEntities.push({
            type,
            layer,
            points,
            closed: (flags & 1) === 1,
          });
        else unsupported++;
      } else if (["ARC", "CIRCLE", "ELLIPSE", "SPLINE"].includes(type)) {
        throw new Error(
          `DXF содержит ${type}. Экспортируйте замкнутые полилинии с заданной геометрической погрешностью в мм. Кривые нельзя молча исключать из расчёта.`,
        );
      } else if (!["ENDSEC", "ENDTAB"].includes(type)) {
        unsupported++;
      }
    }

    if (!parsedEntities.length)
      throw new Error("В файле не найдены поддерживаемые LINE или LWPOLYLINE.");
    const sourceUnit = headerUnits[insUnits] || "mm";
    const unitsKnown = Boolean(headerUnits[insUnits]);
    return { entities: parsedEntities, sourceUnit, unitsKnown, unsupported };
  }
  root.ThermoDXF = { importModel };
  if (typeof module !== "undefined") module.exports = root.ThermoDXF;
})(globalThis);
