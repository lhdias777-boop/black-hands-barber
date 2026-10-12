const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 10000);
const ASAAS_BASE_URL = (process.env.ASAAS_BASE_URL || 'https://api-sandbox.asaas.com/v3').replace(/\/$/, '');
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
