
// BLACK HANDS FINANCE PREMIUM (prévia, somente administradores)
app2.get("/api/admin/financeiro-v2", requireAdmin, (req,res) => {
  res.setHeader("Cache-Control","no-store");
  res.type("html").send(__BH_FINANCE_HTML__);
});
app2.get("/api/admin/live/vip-receivables", requireAdmin, async (req,res) => {
  res.setHeader("Cache-Control","no-store");
  try {
    const memberships = await sbReq("bh_customer_vip_memberships", "?select=account_id,plan,status,paid_until&order=paid_until.asc&limit=1000");
    const ids = [...new Set(memberships.map(x=>x.account_id).filter(Boolean))];
    const accounts = ids.length ? await sbReq("bh_customer_accounts",
      "?id=in.("+ids.map(encodeURIComponent).join(",")+")&select=id,full_name&limit=1000") : [];
    const payments = await sbReq("bh_customer_vip_payments",
      "?select=account_id,plan,amount,created_at&order=created_at.desc&limit=2000");
    const names = new Map(accounts.map(x=>[x.id,x.full_name]));
    const recent = new Map();
    for(const p of payments) {const k=p.account_id+"|"+p.plan;if(!recent.has(k))recent.set(k,Number(p.amount));}
    return res.json({memberships:memberships.map(x=>({
      plan:x.plan,status:x.status,paid_until:x.paid_until,
      customer:names.get(x.account_id)||"Conta "+String(x.account_id).slice(0,8),
      latest_amount:recent.get(x.account_id+"|"+x.plan)??null
    }))});
  } catch(e) {
    console.error("Finance VIP receivables:",String(e.message).slice(0,90));
    return res.status(503).json({error:"Não foi possível carregar os mensais."});
  }
});
app2.get("/api/admin/live/commissions", requireAdmin, async (req,res) => {
  res.setHeader("Cache-Control","no-store");
  const from=String(req.query.from||""),to=String(req.query.to||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)
    return res.status(400).json({error:"Período inválido."});
  try {
    const bookings=await sbReq("bh_booking_reservations",
      "?appointment_date=gte."+from+"&appointment_date=lte."+to+
      "&select=id,barber,amount,payment_method,status&limit=2000");
    const ids=bookings.map(x=>x.id);
    const attended=ids.length ? await sbReq("bh_booking_attendance",
      "?booking_id=in.("+ids.map(encodeURIComponent).join(",")+")&status=eq.ATTENDED&select=booking_id&limit=2000") : [];
    const set=new Set(attended.map(x=>x.booking_id));
    const totals=new Map();
    for(const b of bookings) {
      if(!set.has(b.id)||b.status==="CANCELLED"||b.status==="EXPIRED")continue;
      const name=b.barber||"Barbeiro",t=totals.get(name)||{barber:name,attended:0,service_total:0};
      t.attended++;t.service_total+=Number(b.amount||0);totals.set(name,t);
    }
    return res.json({barbers:[...totals.values()].map(x=>({...x,service_total:Math.round(x.service_total*100)/100})),commissionRateConfigured:false});
  } catch(e) {
    console.error("Finance commissions:",String(e.message).slice(0,90));
    return res.status(503).json({error:"Não foi possível carregar os atendimentos."});
  }
});


/* Ranking de servicos: selecionados versus vendidos. Sem dupla contagem PIX/atendimento.
 * Somente admin; cada agendamento conta uma vez por servico distinto.
 * Uma venda = PIX Asaas producao pago ou recebimento presencial registrado;
 * servicos VIP atendidos sao contabilizados separadamente como incluidos no plano.
 */
app2.get("/api/admin/live/service-stats", requireAdmin, async (req,res) => {
  accountNoCache(res);
  const from=String(req.query.from||""), to=String(req.query.to||"");
  const valid=(x)=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&new Date(x+"T12:00:00Z").toISOString().slice(0,10)===x;
  if(!valid(from)||!valid(to)||from>to||(Date.parse(to)-Date.parse(from))/864e5>366)
    return res.status(400).json({error:"Escolha um periodo valido de ate 12 meses."});
  try {
    const fromTs=from+"T00:00:00-03:00";
    const nextDay=new Date(Date.parse(to+"T12:00:00Z")+864e5).toISOString().slice(0,10);
    const toTs=nextDay+"T00:00:00-03:00";
    const [bookings,orders,receipts,attendance,vipPaid,products,catalog]=await Promise.all([
      sbReq("bh_booking_reservations","?appointment_date=gte."+from+"&appointment_date=lte."+to+
        "&status=in.(CONFIRMED,AWAITING_STAFF)&select=id,service_names,payment_method,pix_order_id,amount&limit=2000"),
      sbReq("bh_pix_orders","?kind=eq.booking&status=eq.PAID&payment_environment=eq.production"+
        "&select=id&limit=2000"),
      sbReq("bh_cash_receipts","?select=booking_id&limit=2000"),
      sbReq("bh_booking_attendance","?status=eq.ATTENDED&select=booking_id&limit=2000"),
      sbReq("bh_customer_vip_payments","?status=eq.PAID&payment_environment=eq.production"+
        "&paid_at=gte."+encodeURIComponent(fromTs)+"&paid_at=lt."+encodeURIComponent(toTs)+
        "&select=id,plan,amount&limit=2000"),
      sbReq("bh_pix_orders","?kind=eq.store&status=eq.PAID&payment_environment=eq.production"+
        "&paid_at=gte."+encodeURIComponent(fromTs)+"&paid_at=lt."+encodeURIComponent(toTs)+
        "&select=id,details,amount&limit=2000"),
      sbReq("bh_management_catalog","?kind=eq.product&select=id,name&limit=2000")
    ]);
    const paidIds=new Set(orders.map(x=>x.id)), cashIds=new Set(receipts.map(x=>x.booking_id)),
      attendedIds=new Set(attendance.map(x=>x.booking_id));
    const services=new Map();
    for(const b of bookings) {
      const sold=b.payment_method==="PIX"&&paidIds.has(b.pix_order_id)||
        b.payment_method==="PAY_ON_DAY"&&cashIds.has(b.id);
      const viaVip=b.payment_method==="VIP"&&attendedIds.has(b.id);
      const unique=new Set(Array.isArray(b.service_names)?b.service_names.map(s=>String(s).trim()).filter(Boolean):[]);
      for(const name of unique) {
        const item=services.get(name)||{name,selected:0,sold:0,vipAttended:0,attended:0};
        item.selected++;
        if(sold)item.sold++;
        if(viaVip)item.vipAttended++;
        if(attendedIds.has(b.id))item.attended++;
        services.set(name,item);
      }
    }
    const catalogNames=new Map(catalog.map(x=>[x.id,x.name])), productCounts=new Map();
    for(const p of products) {
      const items=Array.isArray(p.details?.items)?p.details.items:[];
      for(const item of items) {
        const id=String(item.productId||""),qty=Number(item.quantity);
        if(!id||!Number.isInteger(qty)||qty<1||qty>100)continue;
        const old=productCounts.get(id)||{id,name:catalogNames.get(id)||"Produto "+id.slice(0,10),quantity:0};
        old.quantity+=qty;productCounts.set(id,old);
      }
    }
    const vip=new Map();
    for(const p of vipPaid) {
      const name=String(p.plan||"VIP"),old=vip.get(name)||{plan:name,paidSubscriptions:0,received:0};
      old.paidSubscriptions++;old.received+=Number(p.amount||0);vip.set(name,old);
    }
    res.json({from,to,services:[...services.values()].sort((a,b)=>b.selected-a.selected||b.sold-a.sold||a.name.localeCompare(b.name,"pt-BR")),
      products:[...productCounts.values()].sort((a,b)=>b.quantity-a.quantity),
      vipPlans:[...vip.values()].map(x=>({...x,received:Math.round(x.received*100)/100})),
      note:"Selecionado = agendamento confirmado/aguardando equipe; vendido = PIX real pago ou dinheiro recebido. Atendimento VIP nao e venda avulsa.",
      incomplete:bookings.length>=2000||orders.length>=2000||receipts.length>=2000||attendance.length>=2000||vipPaid.length>=2000||products.length>=2000});
  }catch(e){
    console.error("Finance service-stats:",String(e.message).slice(0,150));
    res.status(503).json({error:"Falha ao consultar os servicos do periodo."});
  }
});
