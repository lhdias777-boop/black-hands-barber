-- BLACK HANDS: Atendido + PAY_ON_DAY = recebimento automatico (1 por agendamento)
-- Migration aplicada ao banco Supabase em 2026-10-16.
-- A alteracao do status na area do barbeiro deve criar/atualizar
-- public.bh_booking_attendance com status ATTENDED e recorded_by do barbeiro.
create or replace function public.bh_auto_cash_receipt_on_attended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_booking public.bh_booking_reservations%rowtype;
  v_amount numeric(10,2);
begin
  if new.status <> 'ATTENDED' then return new; end if;

  select * into v_booking
    from public.bh_booking_reservations
    where id = new.booking_id
    for update;
  if not found then raise exception 'booking_not_found'; end if;

  if v_booking.payment_method <> 'PAY_ON_DAY' then return new; end if;
  if v_booking.status not in ('AWAITING_STAFF','CONFIRMED') then
    raise exception 'cannot_collect_cancelled_or_unconfirmed_booking';
  end if;
  if v_booking.amount is null or v_booking.amount < 0 then
    raise exception 'booking_amount_invalid';
  end if;

  if not exists (
    select 1 from public.bh_barber_staff s
    where s.account_id = new.recorded_by
      and s.enabled = true
      and s.barber = v_booking.barber
  ) and not exists (
    select 1 from public.bh_admin_authorized a
    where a.account_id = new.recorded_by
  ) then
    raise exception 'staff_not_authorized_for_booking';
  end if;

  insert into public.bh_cash_receipts (booking_id, amount, collected_by)
  values (v_booking.id, v_booking.amount, new.recorded_by)
  on conflict (booking_id) do nothing;

  select r.amount into v_amount
    from public.bh_cash_receipts r where r.booking_id = new.booking_id;
  if v_amount is distinct from v_booking.amount then
    raise exception 'existing_receipt_amount_mismatch';
  end if;
  return new;
end;
$function$;

revoke all on function public.bh_auto_cash_receipt_on_attended() from public;
revoke all on function public.bh_auto_cash_receipt_on_attended() from anon;
revoke all on function public.bh_auto_cash_receipt_on_attended() from authenticated;
drop trigger if exists bh_auto_cash_receipt_on_attendance on public.bh_booking_attendance;
create trigger bh_auto_cash_receipt_on_attendance
after insert or update of status on public.bh_booking_attendance
for each row
when (new.status = 'ATTENDED')
execute function public.bh_auto_cash_receipt_on_attended();
