# Black Hands — Render + Asaas Sandbox

Versão preparada para deploy pelo navegador/celular usando Render Blueprint + Render Postgres.

## O que já está configurado
- Node.js + Express + TypeScript
- Prisma + PostgreSQL
- Asaas Sandbox via `access_token`
- API de serviços, barbeiros, clientes e agendamentos
- Cobrança Pix/cartão
- QR Code Pix quando disponível
- Assinaturas mensais
- Webhook `/api/webhooks/asaas` com validação de `asaas-access-token` e idempotência
- Painel administrativo inicial
- Health check `/api/health`
- Frontend Black Hands com banners e mascote

## Deploy pelo celular
1. Suba esta pasta para um repositório GitHub.
2. No Render, escolha **New → Blueprint** e conecte o repositório.
3. O Render lê `render.yaml` e cria o Web Service e o Postgres.
4. Na criação, preencha os valores secretos pedidos:
   - `ASAAS_API_KEY`: sua chave do **Sandbox**.
   - `ASAAS_WEBHOOK_TOKEN`: gere um token forte com pelo menos 32 caracteres. Não use a API Key.
   - `PUBLIC_BASE_URL`: deixe para depois do primeiro deploy e informe a URL pública do serviço, por exemplo `https://black-hands.onrender.com`.
5. Faça o deploy.
6. Depois do deploy, teste `https://SEU-DOMINIO/api/health`.

## Webhook Asaas
Depois que o Render fornecer a URL pública, crie no Sandbox do Asaas um webhook apontando para:

`https://SEU-DOMINIO/api/webhooks/asaas`

Use exatamente o mesmo valor colocado em `ASAAS_WEBHOOK_TOKEN` como Auth Token. O Asaas envia esse token no header `asaas-access-token`.

Para o primeiro teste, habilite os eventos de pagamento necessários, especialmente eventos de pagamento recebido/confirmado, vencido, estornado e cancelado. Para assinaturas, habilite os eventos relacionados às cobranças da assinatura.

## Segurança
- Nunca coloque a API Key no HTML, JavaScript público ou GitHub.
- Nunca use a API Key como Auth Token do Webhook.
- Use Sandbox até validar todo o fluxo.
- Para produção, troque `ASAAS_BASE_URL` para `https://api.asaas.com/v3` e use uma chave de Produção criada no Asaas.

## Observação sobre Render Free
O plano gratuito é adequado para testes/homologação, mas não é recomendado para uma barbearia em produção. Faça upgrade quando o sistema estiver validado.
