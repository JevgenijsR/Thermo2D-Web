/* Split material contours at all vertices and retain edges belonging to one region. */
(function (root) {
  const distance = (p, a, b) => {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l = dx * dx + dy * dy,
      t = l
        ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l))
        : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  function external(model) {
    const rings = model.regions.flatMap((r) => [r.points, ...(r.holes || [])]),
      vertices = rings.flat(),
      segments = new Map();
    const key = (p) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
    for (const ring of rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          dx = b.x - a.x,
          dy = b.y - a.y,
          l2 = dx * dx + dy * dy;
        if (l2 < 1e-16) continue;
        const ts = [
          0,
          1,
          ...vertices
            .filter((p) => distance(p, a, b) < 1e-7)
            .map((p) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2),
        ]
          .sort((a, b) => a - b)
          .filter((t, i, v) => !i || t - v[i - 1] > 1e-9);
        for (let j = 0; j < ts.length - 1; j++) {
          const p = (t) => ({ x: a.x + t * dx, y: a.y + t * dy }),
            edge = { a: p(ts[j]), b: p(ts[j + 1]) },
            k = [key(edge.a), key(edge.b)].sort().join("|");
          const entry = segments.get(k);
          if (entry) entry.count++;
          else segments.set(k, { ...edge, count: 1 });
        }
      }
    return [...segments.values()].filter((e) => e.count === 1);
  }
  root.ThermoEdges = { external, distance };
  if (typeof module !== "undefined") module.exports = root.ThermoEdges;
})(globalThis);
