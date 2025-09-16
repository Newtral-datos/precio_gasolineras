/* CONFIG */
mapboxgl.accessToken = 'pk.eyJ1IjoibmV3dHJhbCIsImEiOiJjazJrcDY4Y2gxMmg3M2JvazU4OXV6NHZqIn0.VO5GkvBq_PSJHvX7T8H9jQ';

const INITIAL_CENTER = [-3.7, 40.3];
const INITIAL_ZOOM   = 5;

const FALLBACK_MIN = 1.03;
const FALLBACK_MAX = 1.89;
const FALLBACK_BREAKS = [1.42, 1.46, 1.50, 1.54, 1.58, 1.62, 1.66];

/* Paletas */
const GAS_COLORS = ['#b8fff1','#88ffe5','#5df7d4','#3ceec4','#22ddb1','#09c39a','#019b7a','#00745b'];
const DIESEL_COLORS = ['#fff4c2','#ffe79a','#ffd76a','#ffca3a','#f3b61f','#d79a00','#a87200','#6f4d00'];

/* Tileset */
const TILESET_USER = 'newtral';
const TILESET_ID   = '7sapo8ln';
const SOURCE_LAYER = 'precios_gasolineras';

/* Campos */
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

/* Estado */
let DOMAIN_MIN = FALLBACK_MIN;
let DOMAIN_MAX = FALLBACK_MAX;
let BREAKS     = [...FALLBACK_BREAKS];
let currentFuel = 'g95';

/* Cache global por carburante */
const STATS_CACHE = { g95: null, diesel: null };

/* UI */
const geocoder = new MapboxGeocoder({
  accessToken: mapboxgl.accessToken, mapboxgl,
  placeholder: 'Busca una calle...', countries: 'es,pt', language: 'es', marker: false
});
const tabs = document.querySelectorAll('#fuel-tabs .tab');
const swWrap = document.getElementById('legend-swatches');
const labWrap = document.getElementById('legend-labels');
const rangeEl = document.getElementById('range');
const minLabel = document.getElementById('min-label');
const maxLabel = document.getElementById('max-label');

/* Mapa */
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/newtral/cmfcdokcl006f01sd20984lhq',
  center: INITIAL_CENTER, zoom: INITIAL_ZOOM, antialias: true
});
map.addControl(new mapboxgl.NavigationControl(), 'top-right');
document.getElementById('search').appendChild(geocoder.onAdd(map));

/* Leyenda */
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
  const labels = [DOMAIN_MIN, BREAKS[1] ?? mid(2/8), BREAKS[3] ?? mid(4/8), BREAKS[5] ?? mid(6/8), DOMAIN_MAX];
  labels.forEach(v => {
    const el = document.createElement('span');
    el.textContent = fmt(+v);
    labWrap.appendChild(el);
  });
}
function updateLegendTitle(){
  const legendTitleText = document.getElementById('legend-title-text');
  legendTitleText.textContent = (currentFuel === 'g95') ? 'Precio de la Gasolina' : 'Precio del Diésel';
}
const mid = f => DOMAIN_MIN + (DOMAIN_MAX - DOMAIN_MIN) * f;

/* Slider (solo para escritorio) */
noUiSlider.create(rangeEl, {
  start: [FALLBACK_MIN, FALLBACK_MAX],
  connect: true,
  step: 0.01,
  range: { min: FALLBACK_MIN, max: FALLBACK_MAX },
  behaviour: 'tap-drag',
  tooltips: false
});
rangeEl.noUiSlider.on('update', ([a,b]) => { minLabel.textContent = fmt(+a); maxLabel.textContent = fmt(+b); });
rangeEl.noUiSlider.on('change', applyFilters);

/* Tabs */
tabs.forEach(btn => {
  btn.addEventListener('click', async () => {
    if (btn.classList.contains('is-active')) return;
    tabs.forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-selected','false'); });
    btn.classList.add('is-active'); btn.setAttribute('aria-selected','true');

    currentFuel = btn.dataset.fuel;
    updateLegendTitle();

    await ensureGlobalStats(currentFuel);
    syncSliderLegendAndStyle();
  });
});

/* Expresiones */
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
function activePriceExpr(){ return currentFuel === 'g95' ? priceExpr(FLD.gas95) : priceExpr(FLD.diesel); }
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

/* Carga inicial */
map.on('load', async () => {
  const TILESET_URL = `mapbox://${TILESET_USER}.${TILESET_ID}`;
  map.addSource('stations', { type: 'vector', url: TILESET_URL });
  map.addLayer({
    id: 'stations-circles',
    type: 'circle',
    source: 'stations',
    'source-layer': SOURCE_LAYER,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 6, 2, 8, 3.5, 10, 5],
      'circle-color': circleColorExpr(currentFuel),
      'circle-stroke-color': circleColorExpr(currentFuel),
      'circle-stroke-width': 0.6,
      'circle-opacity': 0.95
    }
  });

  await ensureGlobalStats(currentFuel);
  updateLegendTitle();
  syncSliderLegendAndStyle();

  map.on('mousemove','stations-circles', e => {
    if (!e.features || !e.features.length) return;
    map.getCanvas().style.cursor = 'pointer';
    const p = e.features[0].properties || {};
    showPopup(e.lngLat, popupHTML(p));
  });
  map.on('mouseleave','stations-circles', () => { map.getCanvas().style.cursor = ''; hidePopup(); });
});

/* Popup */
let popup;
function showPopup(lngLat, html){
  if(!popup) popup = new mapboxgl.Popup({closeButton:false, closeOnClick:false, offset:8});
  popup.setLngLat(lngLat).setHTML(html).addTo(map);
}
function hidePopup(){ if(popup) popup.remove(); }

/* Estilo / Filtro */
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
function syncSliderLegendAndStyle(){
  rangeEl.noUiSlider.updateOptions({
    range: { min: DOMAIN_MIN, max: DOMAIN_MAX },
    start: [DOMAIN_MIN, DOMAIN_MAX]
  }, true);
  minLabel.textContent = fmt(DOMAIN_MIN);
  maxLabel.textContent = fmt(DOMAIN_MAX);
  buildLegend();
  restyleLayer();
  applyFilters();
}

/* Estadísticos GLOBALes (cuantiles si hay histograma) */
async function ensureGlobalStats(fuel){
  if (STATS_CACHE[fuel]) {
    const {min,max,breaks} = STATS_CACHE[fuel];
    setDomain(min,max,breaks);
    return;
  }
  const fieldName = (fuel === 'g95') ? FLD.gas95 : FLD.diesel;
  let min = FALLBACK_MIN, max = FALLBACK_MAX, breaks = [...FALLBACK_BREAKS];
  try{
    const url = `https://api.mapbox.com/tilesets/v1/${TILESET_USER}.${TILESET_ID}/statistics/${SOURCE_LAYER}?access_token=${mapboxgl.accessToken}`;
    const res = await fetch(url);
    if (res.ok){
      const j = await res.json();
      const attr = j?.layers?.[SOURCE_LAYER]?.attributes?.[fieldName];
      const m0 = toNum(attr?.min);
      const m1 = toNum(attr?.max);
      if (isFinite(m0) && isFinite(m1) && m1 > m0){
        min = m0; max = m1;
        const qBreaks = makeQuantileBreaksFromStats(attr, 8);
        breaks = (qBreaks && qBreaks.length === 7) ? qBreaks : makeEqualBreaks(min, max, 8);
      }
    }
  }catch(e){}
  STATS_CACHE[fuel] = {min, max, breaks};
  setDomain(min, max, breaks);
}

/* Dominio activo */
function setDomain(min, max, breaks){
  DOMAIN_MIN = round2(min);
  DOMAIN_MAX = round2(max);
  BREAKS     = breaks.map(round2);
}

/* Helpers cuantiles/intervalos */
function makeEqualBreaks(min, max, classes = 8){
  const out = [], span = max - min;
  for (let i=1; i<classes; i++) out.push(min + span * (i/classes));
  return out;
}
function makeQuantileBreaksFromStats(attr, classes = 8){
  if (!attr) return null;
  let edges=null, counts=null;
  if (attr.histogram?.binEdges && attr.histogram?.counts){
    edges = attr.histogram.binEdges; counts = attr.histogram.counts;
  } else if (Array.isArray(attr.histogram?.bins)){
    const bins = attr.histogram.bins;
    edges = [bins[0].start, ...bins.map(b=>b.end)];
    counts = bins.map(b=>b.count);
  } else return null;

  if (!edges || !counts || edges.length !== counts.length+1) return null;
  const total = counts.reduce((a,b)=>a+b,0); if (!total) return null;

  const cum=[]; counts.reduce((acc,v,i)=>(cum[i]=acc+v, acc+v),0);
  const targets=[]; for(let i=1;i<classes;i++) targets.push(total*(i/classes));

  const cuts = targets.map(T=>{
    let bin = cum.findIndex(c=>c>=T); if (bin<0) bin = counts.length-1;
    const cPrev = bin===0?0:cum[bin-1], inBin = counts[bin]||1;
    const t = Math.max(0, Math.min(1, (T - cPrev)/inBin));
    return edges[bin] + t*(edges[bin+1]-edges[bin]);
  }).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);

  for(let i=1;i<cuts.length;i++) if (cuts[i] <= cuts[i-1]) cuts[i] = cuts[i-1] + 1e-6;
  return cuts.length === classes-1 ? cuts : null;
}

/* Popup HTML */
function fmtPrice(v){
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') + '€/l' : '—';
}
const val = (p,k) => {
  const v = p?.[k]; return (v == null || v === '') ? '—' : v;
};
function popupHTML(p){
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

/* Utils */
function fmt(n){ return Number(n).toFixed(2).replace('.',',') + '€'; }
function toNum(v){
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}
function round2(n){ return Math.round(n*100)/100; }
