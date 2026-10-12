const times = ["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30"];
const dateInput = document.getElementById("date");
const timeSelect = document.getElementById("time");
const serviceSelect = document.getElementById("service");
const barberSelect = document.getElementById("barber");
const result = document.getElementById("bookingResult");
const authBox = document.getElementById("authBox");

let sb = null;
let services = [];
let barbers = [];

function setResult(message, ok=true){ result.hidden=false; result.className='result '+(ok?'':'error'); result.innerHTML=message; }
function money(v){ return Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
function todayISO(){ const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }

async function initSupabase(){
  if(window.SUPABASE_URL?.startsWith('http') && window.SUPABASE_ANON_KEY && window.supabase){
    sb=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY);
    await loadCatalog();
    await updateAuthUI();
    await loadMyBookings();
  }else{
    setResult('<strong>Configuração pendente.</strong><br>O site está pronto para o Supabase. Preencha <b>config.js</b> com a URL e a chave pública do seu projeto.', false);
    loadLocalCatalog();
  }
}

function loadLocalCatalog(){
  services=[
    {id:'cabelo',name:'Cabelo',price:35,duration_minutes:30}, {id:'barba',name:'Barba',price:30,duration_minutes:30},
    {id:'pintura',name:'Pintura',price:15,duration_minutes:30}, {id:'relaxamento',name:'Relaxamento',price:15,duration_minutes:30},
    {id:'pigmentacao',name:'Pigmentação',price:15,duration_minutes:30}, {id:'pezinho',name:'Pezinho',price:10,duration_minutes:15},
    {id:'sobrancelha',name:'Sobrancelha',price:10,duration_minutes:15}
  ];
  barbers=[];
  renderCatalog();
}

async function loadCatalog(){
  const [s,b]=await Promise.all([sb.from('services').select('*').eq('active',true).order('name'),sb.from('barbers').select('*').eq('active',true).order('name')]);
  if(s.error){ setResult('Erro ao carregar serviços: '+s.error.message,false); return; }
  if(b.error){ setResult('Erro ao carregar barbeiros: '+b.error.message,false); return; }
  services=s.data||[]; barbers=(b.data||[]).filter(b=>String(b.name||'').trim().toUpperCase()==='WELIGOL'); renderCatalog();
}

function renderCatalog(){
  serviceSelect.innerHTML='<option value="">Selecione</option>'+services.map(s=>`<option value="${s.id}">${s.name} — ${money(s.price)}</option>`).join('');
  barberSelect.innerHTML='<option value="">Selecione</option>'+barbers.map(b=>`<option value="${b.id}">${b.name}</option>`).join('');
}

async function loadAvailableTimes(){
  const barberId=barberSelect.value, date=dateInput.value;
  timeSelect.innerHTML='<option value="">Carregando...</option>';
  if(!barberId || !date){ timeSelect.innerHTML='<option value="">Selecione barbeiro e data</option>'; return; }
  let booked=[];
  if(sb){
    const {data,error}=await sb.from('appointments').select('appointment_time').eq('barber_id',barberId).eq('appointment_date',date).neq('status','cancelled');
    if(error){ timeSelect.innerHTML='<option value="">Erro ao carregar</option>'; setResult('Não foi possível carregar os horários: '+error.message,false); return; }
    booked=(data||[]).map(x=>String(x.appointment_time).slice(0,5));
  }
  const now=new Date();
  const sameDay=date===todayISO();
  const available=times.filter(t=>!booked.includes(t) && (!sameDay || t>now.toTimeString().slice(0,5)));
  timeSelect.innerHTML=available.length?'<option value="">Selecione</option>'+available.map(t=>`<option value="${t}">${t}</option>`).join(''):'<option value="">Nenhum horário disponível</option>';
}

async function selectService(name){
  const found=services.find(s=>s.name.toLowerCase()===name.toLowerCase());
  if(found) serviceSelect.value=found.id;
  document.getElementById("agendar").scrollIntoView({behavior:"smooth"});
}
window.selectService=selectService;

async function getUser(){ if(!sb) return null; const {data}=await sb.auth.getUser(); return data.user; }

async function updateAuthUI(){
  if(!sb) return;
  const user=await getUser();
  if(!authBox) return;
  if(user){
    authBox.innerHTML=`<div class="account-card"><div><small>LOGADO</small><strong>${user.email}</strong></div><button class="btn btn-small" id="logoutBtn">SAIR</button></div>`;
    document.getElementById('logoutBtn').onclick=async()=>{await sb.auth.signOut(); location.reload();};
  }else{
    authBox.innerHTML=`<div class="account-card"><div><small>CLIENTE</small><strong>Entre para agendar e ver seus horários</strong></div><button class="btn btn-small" id="loginOpen">ENTRAR</button></div>`;
    document.getElementById('loginOpen').onclick=()=>document.getElementById('authPanel').scrollIntoView({behavior:'smooth'});
  }
}

async function loadMyBookings(){
  const box=document.getElementById('myBookings'); if(!box||!sb) return;
  const user=await getUser(); if(!user){box.innerHTML='<p>Entre na sua conta para visualizar seus agendamentos.</p>';return;}
  const {data,error}=await sb.from('appointments').select('id,appointment_date,appointment_time,status,payment_method,barbers(name),services(name,price)').eq('client_id',user.id).order('appointment_date',{ascending:true}).order('appointment_time',{ascending:true});
  if(error){box.innerHTML='<p>Erro ao carregar agendamentos.</p>';return;}
  box.innerHTML=data?.length?data.map(a=>`<article class="booking-item"><strong>${a.services?.name||'Serviço'}</strong><span>${a.appointment_date} às ${String(a.appointment_time).slice(0,5)} • ${a.barbers?.name||''}</span><em>${a.status}</em></article>`).join(''):'<p>Você ainda não possui agendamentos.</p>';
}

document.getElementById("bookingForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const user=await getUser();
  if(!sb){setResult('<strong>Supabase ainda não configurado.</strong><br>Preencha o <b>config.js</b> antes de testar o agendamento.',false);return;}
  if(!user){setResult('<strong>Você precisa criar uma conta ou entrar.</strong><br>Use a área de acesso abaixo antes de confirmar o horário.',false);document.getElementById('authPanel').scrollIntoView({behavior:'smooth'});return;}
  const serviceId=serviceSelect.value, barberId=barberSelect.value, date=dateInput.value, time=timeSelect.value;
  const payment=document.querySelector('input[name="payment"]:checked')?.value||'shop';
  if(!serviceId||!barberId||!date||!time){setResult('Preencha serviço, barbeiro, data e horário.',false);return;}
  const {error}=await sb.from('appointments').insert({client_id:user.id,service_id:serviceId,barber_id:barberId,appointment_date:date,appointment_time:time,payment_method:payment,status:'confirmed'});
  if(error){
    if(error.code==='23505') setResult('<strong>Esse horário acabou de ser ocupado.</strong><br>Escolha outro horário.',false);
    else setResult('<strong>Não foi possível confirmar.</strong><br>'+error.message,false);
    await loadAvailableTimes(); return;
  }
  const s=services.find(x=>x.id===serviceId), b=barbers.find(x=>x.id===barberId);
  setResult(`<strong>✓ Agendamento confirmado!</strong><br><br>${s?.name||''} com <b>${b?.name||''}</b> em <b>${date}</b> às <b>${time}</b>.<br><br><a class="btn btn-small" target="_blank" href="https://wa.me/?text=${encodeURIComponent(`Olá! Meu agendamento na Black Hands foi confirmado: ${s?.name||''} com ${b?.name||''}, dia ${date} às ${time}.`)}">CONFIRMAR NO WHATSAPP</a>`);
  e.target.reset(); timeSelect.innerHTML='<option value="">Selecione barbeiro e data</option>'; await loadMyBookings();
});

barberSelect.addEventListener('change',loadAvailableTimes); dateInput.addEventListener('change',loadAvailableTimes);
dateInput.min=todayISO();
dateInput.addEventListener('input',()=>{
  if(!dateInput.value) return;
  const day=new Date(dateInput.value+'T12:00:00').getDay();
  if(day===0){
    dateInput.value='';
    timeSelect.innerHTML='<option value="">Domingo não temos atendimento</option>';
    setResult('<strong>Domingo não temos atendimento.</strong><br>Escolha uma data de segunda a sábado.',false);
  }
});

// Auth
const authForm=document.getElementById('authForm');
if(authForm) authForm.addEventListener('submit',async e=>{
  e.preventDefault();
  if(!sb){alert('Configure o Supabase no config.js primeiro.');return;}
  const mode=document.getElementById('authMode').value;
  const email=document.getElementById('authEmail').value.trim(), password=document.getElementById('authPassword').value;
  let response;
  if(mode==='signup'){
    response=await sb.auth.signUp({email,password,options:{data:{full_name:document.getElementById('authName').value.trim(),phone:document.getElementById('authPhone').value.trim()}}});
  }else response=await sb.auth.signInWithPassword({email,password});
  if(response.error){document.getElementById('authMessage').textContent=response.error.message;return;}
  document.getElementById('authMessage').textContent=mode==='signup'?'Conta criada. Verifique o e-mail se a confirmação estiver ativada.':'Login realizado.';
  await updateAuthUI(); await loadMyBookings();
});

const modeToggle=document.getElementById('authToggle');
if(modeToggle) modeToggle.onclick=()=>{const m=document.getElementById('authMode');m.value=m.value==='login'?'signup':'login';document.getElementById('authTitle').textContent=m.value==='login'?'Entrar na conta':'Criar minha conta';document.getElementById('authSubmit').textContent=m.value==='login'?'ENTRAR':'CRIAR CONTA';document.getElementById('authNameWrap').hidden=m.value==='login';document.getElementById('authPhoneWrap').hidden=m.value==='login';modeToggle.textContent=m.value==='login'?'Ainda não tenho conta':'Já tenho conta';};

// Carrossel
const track = document.getElementById("sliderTrack"); const slides=[...document.querySelectorAll('.slide')]; const dots=[...document.querySelectorAll('.dot')]; let currentSlide=0,startX=0,deltaX=0,dragging=false,autoTimer;
function showSlide(i){currentSlide=(i+slides.length)%slides.length;track.style.transform=`translateX(-${currentSlide*100}%)`;slides.forEach((s,n)=>s.classList.toggle('active',n===currentSlide));dots.forEach((d,n)=>d.classList.toggle('active',n===currentSlide));}
document.getElementById('prevSlide').onclick=()=>showSlide(currentSlide-1);document.getElementById('nextSlide').onclick=()=>showSlide(currentSlide+1);dots.forEach(d=>d.onclick=()=>showSlide(Number(d.dataset.slide)));
function restartAuto(){clearInterval(autoTimer);autoTimer=setInterval(()=>showSlide(currentSlide+1),6000);}restartAuto();
track.addEventListener('pointerdown',e=>{dragging=true;startX=e.clientX;deltaX=0;track.classList.add('dragging');clearInterval(autoTimer);track.setPointerCapture(e.pointerId)});
track.addEventListener('pointermove',e=>{if(!dragging)return;deltaX=e.clientX-startX;track.style.transform=`translateX(calc(-${currentSlide*100}% + ${deltaX}px))`});
track.addEventListener('pointerup',()=>{if(!dragging)return;dragging=false;track.classList.remove('dragging');if(Math.abs(deltaX)>60)showSlide(currentSlide+(deltaX<0?1:-1));else showSlide(currentSlide);restartAuto()});
track.addEventListener('pointercancel',()=>{dragging=false;track.classList.remove('dragging');showSlide(currentSlide);restartAuto()});

initSupabase();
