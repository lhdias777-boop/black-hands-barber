const times = ["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30"];
const dateInput = document.getElementById("date");
const timeSelect = document.getElementById("time");
const serviceOptions = document.getElementById("serviceOptions");
let pendingBooking = null;
let currentPaymentId = null;
let currentPaymentKind = null;
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
  serviceOptions.innerHTML=services.map(s=>`<label class="service-check"><input type="checkbox" name="serviceChoice" value="${s.id}"><span>${s.name}</span><strong>${money(s.price)}</strong></label>`).join('');
  serviceOptions.querySelectorAll('input').forEach(input=>input.addEventListener('change',updateSelectedServicesTotal));
  barberSelect.innerHTML='<option value="">Selecione</option>'+barbers.map(b=>`<option value="${b.id}">${b.name}</option>`).join('');
  updateSelectedServicesTotal();
}
function selectedServices(){
  const ids=[...document.querySelectorAll('input[name="serviceChoice"]:checked')].map(x=>x.value);
  return services.filter(s=>ids.includes(s.id));
}
function updateSelectedServicesTotal(){
  const chosen=selectedServices();
  document.getElementById('selectedServicesTotal').textContent='Total: '+money(chosen.reduce((n,s)=>n+Number(s.price||0),0));
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
  if(found){
    const input=[...document.querySelectorAll('input[name="serviceChoice"]')].find(x=>x.value===found.id);
    if(input){input.checked=true;updateSelectedServicesTotal();}
  }
  document.getElementById("agendar").scrollIntoView({behavior:"smooth"});
}
window.selectService=selectService;

async function getUser(){ if(!sb) return null; const {data}=await sb.auth.getUser(); return data.user; }

async function updateAuthUI(){
  if(!sb) return;
  const user=await getUser();
  if(!authBox) return;
  const authSection=document.getElementById('authPanel');
  if(user){
    authSection.style.display='none';
    authBox.innerHTML=`<div class="account-card"><div><small>LOGADO</small><strong>${user.email}</strong></div><button class="btn btn-small" id="logoutBtn">SAIR</button></div>`;
    const logout=document.getElementById('logoutBtn');
    if(logout) logout.onclick=async()=>{await sb.auth.signOut();location.reload();};
    const note=document.querySelector('.logged-user-note');if(note)note.textContent='Conectado como '+user.email;
  }else{
    authSection.style.display='';
    authBox.innerHTML=`<div class="account-card"><div><small>CLIENTE</small><strong>Entre para agendar e ver seus horários</strong></div><button class="btn btn-small" id="loginOpen">ENTRAR</button></div>`;
    document.getElementById('loginOpen').onclick=()=>authSection.scrollIntoView({behavior:'smooth'});
  }
}

async function loadMyBookings(){
  const box=document.getElementById('myBookings'); if(!box||!sb) return;
  const user=await getUser(); if(!user){box.innerHTML='<p>Entre na sua conta para visualizar seus agendamentos.</p>';return;}
  const {data,error}=await sb.from('appointments').select('id,appointment_date,appointment_time,status,payment_method,barbers(name),services(name,price)').eq('client_id',user.id).order('appointment_date',{ascending:true}).order('appointment_time',{ascending:true});
  if(error){box.innerHTML='<p>Erro ao carregar agendamentos.</p>';return;}
  box.innerHTML=data?.length?data.map(a=>`<article class="booking-item"><strong>${a.services?.name||'Serviço'}</strong><span>${a.appointment_date} às ${String(a.appointment_time).slice(0,5)} • ${a.barbers?.name||''}</span><em>${a.status}</em></article>`).join(''):'<p>Você ainda não possui agendamentos.</p>';
}

async function createPixPayment(kind, extra={}){
  const user=await getUser();
  if(!user) throw new Error('Entre na sua conta antes de continuar.');
  const {data:profile}=await sb.from('profiles').select('full_name,phone').eq('id',user.id).maybeSingle();
  const name=profile?.full_name||user.user_metadata?.full_name||user.email?.split('@')[0]||'Cliente Black Hands';
  const phone=profile?.phone||user.user_metadata?.phone||'';
  const response=await fetch('/api/payments/pix',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,plan:extra.plan,services:extra.services,email:user.email,name,phone})});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error||'Não foi possível gerar o Pix.');
  currentPaymentId=data.paymentId;currentPaymentKind=kind;
  document.getElementById('clubPayment').hidden=false;
  document.getElementById('clubPayment').scrollIntoView({behavior:'smooth',block:'center'});
  document.getElementById('clubPaymentTitle').textContent=kind==='club'?'Pix do Black Hands Club':'Pix do agendamento';
  document.getElementById('clubPaymentStatus').textContent='Valor: '+money(data.value)+' • '+(data.environment==='sandbox'?'AMBIENTE DE TESTE':'AMBIENTE DE PRODUÇÃO');
  const img=document.getElementById('clubQrImage');
  img.src=data.encodedImage?'data:image/png;base64,'+data.encodedImage:'';
  img.style.display=data.encodedImage?'block':'none';
  document.getElementById('clubPixPayload').value=data.payload||'';
  document.getElementById('clubPixLabel').style.display=data.payload?'block':'none';
  document.getElementById('copyClubPix').style.display=data.payload?'inline-block':'none';
  document.getElementById('checkClubPayment').style.display='inline-block';
  document.getElementById('clubPaymentNote').textContent=kind==='club'?'Esta cobrança paga o primeiro mês do combo. A renovação automática ainda não está ativada.':'Após a confirmação do pagamento, o site concluirá o agendamento.';
  return data;
}
async function saveBookingAppointments(booking,paymentMethod){
  const {data:occupied,error:occError}=await sb.from('appointments').select('appointment_time').eq('barber_id',booking.barberId).eq('appointment_date',booking.date).neq('status','cancelled');
  if(occError) throw new Error('Não consegui conferir os horários: '+occError.message);
  const booked=new Set((occupied||[]).map(x=>String(x.appointment_time).slice(0,5)));
  const start=times.indexOf(booking.time);
  const slots=booking.chosen.map((s,i)=>times[start+i]);
  if(start<0||slots.some(t=>!t)||slots.some(t=>booked.has(t))) throw new Error('Não há horários consecutivos suficientes para todos os serviços. Escolha outro horário ou reduza os serviços.');
  for(let i=0;i<booking.chosen.length;i++){
    const {error}=await sb.from('appointments').insert({client_id:booking.userId,service_id:booking.chosen[i].id,barber_id:booking.barberId,appointment_date:booking.date,appointment_time:slots[i],payment_method:paymentMethod,status:'confirmed'});
    if(error) throw new Error('Não foi possível salvar todos os serviços: '+error.message);
  }
  await loadMyBookings();
}
document.getElementById("bookingForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const user=await getUser();
  if(!sb){setResult('<strong>Supabase ainda não configurado.</strong>',false);return;}
  if(!user){setResult('<strong>Entre ou crie sua conta antes de agendar.</strong>',false);document.getElementById('authPanel').scrollIntoView({behavior:'smooth'});return;}
  const chosen=selectedServices(), barberId=barberSelect.value, date=dateInput.value, time=timeSelect.value;
  const payment=document.querySelector('input[name="payment"]:checked')?.value||'shop';
  if(!chosen.length||!barberId||!date||!time){setResult('Selecione um ou mais serviços, barbeiro, data e horário.',false);return;}
  const start=times.indexOf(time);
  if(start<0||start+chosen.length>times.length){setResult('Não há horários suficientes depois desse horário para todos os serviços. Escolha um horário anterior.',false);return;}
  const booking={userId:user.id,chosen,barberId,date,time};
  if(payment==='online'){
    try{pendingBooking=booking;await createPixPayment('booking',{services:chosen.map(s=>s.name)});setResult('Leia o QR Code Pix e depois toque em “Já paguei — verificar”. O agendamento só será salvo após confirmação.',true);}
    catch(error){pendingBooking=null;setResult('<strong>Erro no pagamento:</strong><br>'+error.message,false);}
    return;
  }
  try{await saveBookingAppointments(booking,'shop');setResult('<strong>✓ Agendamento confirmado!</strong><br>'+chosen.map((s,i)=>esc(s.name)+' — '+esc(slotsLabel(time,i))).join('<br>')+'<br><br>Pagamento na barbearia.');e.target.reset();updateSelectedServicesTotal();timeSelect.innerHTML='<option value="">Selecione barbeiro e data</option>';}
  catch(error){setResult('<strong>Não foi possível concluir:</strong><br>'+error.message,false);await loadAvailableTimes();}
});
function slotsLabel(startTime,offset){const i=times.indexOf(startTime);return times[i+offset]||startTime;}

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
  if((await getUser()) && mode==='login') document.getElementById('authForm').reset();
});

const modeToggle=document.getElementById('authToggle');
if(modeToggle) modeToggle.onclick=()=>{const m=document.getElementById('authMode');m.value=m.value==='login'?'signup':'login';document.getElementById('authTitle').textContent=m.value==='login'?'Entrar na conta':'Criar minha conta';document.getElementById('authSubmit').textContent=m.value==='login'?'ENTRAR':'CRIAR CONTA';document.getElementById('authNameWrap').hidden=m.value==='login';document.getElementById('authPhoneWrap').hidden=m.value==='login';modeToggle.textContent=m.value==='login'?'Ainda não tenho conta':'Já tenho conta';};

document.getElementById('buyCombo01').addEventListener('click',()=>buyClub('combo_01'));
document.getElementById('buyCombo02').addEventListener('click',()=>buyClub('combo_02'));
async function buyClub(plan){
  const user=await getUser();
  if(!user){setResult('<strong>Entre na sua conta para assinar o Club.</strong>',false);document.getElementById('authPanel').style.display='';document.getElementById('authPanel').scrollIntoView({behavior:'smooth'});return;}
  try{await createPixPayment('club',{plan});}
  catch(error){document.getElementById('clubPayment').hidden=false;document.getElementById('clubPaymentStatus').textContent='Erro: '+error.message;document.getElementById('clubPayment').scrollIntoView({behavior:'smooth'});}
}
document.getElementById('copyClubPix').onclick=async()=>{try{await navigator.clipboard.writeText(document.getElementById('clubPixPayload').value);document.getElementById('clubPaymentStatus').textContent='Código Pix copiado. Valor: '+document.getElementById('clubPaymentStatus').textContent.split('Valor: ')[1];}catch{document.getElementById('clubPaymentStatus').textContent='Selecione e copie o código Pix manualmente.';}};
document.getElementById('checkClubPayment').onclick=async()=>{
 if(!currentPaymentId)return;
 const btn=document.getElementById('checkClubPayment');btn.disabled=true;
 try{
  const response=await fetch('/api/payments/'+encodeURIComponent(currentPaymentId)+'/status');
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Falha ao consultar pagamento.');
  if(!data.paid){document.getElementById('clubPaymentStatus').textContent='Pagamento ainda não confirmado (status: '+data.status+'). Tente novamente em instantes.';return;}
  if(currentPaymentKind==='booking'&&pendingBooking){
    await saveBookingAppointments(pendingBooking,'online');pendingBooking=null;
    document.getElementById('clubPaymentStatus').textContent='Pagamento confirmado e agendamento salvo!';
    setResult('<strong>✓ Pix confirmado!</strong><br>Seus serviços foram agendados. Confira em “Meus agendamentos”.');
    document.getElementById('bookingForm').reset();updateSelectedServicesTotal();timeSelect.innerHTML='<option value="">Selecione barbeiro e data</option>';
  }else{
    document.getElementById('clubPaymentStatus').textContent='Pagamento do primeiro mês confirmado. A equipe precisa validar e ativar o combo no painel administrativo.';
  }
 }catch(error){document.getElementById('clubPaymentStatus').textContent='Erro ao verificar: '+error.message;}
 finally{btn.disabled=false;}
};
\n// Carrossel
const track = document.getElementById("sliderTrack"); const slides=[...document.querySelectorAll('.slide')]; const dots=[...document.querySelectorAll('.dot')]; let currentSlide=0,startX=0,deltaX=0,dragging=false,autoTimer;
function showSlide(i){currentSlide=(i+slides.length)%slides.length;track.style.transform=`translateX(-${currentSlide*100}%)`;slides.forEach((s,n)=>s.classList.toggle('active',n===currentSlide));dots.forEach((d,n)=>d.classList.toggle('active',n===currentSlide));}
document.getElementById('prevSlide').onclick=()=>showSlide(currentSlide-1);document.getElementById('nextSlide').onclick=()=>showSlide(currentSlide+1);dots.forEach(d=>d.onclick=()=>showSlide(Number(d.dataset.slide)));
function restartAuto(){clearInterval(autoTimer);autoTimer=setInterval(()=>showSlide(currentSlide+1),6000);}restartAuto();
track.addEventListener('pointerdown',e=>{dragging=true;startX=e.clientX;deltaX=0;track.classList.add('dragging');clearInterval(autoTimer);track.setPointerCapture(e.pointerId)});
track.addEventListener('pointermove',e=>{if(!dragging)return;deltaX=e.clientX-startX;track.style.transform=`translateX(calc(-${currentSlide*100}% + ${deltaX}px))`});
track.addEventListener('pointerup',()=>{if(!dragging)return;dragging=false;track.classList.remove('dragging');if(Math.abs(deltaX)>60)showSlide(currentSlide+(deltaX<0?1:-1));else showSlide(currentSlide);restartAuto()});
track.addEventListener('pointercancel',()=>{dragging=false;track.classList.remove('dragging');showSlide(currentSlide);restartAuto()});

initSupabase();
