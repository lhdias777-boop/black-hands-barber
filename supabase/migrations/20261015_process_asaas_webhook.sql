-- Black Hands: recepcao idempotente de eventos PIX VERIFICADOS pela API Asaas.
-- O Worker compara o asaas-access-token e consulta a API antes de chamar esta RPC.
create or replace function public.bh_process_verified_asaas_event(
  p_event_id text,
  p_event_type text,
  p_payment_id text,
  p_payment_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.bh_pix_orders%rowtype;
  v_inserted integer;
  v_booking_status text;
begin
  if p_event_id is null or length(p_event_id) < 5 or length(p_event_id) > 200
     or p_payment_id is null or length(p_payment_id) < 5 or length(p_payment_id) > 200
     or p_event_type not in ('PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED')
     or p_payment_amount is null or p_payment_amount <= 0 then
    raise exception 'invalid_verified_asaas_event';
  end if;
  select * into v_order from public.bh_pix_orders
    where asaas_payment_id = p_payment_id
      and payment_environment = 'production'
    for update;
  if not found then
    return jsonb_build_object('ok', true, 'result', 'unmatched');
  end if;
  if v_order.amount <> p_payment_amount then
    raise exception 'asaas_payment_amount_mismatch';
  end if;

  insert into public.asaas_webhook_events(event_id,event_type,payment_id)
    values (p_event_id,p_event_type,p_payment_id)
    on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    return jsonb_build_object('ok', true, 'result', 'duplicate');
  end if;
  if v_order.status = 'REFUNDED' then
    return jsonb_build_object('ok', true, 'result', 'already_refunded');
  end if;

  update public.bh_pix_orders
    set status = 'PAID', paid_at = coalesce(paid_at, now())
    where id = v_order.id;
  if v_order.kind = 'booking' then
    select public.bh_confirm_booking_pix(v_order.id) into v_booking_status;
  end if;

  return jsonb_build_object(
    'ok', true, 'result', 'processed',
    'kind', v_order.kind, 'bookingStatus', v_booking_status
  );
end;
$function$;
revoke all on function public.bh_process_verified_asaas_event(text,text,text,numeric) from public;
revoke all on function public.bh_process_verified_asaas_event(text,text,text,numeric) from anon;
revoke all on function public.bh_process_verified_asaas_event(text,text,text,numeric) from authenticated;
grant execute on function public.bh_process_verified_asaas_event(text,text,text,numeric) to service_role;
