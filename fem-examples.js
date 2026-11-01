(function thermoExamples(root) {
  const rect = (name, x0, y0, x1, y1, lambda, h) => ({
    name,
    lambda,
    h,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  });
  const bc = (name, x0, y0, x1, y1, temperature, h, interior = false) => ({
    name,
    a: { x: x0, y: y0 },
    b: { x: x1, y: y1 },
    temperature,
    type: h ? "film" : "temperature",
    ...(h ? { h } : {}),
    interior,
  });
  function windowNode(metal = true) {
    return {
      name: metal
        ? "Контроль · окно и подоконник · металл"
        : "Контроль · окно и подоконник · без металла",
      description:
        "Тестовые размеры, не восстановлены по фотографии. Стена: 300×200 мм (100 мм утеплителя + 200 мм кладки); сплошная условная рама: 80×176 мм; подоконник: 340×24 мм; вставка: 180×4 мм, x=60…240, y=210…214. λ: утеплитель 0,037; кладка 0,8; рама/подоконник 0,18; сталь 50 Вт/(м·К). Без металла вставка имеет λ=0,18. Воздух −10/+22 °C; h снаружи 25, внутри 7,6923077 Вт/(м²·К). Верхний и нижний срезы изолированы. Полостей нет, контакты идеальные. 2D — непрерывное включение вдоль третьей оси; это не одиночный шуруп.",
      regions: [
        rect("Утеплитель", 0, 0, 100, 200, 0.037),
        rect("Кладка", 100, 0, 300, 200, 0.8),
        rect("Подоконник · низ", 0, 200, 340, 210, 0.18),
        rect("Подоконник · верх", 0, 214, 340, 224, 0.18),
        rect("Подоконник · наружная часть", 0, 210, 60, 214, 0.18),
        rect("Подоконник · внутренняя часть", 240, 210, 340, 214, 0.18),
        rect(
          metal ? "Стальная вставка" : "Замена вставки деревом",
          60,
          210,
          240,
          214,
          metal ? 50 : 0.18,
          0.8,
        ),
        rect("Сплошная условная рама", 80, 224, 160, 400, 0.18),
      ],
      boundaries: [
        bc("Улица · стена", 0, 0, 0, 224, -10, 25),
        bc("Улица · подоконник", 0, 224, 80, 224, -10, 25),
        bc("Улица · рама", 80, 224, 80, 400, -10, 25),
        bc("Комната · стена", 300, 0, 300, 200, 22, 1 / 0.13, true),
        bc("Комната · низ подоконника", 300, 200, 340, 200, 22, 1 / 0.13, true),
        bc(
          "Комната · торец подоконника",
          340,
          200,
          340,
          224,
          22,
          1 / 0.13,
          true,
        ),
        bc(
          "Комната · верх подоконника",
          160,
          224,
          340,
          224,
          22,
          1 / 0.13,
          true,
        ),
        bc("Комната · рама", 160, 224, 160, 400, 22, 1 / 0.13, true),
      ],
    };
  }
  function wall(film = false) {
    return {
      name: "Аналитическая стена",
      regions: [
        { ...rect("Бетон", 0, 0, 300, 2400, 1.7), density: 2400, heatCapacity: 880, mu: 130 },
        { ...rect("Утеплитель", 300, 0, 400, 2400, 0.037), density: 40, heatCapacity: 1030, mu: 1 },
      ],
      boundaries: [
        { ...bc("Внутри", 0, 0, 0, 2400, 22, film ? 1 / 0.13 : undefined, true), role: "room" },
        { ...bc("Снаружи", 400, 0, 400, 2400, -10, film ? 25 : undefined), role: "outside" },
      ],
    };
  }
  function holeNode(withHole = true, segments = 64) {
    const panel = rect("Панель", 0, 0, 200, 200, 0.18);
    if (withHole)
      panel.holes = [
        Array.from({ length: segments }, (_, i) => ({
          x: 100 + 20 * Math.cos((2 * Math.PI * i) / segments),
          y: 100 + 20 * Math.sin((2 * Math.PI * i) / segments),
        })),
      ];
    return {
      name: withHole
        ? "Контроль · отверстие Ø40 мм в центре"
        : "Контроль · сплошная панель",
      description: `Тестовая панель 200×200 мм, λ=0,18 Вт/(м·К). ${withHole ? `Отверстие Ø40 мм, центр (100;100) мм, ${segments} прямых сегмента; максимальная стрела аппроксимации ${(20 * (1 - Math.cos(Math.PI / segments))).toFixed(5)} мм. Внутри отверстия нет материала, сетки и температуры; его стенки теплоизолированы.` : "Отверстия нет."} Слева воздух +22 °C, h=1/0,13; справа −10 °C, h=25 Вт/(м²·К). Верх и низ изолированы. Это математическая проверка обхода пустоты потоком, не модель конвекции и излучения в реальной полости. 2D — отверстие неизменно вдоль третьей оси.`,
      regions: [panel],
      boundaries: [
        bc("Внутри", 0, 0, 0, 200, 22, 1 / 0.13, true),
        bc("Снаружи", 200, 0, 200, 200, -10, 25),
      ],
    };
  }
  // ISO 10211 ground block for a slab-on-ground node: cut planes 0.5·b inside
  // and 2.5·b outside and below ground level (b = 8 m if the building width is
  // unknown). Existing cut planes are stretched, so every layer ending at a cut
  // follows it. Needs roles: "outside" (ground surface is the horizontal one),
  // "room" (wall is the vertical one), "ground" (old bottom, replaced).
  const groundNames = {
    psi: "Узел на грунте · теплопотери (ψ отдельно)",
    temperature: "Узел на грунте · проверка температуры, низ 10 м",
  };
  function groundISO(source, temperatureCheck = false, b = 8000) {
    const m = structuredClone(source),
      bcs = m.boundaries || [],
      surface = bcs.find((c) => c.role === "outside" && c.a.y === c.b.y),
      wall = bcs.find((c) => c.role === "room" && c.a.x === c.b.x);
    if (!surface || !wall)
      throw Error(
        "Нужны грани «Улица» на поверхности грунта и «Комната» на стене.",
      );
    const level = surface.a.y,
      exterior = Math.max(surface.a.x, surface.b.x),
      interior = wall.a.x,
      depth = temperatureCheck ? 10000 : 2.5 * b,
      rings = m.regions.flatMap((r) => [r.points, ...(r.holes || [])]),
      points = [...rings.flat(), ...bcs.flatMap((c) => [c.a, c.b])],
      left = Math.min(...points.map((p) => p.x)),
      right = Math.max(...points.map((p) => p.x)),
      bottom = Math.min(...points.map((p) => p.y)),
      to = {
        left: exterior - 2.5 * b,
        right: interior + 0.5 * b,
        bottom: level - depth,
      };
    for (const r of m.regions)
      if (r.points.some((p) => Math.abs(p.y - bottom) < 1e-7))
        r.h = Math.max(r.h ?? 0, 500);
    for (const p of points) {
      if (Math.abs(p.x - left) < 1e-7) p.x = to.left;
      if (Math.abs(p.x - right) < 1e-7) p.x = to.right;
      if (Math.abs(p.y - bottom) < 1e-7) p.y = to.bottom;
    }
    m.boundaries = bcs.filter((c) => c.role !== "ground");
    for (const c of m.boundaries) {
      if (c.type !== "film") continue;
      if (c.role === "outside") c.h = 25; // Rse = 0,04, ISO 6946
      if (c.role === "room")
        c.h = temperatureCheck
          ? 4 // Rsi = 0,25, ISO 13788
          : c.a.y === c.b.y
            ? 1 / 0.17 // пол, поток вниз, ISO 6946
            : 1 / 0.13; // стена, ISO 6946
    }
    if (temperatureCheck)
      m.boundaries.push({
        ...bc(
          "Грунт на глубине 10 м · среднегодовая +7 °C",
          to.left,
          to.bottom,
          to.right,
          to.bottom,
          7,
        ),
        role: "ground",
      });
    for (const r of m.regions)
      if (r.temperature !== undefined) {
        delete r.temperature;
        r.name = r.name.replace(/ · постоянные.*$/, "") + " · отопление выключено";
      }
    m.name = temperatureCheck ? groundNames.temperature : groundNames.psi;
    m.userEdited = false;
    m.description =
      `Построено из демо-узла основания как профиль грунта для дальнейшей проверки по ISO 10211: b = ${b / 1000} м (задано пользователем или оставлено демонстрационное значение), грунт 0,5·b = ${b / 2000} м внутрь от внутренней грани стены, 2,5·b = ${(2.5 * b) / 1000} м наружу от цоколя, ` +
      (temperatureCheck
        ? `${depth / 1000} м вниз; низ — постоянная среднегодовая +7 °C (пример, подставьте свою). Rsi = 0,25 на всех внутренних поверхностях (ISO 13788), Rse = 0,04. Это стационарное приближение для проверки Tsi; θe = −10 °C взята из исходного узла — для проверки плесени подставьте среднюю температуру самого холодного месяца. `
        : `${depth / 1000} м вниз. Все срезы и низ адиабатические. Rsi = 0,13 стена / 0,17 пол (поток вниз), Rse = 0,04 (ISO 6946). Используется для теплопотерь и ψ; Нужна проверка сетки и удалённости границ; гарантии запаса по Tsi нет. `) +
      "Тёплый пол выключен: трубы остаются материалом; включить можно, назначив теплоносителю постоянную температуру. Свойства материалов условные, λ грунта 1,5 — проверьте по своему грунту.";
    return m;
  }
  // 1D frame wall for the Glaser check: vapour-open wool behind a tighter OSB
  // sheathing condenses at the wool/OSB interface in winter.
  function vapourWall() {
    const layer = (name, x0, x1, lambda, mu) => ({
      ...rect(name, x0, 0, x1, 1000, lambda),
      mu,
      materialSource: "Тестовые значения",
    });
    return {
      name: "Проверка · конденсат в каркасной стене (Глазер 1D)",
      description:
        "Тестовая стена высотой 1 м, слои изнутри наружу: гипсокартон 12,5 мм (λ 0,25; μ 10), минвата 150 мм (λ 0,037; μ 1), OSB 12 мм (λ 0,13; μ 50). Пароизоляции нет. Комната +20 °C, φ 50 %, Rsi 0,13; улица −10 °C, φ 85 %, Rse 0,04. Верх и низ изолированы, поэтому результат должен совпасть с одномерным методом Глазера ISO 13788: конденсат на границе минваты и OSB.",
      regions: [
        layer("Гипсокартон", 0, 12.5, 0.25, 10),
        layer("Минеральная вата", 12.5, 162.5, 0.037, 1),
        layer("OSB", 162.5, 174.5, 0.13, 50),
      ],
      boundaries: [
        { ...bc("Комната · стена", 0, 0, 0, 1000, 20, 1 / 0.13, true), role: "room" },
        { ...bc("Улица · стена", 174.5, 0, 174.5, 1000, -10, 25), role: "outside" },
      ],
      moisture: { enabled: true, mode:"diffusion", room: 50, outside: 85 },
    };
  }
  const api = {
    windowNode,
    wall,
    holeNode,
    groundISO,
    groundNames,
    vapourWall,
    rect,
    bc,
    factory: thermoExamples,
  };
  if (typeof module !== "undefined") module.exports = api;
  else root.FEMExamples = api;
})(globalThis);
