const times = ["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30"];
const dateInput = document.getElementById("date");
const timeSelect = document.getElementById("time");
const serviceOptions = document.getElementById("serviceOptions");
let pendingBooking = null;
let currentPaymentId = null;
let currentPaymentKind = null;
let queuedPayment = null;
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

async function getUser(){ return null; }
function getClientData(){
  const saved=JSON.parse(localStorage.getItem('blackhands_client')||'null');
  return {name:document.getElementById('bookingName')?.value.trim()||saved?.name||'',phone:document.getElementById('bookingPhone')?.value.trim()||saved?.phone||''};
}
function saveClientData(name,phone){
  localStorage.setItem('blackhands_client',JSON.stringify({name,phone}));
}
function openBookingWhatsApp(url){
  if(url) window.open(url,'_blank','noopener');
}
function restoreClientData(){
  try{
    const saved=JSON.parse(localStorage.getItem('blackhands_client')||'null');
    if(saved?.name) document.getElementById('bookingName').value=saved.name;
    if(saved?.phone) document.getElementById('bookingPhone').value=saved.phone;
  }catch{}
}

async function updateAuthUI(){
  if(!sb) return;
  const user=await getUser();
  if(!authBox) return;
  const authSection=document.getElementById('authPanel');
  const headerLogout=document.getElementById('headerLogout');
  if(headerLogout){
    headerLogout.hidden=!user;
    headerLogout.onclick=async()=>{await sb.auth.signOut();location.reload();};
  }
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

function preparePixPayment(kind, extra={}){
  queuedPayment={kind,extra};
  const panel=document.getElementById('clubPayment');panel.hidden=false;
  document.getElementById('cpfPaymentForm').style.display='flex';
  document.getElementById('clubQrImage').style.display='none';
  document.getElementById('clubPixLabel').style.display='none';
  document.getElementById('copyClubPix').style.display='none';
  document.getElementById('checkClubPayment').style.display='none';
  document.getElementById('clubPaymentTitle').textContent='Dados para gerar o Pix';
  document.getElementById('clubPaymentStatus').textContent='Informe o CPF/CNPJ do pagador para criar a cobrança no Asaas.';
  panel.scrollIntoView({behavior:'smooth',block:'center'});
}
async function createPixPayment(kind, extra={}){
  const client=getClientData();
  if(!client.name || !client.phone) throw new Error('Preencha nome e WhatsApp antes de continuar.');
  const response=await fetch('/api/payments/pix',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,plan:extra.plan,services:extra.services,email:'',name:client.name,phone:client.phone,cpfCnpj:document.getElementById('paymentCpf').value})});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error||'Não foi possível gerar o Pix.');
  currentPaymentId=data.paymentId;currentPaymentKind=kind;
  document.getElementById('cpfPaymentForm').style.display='none';
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
  document.getElementById('clubPaymentNote').textContent=kind==='club'?'Esta cobrança paga o primeiro mês do combo. A renovação automática ainda não está ativada.':'Após a confirmação do pagamento, o agendamento será salvo e enviado para o WhatsApp da barbearia.';
  return data;
}
async function saveBookingAppointments(booking,paymentMethod){
  const response=await fetch('/api/bookings',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:booking.name,phone:booking.phone,serviceIds:booking.chosen.map(s=>s.id),barberId:booking.barberId,date:booking.date,time:booking.time,paymentMethod})});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error||'Não foi possível salvar o agendamento.');
  saveClientData(booking.name,booking.phone);
  return data;
}
document.getElementById("bookingForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!sb){setResult('<strong>Supabase ainda não configurado.</strong>',false);return;}
  const client=getClientData();
  const chosen=selectedServices(), barberId=barberSelect.value, date=dateInput.value, time=timeSelect.value;
  const payment=document.querySelector('input[name="payment"]:checked')?.value||'shop';
  if(!client.name||!client.phone||!chosen.length||!barberId||!date||!time){setResult('Preencha nome, WhatsApp, um ou mais serviços, data e horário.',false);return;}
  const start=times.indexOf(time);
  if(start<0||start+chosen.length>times.length){setResult('Não há horários suficientes depois desse horário para todos os serviços. Escolha um horário anterior.',false);return;}
  const booking={name:client.name,phone:client.phone,chosen,barberId,date,time};
  saveClientData(client.name,client.phone);
  if(payment==='online'){
    pendingBooking=booking;preparePixPayment('booking',{services:chosen.map(s=>s.name)});
    setResult('Preencha o CPF/CNPJ para gerar o QR Code Pix. O agendamento será salvo após a confirmação.',true);
    return;
  }
  try{
    const data=await saveBookingAppointments(booking,'shop');
    setResult('<strong>✓ Agendamento confirmado!</strong><br>'+chosen.map((s,i)=>esc(s.name)+' — '+esc(slotsLabel(time,i))).join('<br>')+'<br><br>Pagamento em dinheiro no dia.');
    openBookingWhatsApp(data.whatsappUrl);
    e.target.reset();restoreClientData();updateSelectedServicesTotal();timeSelect.innerHTML='<option value="">Selecione barbeiro e data</option>';
  }catch(error){setResult('<strong>Não foi possível concluir:</strong><br>'+error.message,false);await loadAvailableTimes();}
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

document.getElementById('cpfPaymentForm').addEventListener('submit',async(e)=>{
 e.preventDefault();
 if(!queuedPayment)return;
 const cpf=document.getElementById('paymentCpf').value.replace(/\\D/g,'');
 if(![11,14].includes(cpf.length)){document.getElementById('clubPaymentStatus').textContent='Digite um CPF ou CNPJ com quantidade correta de números.';return;}
 const submit=e.submitter; if(submit)submit.disabled=true;
 document.getElementById('clubPaymentStatus').textContent='Gerando cobrança no Asaas...';
 try{await createPixPayment(queuedPayment.kind,queuedPayment.extra);}
 catch(error){document.getElementById('clubPaymentStatus').textContent='Erro ao gerar Pix: '+error.message;}
 finally{if(submit)submit.disabled=false;}
});
document.getElementById('buyCombo01').addEventListener('click',()=>buyClub('combo_01'));
document.getElementById('buyCombo02').addEventListener('click',()=>buyClub('combo_02'));
async function buyClub(plan){
  const client=getClientData();
  if(!client.name||!client.phone){
    const booking=document.getElementById('agendar');
    booking.classList.remove('booking-hidden');
    booking.scrollIntoView({behavior:'smooth'});
    setResult('<strong>Preencha seu nome e WhatsApp no agendamento para continuar.</strong>',false);
    return;
  }
  try{preparePixPayment('club',{plan});}
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
    const bookingData=await saveBookingAppointments(pendingBooking,'online');pendingBooking=null;
    document.getElementById('clubPaymentStatus').textContent='Pagamento confirmado e agendamento salvo!';
    setResult('<strong>✓ Pix confirmado!</strong><br>Seus serviços foram agendados e enviados para o WhatsApp da barbearia.');
    openBookingWhatsApp(bookingData.whatsappUrl);
    document.getElementById('bookingForm').reset();updateSelectedServicesTotal();timeSelect.innerHTML='<option value="">Selecione barbeiro e data</option>';
  }else{
    document.getElementById('clubPaymentStatus').textContent='Pagamento do primeiro mês confirmado. A equipe precisa validar e ativar o combo no painel administrativo.';
  }
 }catch(error){document.getElementById('clubPaymentStatus').textContent='Erro ao verificar: '+error.message;}
 finally{btn.disabled=false;}
};

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
restoreClientData();


document.querySelectorAll('a[href="#agendar"]').forEach(link=>{link.addEventListener('click',e=>{e.preventDefault();const booking=document.getElementById('agendar');booking.classList.remove('booking-hidden');booking.scrollIntoView({behavior:'smooth'});history.replaceState(null,'','#agendar');});});
if(location.hash==='#agendar') document.getElementById('agendar')?.classList.remove('booking-hidden');
