// premios-cloud.js
const SUPABASE_URL  = 'https://floigaudprqfbwhwzbmw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsb2lnYXVkcHJxZmJ3aHd6Ym13Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5MTkyNDcsImV4cCI6MjA2OTQ5NTI0N30.guc4XWLGcJCcLNaJL2S1jEla944YPxOZr2oJPJRDBTA';
const supabase = window.__sb || (window.__sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON));

/* ===== UTILES ===== */
const tz = 'America/Argentina/Buenos_Aires';
const fmtDate = (d=new Date()) =>
  new Intl.DateTimeFormat('sv-SE',{ timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit'}).format(d);

const $  = (q,root=document)=>root.querySelector(q);
const $$ = (q,root=document)=>Array.from(root.querySelectorAll(q));

function today(){ return fmtDate(new Date()); }
function selectedDate(){
  const el = document.getElementById('ver-fecha');
  const v  = el?.value;
  return (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : today();
}

/* ===== SESIÓN ===== */
(async () => {
  const { data:{ session }, error } = await supabase.auth.getSession();
  if (error) console.error('[AUTH getSession]', error);
  if (!session) { console.warn('[AUTH] sin sesión → no sincronizo'); return; }

  const USER_ID = session.user.id;
  localStorage.setItem('sb_user_id', USER_ID);
  console.log('[AUTH] sesión OK', USER_ID);

  // SYNC INICIAL (usa fecha seleccionada)
  await initialPull(USER_ID, selectedDate());
  try{ window.dispatchEvent(new StorageEvent('storage',{key:'__sync__', newValue:String(Date.now())})); }catch{}

  // ENGANCHES (solo INSERT; delete/toggle lo hace el index por sid)
  hookPremios(USER_ID);
  hookOficina(USER_ID);
  hookAciertosOfi(USER_ID);
  hookPagos(USER_ID);
  hookControl(USER_ID);
  
    // Helpers globales para que el index use sid exacto y para pedir otro día
  window.cloud = {
    async premiosUpdateBySid(sid, fields){
      return supabase.from('premios').update({
        ticket:   fields.ticket   ?? undefined,
        tipo:     fields.tipo     ?? undefined,
        cantidad: fields.cantidad ?? null,
        cliente:  fields.cliente  ?? undefined,
        notas:    fields.notas    ?? undefined
      }).eq('id', sid);
    },

    async premiosDeleteBySid(sid){
      return supabase.from('premios').update({ eliminado:true }).eq('id', sid);
    },

    async pagosToggleBySid(sid, toggles){
      return supabase.from('pg_pagos').update(toggles).eq('id', sid);
    },

    async pagosDeleteBySid(sid){
      return supabase.from('pg_pagos').update({ eliminado:true }).eq('id', sid);
    },

    async ofiDeleteBySid(sid){
      return supabase.from('ofi_movimientos').update({ eliminado:true }).eq('id', sid);
    },

    async aoDeleteBySid(sid){
      return supabase.from('ao_aciertos').update({ eliminado:true }).eq('id', sid);
    },

    // 👇👇👇 NUEVO: usado por index.html → window.cloud.saveNotas(fecha, texto)
    async saveNotas(fecha, texto){
      const userId  = localStorage.getItem('sb_user_id');
      const row = {
        user_id: userId,
        fecha,
        texto,
        updated_at: new Date().toISOString()
      };
      const { error } = await supabase.from('notas_dia').upsert(row);
      if (error) throw error;

      // espejo local para que se vea al instante
      const uidLocal = localStorage.getItem('usuario_id');
      localStorage.setItem(`notas:${uidLocal}:${fecha}`, texto);

      // avisar a otras pestañas / vistas
      try {
        window.dispatchEvent(new StorageEvent('storage', { key:'__sync__', newValue: String(Date.now()) }));
      } catch {}
    },

    async pull(fecha){
      await initialPull(USER_ID, fecha || selectedDate());
      try{ window.dispatchEvent(new StorageEvent('storage',{key:'__sync__', newValue:String(Date.now())})); }catch{}
    }
  };

  console.log('[CLOUD] listo (adaptador)');
})();

/* ===== PULL INICIAL ===== */
async function initialPull(USER_ID, fecha) {
  // Identidad local
  let uidLocal = localStorage.getItem('usuario_id');
  if (!uidLocal) {
    const { data:{ session } } = await supabase.auth.getSession();
    const email = session?.user?.email || '';
    uidLocal = (email.split('@')[0] || session?.user?.id || 'me');
    localStorage.setItem('usuario_id', uidLocal);
    if (session?.user?.id) localStorage.setItem('sb_user_id', session.user.id);
  }
  const K = (base) => `${base}:${uidLocal}:${fecha}`;

  console.log('[PULL] bajando datos de', fecha);

  const [
    premiosRes,
    ofiRes,
    aoRes,
    pgRes,
    notasRes,
    ctrlRes
  ] = await Promise.all([
    supabase.from('premios')
      .select('id,hora,ticket,tipo,cantidad,cliente,notas')
      .eq('user_id', USER_ID).eq('fecha', fecha).eq('eliminado', false).order('hora',{ascending:true}),
    supabase.from('ofi_movimientos')
      .select('id,hora,monto')
      .eq('user_id', USER_ID).eq('fecha', fecha).eq('eliminado', false).order('hora',{ascending:true}),
    supabase.from('ao_aciertos')
      .select('id,hora,acierto,por,nombre')
      .eq('user_id', USER_ID).eq('fecha', fecha).eq('eliminado', false).order('hora',{ascending:true}),
    supabase.from('pg_pagos')
      .select('id,hora,monto,cliente,cuenta,status_ok,status_money,status_cross')
      .eq('user_id', USER_ID).eq('fecha', fecha).eq('eliminado', false).order('hora',{ascending:true}),
    supabase.from('notas_dia')
      .select('texto').eq('user_id', USER_ID).eq('fecha', fecha).maybeSingle(),
    supabase.from('control_estado')
      .select('activo').eq('user_id', USER_ID).eq('fecha', fecha).maybeSingle()
  ]);

  // PREMIOS
  if (premiosRes.error) console.error('[PULL premios] error', premiosRes.error);
  const premiosRows = (premiosRes.data||[]).map(r => ({
    id: Date.parse(r.hora),
    sid: r.id,
    hora: r.hora,
    ticket: r.ticket,
    tipo: r.tipo,
    cantidad: r.cantidad ?? '',
    cliente: r.cliente,
    notas: r.notas ?? '',
    redoblona: null
  }));
  localStorage.setItem(K('premios'), JSON.stringify(premiosRows));

  // OFICINA
  if (ofiRes.error) console.error('[PULL ofi] error', ofiRes.error);
  const ofiRows = (ofiRes.data||[]).map(r => ({
    id: Date.parse(r.hora),
    sid: r.id,
    hora: r.hora,
    monto: r.monto
  }));
  localStorage.setItem(K('ofi'), JSON.stringify(ofiRows));

  // ACIERTOS OFI
  if (aoRes.error) console.error('[PULL ao] error', aoRes.error);
  const aoRows = (aoRes.data||[]).map(r => ({
    id: Date.parse(r.hora),
    sid: r.id,
    hora: r.hora,
    acierto: r.acierto,
    por: r.por ?? '',
    nombre: r.nombre
  }));
  localStorage.setItem(K('ao'), JSON.stringify(aoRows));

  // PAGOS
  if (pgRes.error) console.error('[PULL pg] error', pgRes.error);
  const pgRows = (pgRes.data||[]).map(r => ({
    id: Date.parse(r.hora),
    sid: r.id,
    hora: r.hora,
    monto: r.monto,
    cliente: r.cliente,
    cuenta: r.cuenta ?? '',
    status: { ok: !!r.status_ok, money: !!r.status_money, cross: !!r.status_cross }
  }));
  localStorage.setItem(K('pg'), JSON.stringify(pgRows));
  console.log('[PULL pagos]', pgRows.length);

  // NOTAS
  if (notasRes.error && notasRes.error.code !== 'PGRST116') {
    console.error('[PULL notas] error', notasRes.error);
  }
  localStorage.setItem(K('notas'), notasRes.data?.texto ?? '');

  // CONTROL
  if (ctrlRes.error && ctrlRes.error.code !== 'PGRST116') {
    console.error('[PULL control] error', ctrlRes.error);
  }
  localStorage.setItem('control_activo', (ctrlRes.data?.activo ? '1':'0'));

  // repintar SOLO cuando el index avise que está listo
  (function waitForAppReady(){
    if (window.__app_ready && typeof window.render === 'function') {
      window.render();
    } else {
      setTimeout(waitForAppReady, 40);
    }
  })();
}

/* ===== PREMIOS ===== */
function hookPremios(USER_ID){
  const form = document.getElementById('premio-form');
  if(!form) return;

  form.addEventListener('submit', async ()=>{
    try{
      const fecha    = selectedDate();
      const ticket   = $('#ticket')?.value?.trim() ?? '';
      const tipo     = $('#tipo')?.value?.trim() ?? '';
      const cantidad = ($('#cantidad')?.value ?? '').trim();
      const cliente  = $('#cliente')?.value?.trim() ?? '';
      const notas    = $('#notas')?.value?.trim() ?? '';
      if(!ticket || !tipo || !cliente){ console.log('[PREMIOS] bloqueado por validación local'); return; }

      const row = {
        user_id: USER_ID, fecha, hora: new Date().toISOString(),
        ticket, tipo, cantidad: cantidad?Number(cantidad):null, cliente, notas, eliminado:false
      };
      const { data, error } = await supabase.from('premios')
        .insert([row]).select('id,hora').single();
      if(error) throw error;

      // pegar sid al último item local del día seleccionado
      const K = (base)=>`${base}:${localStorage.getItem('usuario_id')}:${fecha}`;
      const arr = JSON.parse(localStorage.getItem(K('premios'))||'[]');
      if (arr.length){
        arr[arr.length-1].sid  = data.id;
        arr[arr.length-1].hora = data.hora || arr[arr.length-1].hora;
        localStorage.setItem(K('premios'), JSON.stringify(arr));
      }
    }catch(err){
      console.error('[PREMIOS insert] error', err);
      alert('Error guardando en la nube (premios).');
    }
  }, { capture:true });
}

/* ===== OFICINA ===== */
function hookOficina(USER_ID){
  const add = document.getElementById('ofi-add');
  const input = document.getElementById('ofi-monto');
  if(!add || !input) return;

  add.addEventListener('click', async ()=>{
    const raw = (input.value||'').replace(/\D+/g,'');
    if(!raw) return;
    try{
      const fecha = selectedDate();
      const row = { user_id: USER_ID, fecha, monto: Number(raw), eliminado:false };
      const { data, error } = await supabase.from('ofi_movimientos')
        .insert([row]).select('id,hora').single();
      if(error) throw error;

      const K = (base)=>`${base}:${localStorage.getItem('usuario_id')}:${fecha}`;
      const arr = JSON.parse(localStorage.getItem(K('ofi'))||'[]');
      if (arr.length){
        arr[arr.length-1].sid  = data.id;
        arr[arr.length-1].hora = data.hora || arr[arr.length-1].hora;
        localStorage.setItem(K('ofi'), JSON.stringify(arr));
      }
    }catch(err){
      console.error('[OFI insert] error', err);
      alert('Error guardando en la nube (oficina).');
    }
  }, { capture:true });
}

/* ===== ACIERTOS OFI ===== */
function hookAciertosOfi(USER_ID){
  const add = document.getElementById('ao-add');
  const ac  = document.getElementById('ao-acierto');
  const por = document.getElementById('ao-por');
  const nom = document.getElementById('ao-nombre');
  if(!add) return;

  add.addEventListener('click', async ()=>{
    const A = ac?.value?.trim(); const P = (por?.value||'').replace(/\D+/g,''); const N = nom?.value?.trim();
    if(!A || !N) return;
    try{
      const fecha = selectedDate();
      const row = { user_id: USER_ID, fecha, acierto: A, por: P?Number(P):null, nombre: N, eliminado:false };
      const { data, error } = await supabase.from('ao_aciertos')
        .insert([row]).select('id,hora').single();
      if(error) throw error;

      const K = (base)=>`${base}:${localStorage.getItem('usuario_id')}:${fecha}`;
      const arr = JSON.parse(localStorage.getItem(K('ao'))||'[]');
      if (arr.length){
        arr[arr.length-1].sid  = data.id;
        arr[arr.length-1].hora = data.hora || arr[arr.length-1].hora;
        localStorage.setItem(K('ao'), JSON.stringify(arr));
      }
    }catch(err){
      console.error('[AO insert] error', err);
      alert('Error guardando en la nube (aciertos oficina).');
    }
  }, { capture:true });
}

/* ===== PAGOS ===== */
function hookPagos(USER_ID){
  const add = document.getElementById('pg-add');
  const m = document.getElementById('pg-monto');
  const c = document.getElementById('pg-cliente');
  const a = document.getElementById('pg-cuenta');
  if(!add) return;

  add.addEventListener('click', async ()=>{
    const M = (m?.value||'').replace(/\D+/g,''); const C = c?.value?.trim(); const A = a?.value?.trim();
    if(!M || !C) return;
    try{
      const fecha = selectedDate();
      const row = { user_id: USER_ID, fecha, monto: Number(M), cliente:C, cuenta:A||null, eliminado:false };
      const { data, error } = await supabase.from('pg_pagos')
        .insert([row]).select('id,hora').single();
      if(error) throw error;

      const K = (base)=>`${base}:${localStorage.getItem('usuario_id')}:${fecha}`;
      const arr = JSON.parse(localStorage.getItem(K('pg'))||'[]');
      if (arr.length){
        arr[arr.length-1].sid  = data.id;
        arr[arr.length-1].hora = data.hora || arr[arr.length-1].hora;
        localStorage.setItem(K('pg'), JSON.stringify(arr));
      }
    }catch(err){
      console.error('[PG insert] error', err);
      alert('Error guardando en la nube (pagos).');
    }
  }, { capture:true });
}


/* ===== CONTROL GLOBAL (pull periódico para multi-dispositivo) ===== */
function hookControl(USER_ID){
  setInterval(async ()=>{
    try{
      const { data, error } = await supabase.from('control_estado')
        .select('activo, updated_at')
        .eq('user_id', USER_ID)
        .eq('fecha', selectedDate())
        .maybeSingle();

      if(error && error.code!=='PGRST116') throw error;

      const serverOn = !!data?.activo;
      const localOn  = localStorage.getItem('control_activo') === '1';
      if (serverOn !== localOn){
        localStorage.setItem('control_activo', serverOn ? '1' : '0');
        try{ window.dispatchEvent(new StorageEvent('storage',{key:'__control__', newValue:String(Date.now())})); }catch{}
      }
    }catch(e){
      console.error('[CONTROL poll] error', e);
    }
  }, 5000);
}