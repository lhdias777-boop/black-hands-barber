# Black Hands — Asaas PIX real / Cloudflare Workers

Status: receptor implementado nesta branch e RPC aplicada ao Supabase conectado.
NAO PUBLICADO NO CLOUDFLARE. O Worker atual pode ser diferente do repositorio antigo de 12/10. Nao o substitua pela versao antiga.

## Integracao no Worker atual

O arquivo cloudflare/asaas-webhook.mjs exporta handleAsaasWebhook(request, env).
Importe esta funcao no bundle ATUAL do Worker e roteie:
POST /api/asaas/webhook -> handleAsaasWebhook(request, env)

Configurar no Cloudflare:
- Secrets: ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN, SUPABASE_SERVICE_ROLE_KEY
- Variaveis: SUPABASE_URL, ASAAS_API_BASE=https://api.asaas.com/v3, BH_PAYMENTS_MODE=production
- Manter BH_REAL_PIX_ENABLED=false ate testes finais.

No Asaas de producao, o token do Webhook deve coincidir com o Secret do Worker.
Usar https://barbeariablackhands.lhdias777.workers.dev/api/asaas/webhook apenas apos o endpoint funcionar.
Ativar eventos PAYMENT_CONFIRMED e PAYMENT_RECEIVED.

## Seguranca e limites

- Confere autenticacao por asaas-access-token.
- Consulta o pagamento diretamente na API de producao do Asaas antes de atualizar o banco.
- A RPC aceita somente ID e valor corretos de pedidos do ambiente production.
- Duplicacoes sao ignoradas pelo event_id unico.
- Agendamentos usam bh_confirm_booking_pix para nao criar horario duplicado.
- Pagamentos sem pedido correspondente sao ignorados.
- Confirmacao automatica de assinatura VIP ainda nao coberta.
- Uma reserva ja cancelada e paga tardiamente exige revisao.
- O fluxo de bloquear horarios ANTES da cobranca precisa ser testado na versao Cloudflare atual.

O teste em cloudflare/asaas-webhook.test.mjs usa mocks, nao cobra dinheiro.
Execute: node --test cloudflare/asaas-webhook.test.mjs