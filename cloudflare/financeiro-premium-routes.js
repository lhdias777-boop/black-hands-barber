
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
