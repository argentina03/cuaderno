// =====================
// Config Supabase Juegos
// =====================
const SUPABASE_URL = "https://ffjsouoobqgxgpqcodgb.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZmanNvdW9vYnFneGdwcWNvZGdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1NjUwODksImV4cCI6MjA3MzE0MTA4OX0.NAyaaaarngVnraOo3ruV3MYyO3nBIWZRurT5P24LT3Y";
const TABLE_GIROS = "giros";

// Cliente de juegos con storageKey distinto → evita warning “Multiple GoTrueClient”
const sbClient = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storageKey: "sb-juegos-auth" }
    })
  : null;

// Pasadores habilitados
const PASADORES_VALIDOS = new Set([2323, 2329, 2334, 2312, 2317, 2340, 1027]);

// Juegos soportados
const JUEGOS = [
  "MAYOR O MENOR",
  "RASPADITA",
  "CARTAS",
  "RULETA",
  "MEMOTEST",
  "BINGO",
];
const JUEGO_LABEL = {
  "MAYOR O MENOR": "⬆️⬇️ Mayor o Menor",
  "RASPADITA":     "🎟️ Raspadita",
  "CARTAS":        "🃏 Cartas",
  "RULETA":        "🎯 Ruleta",
  "MEMOTEST":      "🧠 Memotest",
  "BINGO":         "🔢 Bingo",
};

// Helpers
const TZ_AR = "America/Argentina/Buenos_Aires";
const norm = (s) => (s ?? "").toString().trim().toLowerCase()
  .normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g," ");
const hoyKeyAR = () => new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ_AR, year:"numeric", month:"2-digit", day:"2-digit"
}).format(new Date());
const dateKeyAR = (d) => new Intl.DateTimeFormat("sv-SE", {
  timeZone: TZ_AR, year:"numeric", month:"2-digit", day:"2-digit"
}).format(d);
const formatFechaAR = (d) => new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ_AR, year:"numeric", month:"2-digit", day:"2-digit"
}).format(d);
const formatHoraAR = (d) => new Intl.DateTimeFormat("es-AR", {
  timeZone: TZ_AR, hour:"2-digit", minute:"2-digit", second:"2-digit"
}).format(d);

// Inferencia de juego
function inferirJuego(reg){
  const fuentes = [reg.juego, reg.premio, reg.casino, reg.descripcion]
    .map(x => (x ?? "").toString().toUpperCase());
  for (const f of fuentes){
    if (f.includes("MAYOR") || f.includes("MENOR")) return "MAYOR O MENOR";
    if (f.includes("RASPAD")) return "RASPADITA";
    if (f.includes("CARTA"))  return "CARTAS";
    if (f.includes("RULETA")) return "RULETA";
    if (f.includes("MEMO"))   return "MEMOTEST";
    if (f.includes("BINGO"))  return "BINGO";
  }
  return "RULETA";
}

// Extractor de PASADOR (2323, 2329, etc.) desde columnas texto
const RX_PAS = /\b(2323|2329|2334|2312|2317|2340|1027)\b/;
function extraerPasador(reg, fallback) {
  if (reg.pasador && PASADORES_VALIDOS.has(Number(reg.pasador))) {
    return String(reg.pasador);
  }
  const campos = [reg.juego, reg.casino, reg.descripcion]
    .map(x => (x ?? "").toString());
  for (const txt of campos) {
    const m = txt.match(RX_PAS);
    if (m) return m[1];
  }
  // si no vino, usá el pasador logueado (no lo dejamos vacío)
  return String(fallback || "");
}

// Hora AR robusta
function parseRegistroFecha(reg) {
  // prioridad: hora_ar → hora_local → (fecha + hora) → created_at
  const tryDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d) ? null : d;
  };

  let d =
    tryDate(reg.hora_ar) ||
    tryDate(reg.hora_local) ||
    (reg.fecha && reg.hora
      ? tryDate(`${reg.fecha}T${String(reg.hora).slice(11,19) || "00:00:00"}-03:00`)
      : null) ||
    tryDate(reg.hora) ||
    tryDate(reg.created_at);

  return d;
}
// --- dinero / premio ---
const peso = (n) => '$' + Number(n || 0).toLocaleString('es-AR');

function extraerPremio(reg){
  // probamos varios nombres comunes que pueden llegar de la tabla
  const candidatos = [
    reg.premio, reg.premio_total, reg.premio_ganado,
    reg.monto, reg.importe, reg.total
  ];
  for (const c of candidatos){
    const n = Number(String(c ?? '').replace(/[^\d]/g,''));
    if (n) return n;
  }
  return 0;
}
// Estado + UI refs
const state = { data: [], filtrados: [], chart: null };
const UI = {};
// Cache en memoria para evitar "Cargando..."
let _cache = null;
let _lastFetch = 0;       // epoch ms
const STALE_MS = 30_000;  // refresco si pasaron 30s
// Monta UI dentro de #screen-juegos
function mountUI(){
  if (UI.tbody) return; // ya montado
  const root = document.getElementById("screen-juegos");
  if (!root) return;

  root.innerHTML = `
    <main class="container">
      <div class="card" style="position:relative">
        <h2 style="margin:0 0 10px">Panel de Juegos</h2>

        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
          <button id="jj-recargar" class="btn" title="Recargar">🔄</button>
          <input id="jj-search" placeholder="🔎 Buscar usuario..." style="width:220px" />
          <select id="jj-juego" style="width:220px">
            <option value="">🎮 Todos los juegos</option>
          </select>
          <input type="date" id="jj-fecha" style="width:150px" />
        </div>

        <!-- gráfico mini a la derecha -->
        <div style="position:absolute; right:12px; top:12px; width:240px">
          <canvas id="jj-chart" width="240" height="120" style="display:block"></canvas>
        </div>

        <div id="jj-resumen" class="muted" style="margin:6px 0 12px">—</div>

        <div class="table-wrap" style="margin-top:6px">
          <table>
            <thead>
  <tr>
    <th>Usuario</th>
    <th>Juego</th>
    <th>Premio</th>   <!-- 👈 NUEVO -->
    <th>Fecha</th>
    <th>Hora</th>
    <th>Pasador</th>
  </tr>
</thead>
            <tbody id="jj-tbody">
              <tr><td colspan="5" style="text-align:center;padding:14px">Cargando…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  `;

  UI.btnReload = document.getElementById("jj-recargar");
  UI.sJuego    = document.getElementById("jj-juego");
  UI.sFecha    = document.getElementById("jj-fecha");
  UI.iSearch   = document.getElementById("jj-search");
  UI.tbody     = document.getElementById("jj-tbody");
  UI.resumen   = document.getElementById("jj-resumen");
  UI.chartEl   = document.getElementById("jj-chart");

  UI.sJuego.options.length = 1;
  JUEGOS.forEach(j => {
    const opt = document.createElement("option");
    opt.value = j; opt.textContent = JUEGO_LABEL[j];
    UI.sJuego.appendChild(opt);
  });

  UI.sFecha.value = hoyKeyAR();

  UI.btnReload.addEventListener("click", reload);
  [UI.sJuego, UI.sFecha].forEach(el => el.addEventListener("input", applyFilters));
  UI.iSearch.addEventListener("input", applyFilters);
}

// Filtros UI
function applyFilters(){
  const qUser = norm(UI.iSearch.value);
  const fJuego = UI.sJuego.value;
  const fFecha = UI.sFecha.value;

  state.filtrados = state.data.filter(r => {
    if (qUser) {
      const u = norm(r.usuario || r.user || r.username || "");
      if (!u.includes(qUser)) return false;
    }
    if (fJuego && r.juegoInferido !== fJuego) return false;

    if (fFecha) {
      const d = parseRegistroFecha(r);
      const key = d ? dateKeyAR(d) : (r.fecha ? String(r.fecha) : null);
      if (key !== fFecha) return false;
    }
    return true;
  });
const totalPremios = state.filtrados.reduce((a,r)=> a + (r.__premio||0), 0);
UI.resumen.innerHTML = `Total: <b>${state.filtrados.length}</b> · Premios: <b>${peso(totalPremios)}</b>`;

  UI.tbody.innerHTML = state.filtrados.length
  ? state.filtrados.map(r => {
      const d = parseRegistroFecha(r);
      const f = d ? formatFechaAR(d) : (r.fecha ?? "—");
      const h = d ? formatHoraAR(d)  : (r.hora  ?? "—");
      return `<tr>
        <td>${r.usuario ?? r.user ?? r.username ?? "—"}</td>
        <td>${r.juegoInferido}</td>
        <td>${peso(r.__premio)}</td>    <!-- 👈 NUEVO -->
        <td>${f}</td>
        <td>${h}</td>
        <td>${r.__pasador || "—"}</td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="5" style="text-align:center;padding:16px">
         🕹️ <b>¡Próximamente tus juegos estarán disponibles!</b><br>
         <small class="muted">No hay resultados con los filtros actuales.</small>
       </td></tr>`;

  drawChart(state.filtrados);
}

// Gráfico: barras por PREMIO (monto) → valor = cantidad de veces
function drawChart(rows){
  // agrupar por monto de premio > 0
  const counts = new Map(); // monto -> cantidad
  for (const r of rows){
    const m = Number(r.__premio || 0);
    if (m > 0) counts.set(m, (counts.get(m) || 0) + 1);
  }

  const montos  = [...counts.keys()].sort((a,b)=>a-b);
  const labels  = montos.map(m => peso(m));     // eje X: $500, $2.000, etc.
  const dataCnt = montos.map(m => counts.get(m)); // eje Y: cantidad

  if (state.chart) { state.chart.destroy(); state.chart = null; }
  const ctx = UI.chartEl.getContext("2d");
  state.chart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ label: "Cantidad", data: dataCnt }] },
    options: {
      responsive: false,
      plugins: {
        legend: { display:false },
        tooltip: {
          callbacks: {
            title: (items)=> items[0].label, // el premio ($)
            label: (item)=>{
              const i = item.dataIndex;
              const cant = dataCnt[i];
              const total = peso(montos[i] * cant);
              return [`${cant} premio(s)`, `Total: ${total}`];
            }
          }
        }
      },
      scales: {
        x: { ticks:{ font:{ size:10 }, maxRotation:45, minRotation:45 }, title:{ display:true, text:"Premio" } },
        y: { beginAtZero:true, ticks:{ precision:0, font:{ size:10 } }, title:{ display:true, text:"Cantidad" } }
      }
    }
  });
}
async function fetchAndNormalize() {
  if (!sbClient) return [];

  // si tenemos cache fresco → devolvémoslo
  if (_cache && (Date.now() - _lastFetch) < STALE_MS) return _cache;

  let rows = [];
  try {
    const { data, error } = await sbClient
      .from(TABLE_GIROS).select("*")
      .order("fecha", { ascending:false })
      .order("hora",  { ascending:false });
    if (error) throw error;
    rows = data || [];
  } catch (e) {
    console.error("[JUEGOS] fetch error:", e);
    return _cache || []; // si falla, al menos devolvemos lo que haya
  }

  const myCode = parseInt(localStorage.getItem("usuario_id") || "0", 10);
  const myName = norm(localStorage.getItem("usuario_nombre"));

  rows.forEach(r => {
  r.juegoInferido = inferirJuego(r);
  r.__pasador     = extraerPasador(r, myCode);
  r.__premio      = extraerPremio(r);   // 👈 NUEVO
});

  const filtered = rows.filter(r => {
    const byCode = PASADORES_VALIDOS.has(Number(r.__pasador)) && Number(r.__pasador) === myCode;
    const byName = myName ? (norm(r.usuario || r.user || r.username) === myName) : false;
    return byCode || byName;
  });

  // pisamos cache
  _cache = filtered;
  _lastFetch = Date.now();
  return filtered;
}
// Trae datos + normaliza + limita por pasador logueado
async function reload(){
  if (!sbClient) return;

  // si tengo cache → pinto YA
  if (_cache && _cache.length) {
    state.data = _cache;
    applyFilters();
  } else {
    // primera vez sin cache → mostrás un "cargando" chiquito
    UI.tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:14px">Cargando…</td></tr>`;
  }

  // refresco en background (actualiza cache y repinta si cambia)
  // refresco en background (actualiza cache y repinta)
const fresh = await fetchAndNormalize();
state.data = fresh;
applyFilters();
  }


// “Próximamente” si no aplica
function mountProximamente(motivo){
  const root = document.getElementById("screen-juegos");
  if (!root) return;
  root.innerHTML = `
    <main class="container">
      <div class="card">
        <h2 style="margin:0 0 10px">Panel de Juegos</h2>
        <p class="muted">🕹️ Próximamente disponible.</p>
        <small class="muted">${motivo}</small>
      </div>
    </main>
  `;
}

// API pública que llama el botón 2
async function init(){
  const myCode = parseInt(localStorage.getItem("usuario_id") || "0", 10);

  if (!PASADORES_VALIDOS.has(myCode)) {
    mountProximamente("Tu usuario no está habilitado como pasador.");
    return;
  }
  if (!sbClient) {
    mountProximamente("Falta configurar la otra nube (URL y KEY).");
    return;
  }

  mountUI();
  await reload();
}

// Exponer para que index lo ejecute al tocar “2”
async function preload(){ await fetchAndNormalize(); } // precarga silenciosa

window.juegos = { init, preload };

// Por si te olvidás de llamarlo desde index:
document.getElementById("btn-pantalla2")?.addEventListener("click", () => {
  window.juegos?.init?.();
});