// CONFIG
mapboxgl.accessToken = 'pk.eyJ1IjoibmV3dHJhbCIsImEiOiJjazJrcDY4Y2gxMmg3M2JvazU4OXV6NHZqIn0.VO5GkvBq_PSJHvX7T8H9jQ';

const INITIAL_CENTER = [-3.7, 40.3];
const INITIAL_ZOOM   = 5;

const FALLBACK_MIN = 1.03;
const FALLBACK_MAX = 1.89;
const FALLBACK_BREAKS = [1.42, 1.46, 1.50, 1.54, 1.58, 1.62, 1.66];

const GAS_COLORS = [
  '#b8fff1','#88ffe5','#5df7d4','#3ceec4',
  '#22ddb1','#09c39a','#019b7a','#00745b'
];
const DIESEL_COLORS = [
  '#fff4c2','#ffe79a','#ffd76a','#ffca3a',
  '#f3b61f','#d79a00','#a87200','#6f4d00'
];

const TILESET_USER = 'newtral';
const TILESET_ID   = '7sapo8ln';
const SOURCE_LAYER = 'estaciones';

const FLD = {
  direccion: 'Dirección',
  horario: 'Horario',
  municipio: 'Municipio',
  provincia: 'Provincia',
  rotulo: 'Rótulo',
  gas95: 'Precio Gasolina 95 E5',
  diesel: 'Precio Gasoleo A',
  fechaDescarga: 'FechaDescarga'
};

let DOMAIN_MIN = FALLBACK_MIN;
let DOMAIN_MAX = FALLBACK_MAX;
let BREAKS = [...FALLBACK_BREAKS];

// UI
const geocoder = new MapboxGeocoder({
  accessToken: mapboxgl.accessToken,
  mapboxgl,
  placeholder: 'Busca una calle...',
  countries: 'es,pt',
  language: 'es',
  marker: false
});
const tabs = document.querySelectorAll('#fuel-tabs .tab');
let currentFuel = 'g95';

const swWrap = document.getElementById('legend-swatches');
const labWrap = document.getElementById('legend-labels');

const rangeEl = document.getElementById('range');
const minLabel = document.getElementById('min-label');
const maxLabel = document.getElementById('max-label');

// MAP
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/newtral/cmfcdokcl006f01sd20984lhq',
  center: INITIAL_CENTER,
  zoom: INITIAL_ZOOM,
  antialias: true
});
map.addControl(new mapboxgl.NavigationControl(), 'top-right');
document.getElementById('search').appendChild(geocoder.onAdd(map));

// LEYENDA
function buildLegend(){
  swWrap.innerHTML = '';
  labWrap.innerHTML = '';
  const colors = currentFuel === 'g95' ? GAS_COLORS : DIESEL_COLORS;
  colors.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'sw';
    sw.style.background = c;
    swWrap.appendChild(sw);
  });

  const labels = [
    DOMAIN_MIN,
    BREAKS[1] ?? DOMAIN_MIN + (DOMAIN_MAX-DOMAIN_MIN)*2/8,
    BREAKS[3] ?? DOMAIN_MIN + (DOMAIN_MAX-DOMAIN_MIN)*4/8,
    BREAKS[5] ?? DOMAIN_MIN + (DOMAIN_MAX-DOMAIN_MIN)*6/8,
    DOMAIN_MAX
  ];
  labels.forEach(v => {
    const el = document.createElement('span');
    el.textContent = fmt(+v);
    labWrap.appendChild(el);
  });
}
function updateLegendTitle(){
  const legendTitleText = document.getElementById('legend-title-text');
  legendTitleText.textContent = (currentFuel === 'g95')
    ? 'Precio de la gasolina'
    : 'Precio del diésel';
}

// SLIDER
noUiSlider.create(rangeEl, {
  start: [FALLBACK_MIN, FALLBACK_MAX],
  connect: true,
  step: 0.01,
  range: { min: FALLBACK_MIN, max: FALLBACK_MAX },
  behaviour: 'tap-drag',
  tooltips: false
});
rangeEl.noUiSlider.on('update', ([a,b]) => {
  minLabel.textContent = fmt(+a);
  maxLabel.textContent = fmt(+b);
});
rangeEl.noUiSlider.on('change', applyFilters);

// TABS
tabs.forEach(btn => {
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('is-active')) return;
    tabs.forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected','false'); });
    btn.classList.add('is-active'); btn.setAttribute('aria-selected','true');

    currentFuel = btn.dataset.fuel;
    updateLegendTitle();

    await loadDomainForFuel(currentFuel);
    buildLegend();
    restyleLayer();
    applyFilters();
  });
});

// EXPRESSIONS
function priceExpr(fieldName){
  return [
    'to-number',
    ['let','s', ['split', ['to-string', ['get', fieldName]], ','],
      ['case',
        ['>', ['length', ['var','s']], 1],
        ['concat', ['at',0,['var','s']], '.', ['at',1,['var','s']]],
        ['at',0,['var','s']]
      ]
    ]
  ];
}
function activePriceExpr(){
  return currentFuel === 'g95' ? priceExpr(FLD.gas95) : priceExpr(FLD.diesel);
}

// CAPA
map.on('load', async () => {
  const TILESET_URL = `mapbox://${TILESET_USER}.${TILESET_ID}`;

  map.addSource('stations', { type: 'vector', url: TILESET_URL });

  map.addLayer({
    id: 'stations-circles',
    type: 'circle',
    source: 'stations',
    'source-layer': SOURCE_LAYER,
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        4, 0.6, 6, 2, 8, 3.5, 10, 5
      ],
      'circle-color': circleColorExpr(currentFuel),
      'circle-stroke-color': circleColorExpr(currentFuel),
      'circle-stroke-width': 0.6,
      'circle-opacity': 0.9
    }
  });

  await loadDomainForFuel(currentFuel);
  updateLegendTitle();
  buildLegend();

  restyleLayer();
  applyFilters();

  map.on('mousemove','stations-circles', e => {
    if (!e.features || !e.features.length) return;
    map.getCanvas().style.cursor = 'pointer';
    const p = e.features[0].properties || {};
    showPopup(e.lngLat, popupHTML(p));
  });
  map.on('mouseleave','stations-circles', () => { map.getCanvas().style.cursor = ''; hidePopup(); });
});

// POPUPS
let popup;
function showPopup(lngLat, html){
  if(!popup) popup = new mapboxgl.Popup({closeButton:false, closeOnClick:false, offset:8});
  popup.setLngLat(lngLat).setHTML(html).addTo(map);
}
function hidePopup(){ if(popup) popup.remove(); }

// STYLE & FILTER
function restyleLayer(){
  if (!map.getLayer('stations-circles')) return;
  const expr = circleColorExpr(currentFuel);
  map.setPaintProperty('stations-circles','circle-color', expr);
  map.setPaintProperty('stations-circles','circle-stroke-color', expr);
}
function applyFilters(){
  if (!map.getLayer('stations-circles')) return;
  const [minV,maxV] = rangeEl.noUiSlider.get().map(Number);
  const field = activePriceExpr();
  map.setFilter('stations-circles', ['all', ['>=', field, minV], ['<=', field, maxV]]);
}
function circleColorExpr(fuel){
  const field = (fuel === 'g95') ? priceExpr(FLD.gas95) : priceExpr(FLD.diesel);
  const COLORS = (fuel === 'g95') ? GAS_COLORS : DIESEL_COLORS;
  return ['step', field,
    COLORS[0],
    BREAKS[0], COLORS[1],
    BREAKS[1], COLORS[2],
    BREAKS[2], COLORS[3],
    BREAKS[3], COLORS[4],
    BREAKS[4], COLORS[5],
    BREAKS[5], COLORS[6],
    BREAKS[6], COLORS[7]
  ];
}

// DYNAMIC DOMAIN
async function loadDomainForFuel(fuel){
  const fieldName = (fuel === 'g95') ? FLD.gas95 : FLD.diesel;
  try{
    const url = `https://api.mapbox.com/tilesets/v1/${TILESET_USER}.${TILESET_ID}/statistics/${SOURCE_LAYER}?access_token=${mapboxgl.accessToken}`;
    const res = await fetch(url);
    if (res.ok){
      const j = await res.json();
      const attrStats = j?.layers?.[SOURCE_LAYER]?.attributes?.[fieldName];
      const min = toNum(attrStats?.min);
      const max = toNum(attrStats?.max);
      if (isFinite(min) && isFinite(max) && max > min){
        setDomain(min, max);
        return;
      }
    }
  } catch(e){}

  const approx = scanViewportDomain(fieldName);
  if (approx){ setDomain(approx.min, approx.max); return; }

  setDomain(FALLBACK_MIN, FALLBACK_MAX);
}
function setDomain(min, max){
  DOMAIN_MIN = round2(min);
  DOMAIN_MAX = round2(max);
  BREAKS = makeEqualBreaks(DOMAIN_MIN, DOMAIN_MAX, 8);

  rangeEl.noUiSlider.updateOptions({
    range: { min: DOMAIN_MIN, max: DOMAIN_MAX },
    start: [DOMAIN_MIN, DOMAIN_MAX]
  }, true);

  minLabel.textContent = fmt(DOMAIN_MIN);
  maxLabel.textContent = fmt(DOMAIN_MAX);

  restyleLayer();
}
function scanViewportDomain(fieldName){
  try{
    const feats = map.querySourceFeatures('stations', {sourceLayer: SOURCE_LAYER}) || [];
    let min = +Infinity, max = -Infinity, count = 0;
    for (const f of feats){
      const raw = f.properties?.[fieldName];
      const num = toNum(raw);
      if (isFinite(num)){
        if (num < min) min = num;
        if (num > max) max = num;
        count++;
      }
    }
    if (count > 0 && max > min){ return {min, max}; }
  }catch(e){}
  return null;
}
function makeEqualBreaks(min, max, classes = 8){
  const steps = classes - 1; 
  const out = [];
  const span = max - min;
  for (let i=1;i<=steps;i++){
    out.push(round2(min + span * (i/classes)));
  }
  return out.slice(0, steps);
}

// POPUP HTML
function fmtPrice(v) {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') + '€/l' : '—';
}
const val = (p, k) => {
  const v = p?.[k];
  return (v == null || v === '') ? '—' : v;
};
function popupHTML(p) {
  const titulo = val(p, FLD.rotulo);
  const direccion = val(p, FLD.direccion);
  const fechaTxt = (p?.[FLD.fechaDescarga] && String(p[FLD.fechaDescarga]).trim() !== '') ? String(p[FLD.fechaDescarga]) : 'Sin datos';

  return `
    <div class="pp">
      <h3 class="pp-title">${titulo}</h3>
      <p class="pp-sub">${direccion}</p>

      <div class="pp-row">
        <div>
          <span class="pp-badge pp-badge--gas">Gasolina 95:</span>
          <div class="pp-price">${fmtPrice(p[FLD.gas95])}</div>
        </div>
        <div>
          <span class="pp-badge pp-badge--diesel">Diésel:</span>
          <div class="pp-price">${fmtPrice(p[FLD.diesel])}</div>
        </div>
      </div>

      <div class="pp-footer">Fecha de actualización: ${fechaTxt}</div>
    </div>
  `;
}

// UTILS
function fmt(n){ return Number(n).toFixed(2).replace('.',',') + '€'; }
function toNum(v){
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}
function round2(n){ return Math.round(n*100)/100; }
