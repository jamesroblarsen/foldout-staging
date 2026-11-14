// 3D city view: MapLibre draws the city as a square "diorama" of extruded buildings.
// Coordinates are local metres placed at a fake origin on the equator, so nothing in the
// page (requests, map state) reveals where the city really is.
import { clipPolylineRect, clipPolygonRect, decode } from './geom.1ea8297233.js';

const DEG = 111319.49; // metres per degree at the equator (Web Mercator)
const toLL = ([x, y]) => [x / DEG, y / DEG];

export const LOOK = {
  paper: '#e7dfcc',
  ground: '#e9e1cf',
  edge: '#9c9384',
  water: '#b9cfd3',
  waterEdge: '#93aeb4',
  park: '#d5dfbf',
  wood: '#c6d4ad',
  sand: '#efe3c0',
  cemetery: '#d9dfc9',
  road: '#ffffff',
  roadMajor: '#fdf6e6',
  path: '#fffdf7',
  rail: '#a59d90',
  building: '#c2bbae',
};

const ROAD_W = { major: 15, primary: 13, secondary: 11, tertiary: 10, street: 7.5, service: 4.5, path: 3 };

function style() {
  const empty = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  // Line widths in metres at any zoom: width_px = metres / (78271.5 / 2^zoom).
  // Each line feature carries its real width in metres as `w`.
  const metres = ['interpolate', ['exponential', 2], ['zoom'], 12, ['*', ['get', 'w'], 2 ** 12 / 78271.5], 20, ['*', ['get', 'w'], 2 ** 20 / 78271.5]];
  return {
    version: 8,
    sources: { base: empty, area: empty, water: empty, lines: empty, rail: empty, buildings: empty },
    layers: [
      { id: 'paper', type: 'background', paint: { 'background-color': LOOK.paper } },
      { id: 'base', type: 'fill', source: 'base', paint: { 'fill-color': LOOK.ground } },
      { id: 'base-edge', type: 'line', source: 'base', paint: { 'line-color': LOOK.edge, 'line-width': 1.2 } },
      { id: 'green', type: 'fill', source: 'area', paint: { 'fill-color': ['match', ['get', 'k'], 'wood', LOOK.wood, 'sand', LOOK.sand, 'cemetery', LOOK.cemetery, LOOK.park] } },
      { id: 'water', type: 'fill', source: 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': LOOK.water, 'fill-outline-color': LOOK.waterEdge } },
      { id: 'river', type: 'line', source: 'water', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': LOOK.water, 'line-width': metres } },
      {
        id: 'roads', type: 'line', source: 'lines', layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'o'] },
        paint: {
          'line-color': ['match', ['get', 'k'], 'path', LOOK.path, 'major', LOOK.roadMajor, 'primary', LOOK.roadMajor, LOOK.road],
          'line-width': metres,
          'line-opacity': 1,
        },
      },
      { id: 'rail', type: 'line', source: 'rail', paint: { 'line-color': LOOK.rail, 'line-width': metres, 'line-dasharray': [3, 1.5] } },
      {
        id: 'buildings', type: 'fill-extrusion', source: 'buildings',
        paint: {
          'fill-extrusion-color': LOOK.building,
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'm'],
          'fill-extrusion-vertical-gradient': true,
          'fill-extrusion-opacity': 1,
        },
      },
    ],
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0.42, position: [1.4, 210, 35] },
  };
}

const ROAD_ORDER = { path: 0, service: 1, street: 2, tertiary: 3, secondary: 4, primary: 5, major: 6 };

// Decode once and keep everything in local metres.
function prepare(data) {
  if (data._prep) return data._prep;
  const L = data.layers;
  const lines = (k) => (L[k] || []).map((f) => ({ k, b: !!f.b, pts: decode(f.p || f) }));
  const areas = (k) => (L[k] || []).map((rings) => ({ k, rings: rings.map(decode) }));
  data._prep = {
    buildings: (L.building || []).map((b) => ({ h: b.h, m: b.m, rings: b.r.map(decode) })),
    roads: Object.keys(ROAD_ORDER).flatMap(lines),
    rail: ['rail', 'railminor', 'tram'].flatMap(lines),
    green: ['park', 'wood', 'sand', 'cemetery'].flatMap(areas),
    water: areas('water'),
    rivers: ['river', 'stream'].flatMap(lines),
  };
  return data._prep;
}

function polyFeature(rings, rect, props) {
  const out = [];
  for (const r of rings) {
    const c = clipPolygonRect(r, rect);
    if (c) out.push(c.concat([c[0]]).map(toLL));
    else if (!out.length) return null;
  }
  return out.length ? { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: out } } : null;
}

function lineFeatures(pts, rect, props, sink) {
  for (const piece of clipPolylineRect(pts, rect)) sink.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: piece.map(toLL) } });
}

const fc = (features) => ({ type: 'FeatureCollection', features });

export function zoomFor(widthPx, view) {
  return Math.log2((78271.517 * widthPx * 0.8) / (2 * view));
}

export function createView(container, maplibregl) {
  const map = new maplibregl.Map({
    container,
    style: style(),
    center: [0, 0],
    zoom: 14,
    pitch: 44,
    bearing: 0,
    maxPitch: 70,
    attributionControl: false,
    dragRotate: true,
    pitchWithRotate: true,
    touchPitch: true,
    keyboard: false,
    fadeDuration: 0,
    maxBounds: [toLL([-2600, -2600]), toLL([2600, 2600])],
    preserveDrawingBuffer: true,
  });
  map.touchZoomRotate.enableRotation();
  map.addControl(new maplibregl.NavigationControl({ showZoom: false, visualizePitch: true }), 'top-right');
  const ready = new Promise((r) => map.on('load', r));
  let current = null;

  async function show(data, stage, { animate = true } = {}) {
    await ready;
    const p = prepare(data);
    const v = stage.view;
    const rect = [-v, -v, v, v];
    const layers = new Set(stage.layers);
    const same = current && current.data === data;
    current = { data, stage };

    map.getSource('base').setData(fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-v, -v], [v, -v], [v, v], [-v, v], [-v, -v]].map(toLL)] } }]));
    map.getSource('buildings').setData(fc(p.buildings.map((b) => polyFeature(b.rings, rect, { h: b.h, m: b.m })).filter(Boolean)));
    const roads = [];
    for (const r of p.roads) lineFeatures(r.pts, rect, { k: r.k, w: ROAD_W[r.k], o: ROAD_ORDER[r.k] + (r.b ? 10 : 0) }, roads);
    map.getSource('lines').setData(fc(roads));

    const rail = [];
    if (layers.has('rail')) for (const r of p.rail) lineFeatures(r.pts, rect, { k: r.k, w: r.k === 'rail' ? 2.4 : 1.2 }, rail);
    map.getSource('rail').setData(fc(rail));

    const water = [];
    if (layers.has('water')) {
      for (const w of p.water) { const f = polyFeature(w.rings, rect, {}); if (f) water.push(f); }
      for (const r of p.rivers) lineFeatures(r.pts, rect, { k: r.k, w: r.k === 'river' ? 8 : 2.5 }, water);
    }
    map.getSource('water').setData(fc(water));
    map.getSource('area').setData(fc(layers.has('green') ? p.green.map((g) => polyFeature(g.rings, rect, { k: g.k })).filter(Boolean) : []));

    const z = zoomFor(container.clientWidth, v);
    map.setMinZoom(Math.max(0, z - 1.2));
    map.setMaxZoom(z + 3);
    const cam = { center: [0, 0], zoom: z };
    if (!same) Object.assign(cam, { pitch: 44, bearing: 0 });
    if (animate && same) map.easeTo({ ...cam, duration: 900 });
    else map.jumpTo(cam);
  }

  function resetCamera() {
    if (!current) return;
    map.easeTo({ center: [0, 0], zoom: zoomFor(container.clientWidth, current.stage.view), pitch: 44, bearing: 0, duration: 700 });
  }

  function resize() {
    map.resize();
    if (current) map.jumpTo({ zoom: zoomFor(container.clientWidth, current.stage.view) });
  }

  const idle = () => new Promise((r) => { map.once('idle', r); map.triggerRepaint(); });
  return { map, show, resetCamera, resize, ready, idle };
}
