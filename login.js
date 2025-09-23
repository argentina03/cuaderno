// login.js (cloud)

const SUPABASE_URL  = 'https://floigaudprqfbwhwzbmw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsb2lnYXVkcHJxZmJ3aHd6Ym13Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5MTkyNDcsImV4cCI6MjA2OTQ5NTI0N30.guc4XWLGcJCcLNaJL2S1jEla944YPxOZr2oJPJRDBTA';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

const form = document.querySelector('form');
const userInput = document.getElementById('usuario');
const passInput = document.getElementById('password');
const msg = document.getElementById('msg');

// Si ya hay sesión, adentro
(async ()=>{
  const { data:{ session } } = await supabase.auth.getSession();
  if (session?.user) {
    localStorage.setItem('sb_user_id', session.user.id); // solo sb_user_id
// NO toques usuario_id (que siga siendo 2323/2334/etc)// compat
    location.replace('index.html');
  }
})();

form?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const u = (userInput.value || '').trim();
  const p = (passInput.value || '').trim();
  if(!u || !p){ msg.textContent='Completá usuario y clave'; return; }

  const email = `${u}@cuaderno.local`;
  msg.textContent = 'Ingresando...';

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: p });

  if (error) {
    msg.textContent = 'Usuario o clave incorrectos';
    return;
  }
  localStorage.setItem('sb_user_id', data.user.id); // UUID de sesión (para Supabase)
localStorage.setItem('usuario_id', u);            // tu ID lógico: 2323 / 2334 / etc.
  location.replace('index.html');
});