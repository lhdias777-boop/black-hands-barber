# Black Hands Barber Shop — V2

## O que mudou
- Cadastro/login de clientes com Supabase Auth.
- Cliente agenda apenas estando logado.
- Barbeiro + data carregam somente horários livres.
- Banco possui restrição única para impedir duas reservas do mesmo barbeiro no mesmo horário.
- Área "Meus agendamentos".
- `barber.html` com agenda individual.
- `admin.html` com clientes, barbeiros e agenda geral.
- `supabase.sql` cria tabelas, trigger de perfil e políticas RLS.
- `config.js` centraliza URL/chave pública do Supabase.

## Configuração
1. Crie um projeto no Supabase.
2. Abra SQL Editor e execute `supabase.sql`.
3. Em Authentication > Users, crie as contas dos barbeiros e administrador.
4. No banco, vincule os barbeiros em `public.barbers` e defina o perfil administrador como `role = 'admin'`.
5. Preencha `config.js` com a Project URL e a chave pública/anon do Supabase.
6. Publique novamente o site.

Nunca coloque a chave `service_role` no site.
