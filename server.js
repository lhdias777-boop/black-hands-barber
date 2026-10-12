const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 10000);
const ASAAS_BASE_URL = (process.env.ASAAS_BASE_URL || 'https://api-sandbox.asaas.com/v3').replace(/\/$/, '');
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WHATSAPP_NUMBER = '5531971245200';
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};

function send(res, status, data) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 100000) throw new Error('Requisição muito grande.'); }
  return raw ? JSON.parse(raw) : {};
}
async function supabaseRequest(pathname, method='GET', body) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase do servidor não configurado. Adicione SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render.');
  const response = await fetch(SUPABASE_URL + pathname, {
    method,
    headers: {'apikey':SUPABASE_SERVICE_ROLE_KEY,'Authorization':'Bearer '+SUPABASE_SERVICE_ROLE_KEY,'content-type':'application/json','Prefer':'return=representation'},
    ...(body ? {body:JSON.stringify(body)} : {})
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) {
    const err = new Error(data.message || data.error_description || data.hint || 'Erro no Supabase.');
    err.status=response.status; throw err;
  }
  return data;
}
async function getOrCreateGuestProfile(name, phone) {
  const digits=String(phone||'').replace(/\D/g,'').slice(-13);
  if (digits.length < 10) throw new Error('Informe um WhatsApp válido.');
  const existing=await supabaseRequest('/rest/v1/profiles?phone=eq.'+encodeURIComponent(digits)+'&select=id,full_name,phone&limit=1');
  if (Array.isArray(existing) && existing[0]) return existing[0];
  const guestEmail='guest.'+digits+'@blackhands.local';
  const password=crypto.randomBytes(24).toString('hex');
  const user=await supabaseRequest('/auth/v1/admin/users','POST',{email:guestEmail,password,email_confirm:true,user_metadata:{full_name:name,phone:digits}});
  const id=user.id || user.user?.id;
  if (!id) throw new Error('Não foi possível criar o cadastro do cliente.');
  const profile=await supabaseRequest('/rest/v1/profiles?id=eq.'+encodeURIComponent(id)+'&select=id,full_name,phone&limit=1');
  return Array.isArray(profile) && profile[0] ? profile[0] : {id,full_name:name,phone:digits};
}
function whatsappBookingUrl(name,phone,booking) {
  const lines=[
    'Olá, Black Hands! Quero confirmar meu agendamento.',
    'Nome: '+name,
    'WhatsApp: '+phone,
    'Data: '+booking.date,
    'Horário: '+booking.time,
    'Barbeiro: '+booking.barberName,
    'Serviços: '+booking.services.join(' + '),
    'Total: R$ '+booking.total.toFixed(2).replace('.',','),
    'Pagamento: '+(booking.paymentMethod==='online'?'Pix':'Dinheiro no dia')
  ];
  return 'https://wa.me/'+WHATSAPP_NUMBER+'?text='+encodeURIComponent(lines.join('\n'));
}
async function asaas(pathname, method='GET', body) {
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw new Error('Pagamento ainda não configurado no servidor. Adicione ASAAS_API_KEY nas variáveis do Render.');
  const response = await fetch(ASAAS_BASE_URL + pathname, {
    method,
    headers: {'access_token':key,'content-type':'application/json','accept':'application/json','User-Agent':'BlackHandsBarber/1.0'},
    ...(body ? {body:JSON.stringify(body)} : {})
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) {
    const err = new Error(data.errors?.map(x=>x.description).join('; ') || data.message || 'O Asaas recusou a solicitação.');
    err.status = response.status; throw err;
  }
  return data;
}
async function api(req,res,url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res,200,{ok:true});
  if (req.method === 'POST' && url.pathname === '/api/bookings') {
    try {
      const body=await readBody(req);
      const name=String(body.name||'').trim().slice(0,120);
      const phone=String(body.phone||'').replace(/\D/g,'').slice(0,13);
      const barberId=String(body.barberId||'');
      const date=String(body.date||'');
      const time=String(body.time||'').slice(0,5);
      const paymentMethod=body.paymentMethod==='online'?'online':'shop';
      const serviceIds=Array.isArray(body.serviceIds)?[...new Set(body.serviceIds.map(String))]:[];
      if(!name || phone.length<10 || !barberId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !serviceIds.length) return send(res,400,{error:'Preencha nome, WhatsApp, serviços, data e horário.'});
      const barberRows=await supabaseRequest('/rest/v1/barbers?id=eq.'+encodeURIComponent(barberId)+'&active=eq.true&select=id,name&limit=1');
      if(!barberRows[0]) return send(res,400,{error:'Barbeiro indisponível.'});
      const serviceRows=await supabaseRequest('/rest/v1/services?id=in.('+serviceIds.map(encodeURIComponent).join(',')+')&active=eq.true&select=id,name,price,duration_minutes');
      if(serviceRows.length!==serviceIds.length) return send(res,400,{error:'Um dos serviços não está disponível.'});
      const ordered=serviceIds.map(id=>serviceRows.find(s=>s.id===id)).filter(Boolean);
      const existing=await supabaseRequest('/rest/v1/appointments?barber_id=eq.'+encodeURIComponent(barberId)+'&appointment_date=eq.'+encodeURIComponent(date)+'&status=neq.cancelled&select=appointment_time');
      const booked=new Set((existing||[]).map(x=>String(x.appointment_time).slice(0,5)));
      const slots=['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00','18:30'];
      const start=slots.indexOf(time);
      const chosenSlots=ordered.map((_,i)=>slots[start+i]);
      if(start<0 || chosenSlots.some(t=>!t) || chosenSlots.some(t=>booked.has(t))) return send(res,409,{error:'Esse horário não comporta todos os serviços escolhidos. Escolha outro horário.'});
      const profile=await getOrCreateGuestProfile(name,phone);
      const inserted=[];
      try {
        for(let i=0;i<ordered.length;i++){
          const rows=await supabaseRequest('/rest/v1/appointments','POST',[{client_id:profile.id,service_id:ordered[i].id,barber_id:barberId,appointment_date:date,appointment_time:chosenSlots[i],payment_method:paymentMethod,status:'confirmed'}]);
          if(!rows[0]?.id) throw new Error('Falha ao salvar o agendamento.');
          inserted.push(rows[0].id);
        }
      } catch(error) {
        if(inserted.length) await supabaseRequest('/rest/v1/appointments?id=in.('+inserted.map(encodeURIComponent).join(',')+')','DELETE').catch(()=>{});
        throw error;
      }
      const total=ordered.reduce((sum,s)=>sum+Number(s.price||0),0);
      const wa=whatsappBookingUrl(name,phone,{date,time,barberName:barberRows[0].name,services:ordered.map(s=>s.name),total,paymentMethod});
      return send(res,200,{ok:true,ids:inserted,total,whatsappUrl:wa,slots:chosenSlots});
    } catch(error) {
      return send(res,error.status && error.status<500?400:500,{error:error.message||'Não foi possível criar o agendamento.'});
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/payments/pix') {
    try {
      const body = await readBody(req);
      const email = String(body.email || '').trim().slice(0,180);
      const name = String(body.name || '').trim().slice(0,120);
      const phone = String(body.phone || '').replace(/\D/g,'').slice(0,13);
      const kind = body.kind === 'booking' ? 'booking' : 'club';
      let value, description, reference;
      if (kind === 'club') {
        const plan = body.plan === 'combo_02' ? 'combo_02' : body.plan === 'combo_01' ? 'combo_01' : '';
        if (!plan || !email || !name || ![11,14].includes(cpfCnpj.length)) return send(res,400,{error:'Informe nome, e-mail, CPF/CNPJ válido e combo.'});
        value = plan === 'combo_01' ? 70 : 160;
        description = 'Black Hands Club - '+(plan==='combo_01'?'Combo 01':'Combo 02')+' - primeiro mês';
        reference = 'bhclub-'+plan+'-'+Date.now();
      } else {
        const allowed = {'Cabelo':35,'Barba':30,'Pintura':15,'Relaxamento':15,'Pigmentação':15,'Pezinho':10,'Sobrancelha':10};
        const chosen = Array.isArray(body.services) ? [...new Set(body.services.map(x=>String(x)))] : [];
        if (!email || !name || ![11,14].includes(cpfCnpj.length) || !chosen.length || chosen.some(x=>!(x in allowed))) return send(res,400,{error:'Informe nome, e-mail, CPF/CNPJ válido e serviços válidos.'});
        value = chosen.reduce((sum,x)=>sum+allowed[x],0);
        description = 'Black Hands - '+chosen.join(' + ');
        reference = 'bhbooking-'+Date.now();
      }
      const customerBody = {name,email,cpfCnpj,notificationDisabled:true,externalReference:'blackhands-'+Date.now()};
      if (phone.length >= 10) customerBody.mobilePhone = phone;
      const customer = await asaas('/customers','POST',customerBody);
      const today = new Date();
      const dueDate = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
      const payment = await asaas('/payments','POST',{
        customer:customer.id,billingType:'PIX',value,dueDate,description,externalReference:reference
      });
      const qr = await asaas('/payments/'+encodeURIComponent(payment.id)+'/pixQrCode');
      return send(res,200,{paymentId:payment.id,value,kind,encodedImage:qr.encodedImage,payload:qr.payload,expirationDate:qr.expirationDate,invoiceUrl:payment.invoiceUrl||null,environment:ASAAS_BASE_URL.includes('sandbox')?'sandbox':'production'});
    } catch (error) {
      return send(res,error.status && error.status < 500 ? 400 : 500,{error:error.message || 'Não foi possível gerar o Pix.'});
    }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/payments/') && url.pathname.endsWith('/status')) {
    try {
      const id = decodeURIComponent(url.pathname.slice('/api/payments/'.length,-'/status'.length));
      if (!id || id.includes('/')) return send(res,400,{error:'ID de pagamento inválido.'});
      const payment = await asaas('/payments/'+encodeURIComponent(id)+'/status');
      return send(res,200,{id,status:payment.status,paid:['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(payment.status)});
    } catch (error) {
      return send(res,error.status && error.status < 500 ? 400 : 500,{error:error.message || 'Não foi possível consultar o pagamento.'});
    }
  }
  return send(res,404,{error:'Rota não encontrada.'});
}
const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url,'http://localhost');
  if (url.pathname.startsWith('/api/')) return api(req,res,url);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(ROOT,'.'+pathname);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT,'index.html')) {res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(file,(err,buffer)=>{
    if (err) {res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});return res.end('Not found');}
    res.writeHead(200,{'content-type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','x-content-type-options':'nosniff'});
    res.end(buffer);
  });
});
server.listen(PORT,'0.0.0.0',()=>console.log('Black Hands server running on '+PORT));
