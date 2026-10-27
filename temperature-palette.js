(function (root) {
  const stops = [
    [128, 0, 255],
    [0, 51, 255],
    [0, 217, 255],
    [0, 200, 83],
    [245, 240, 0],
    [255, 136, 0],
    [232, 33, 39],
  ];
  function color(value, min, max) {
    const t =
        max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0.5,
      x = t * 6,
      i = Math.min(5, Math.floor(x)),
      f = x - i;
    return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  }
  const css =
    "linear-gradient(90deg," + stops.map((c) => `rgb(${c})`).join(",") + ")";
  const api = { color, css };
  if (typeof module !== "undefined") module.exports = api;
  else root.ThermoPalette = api;
})(globalThis);
