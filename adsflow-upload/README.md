# AdsFlow

MVP SaaS para criar anuncios Facebook/Instagram com IA e preparar publicacao pela Meta Marketing API.

O produto foi estruturado para ser vendido como uma plataforma simples para pequenos negocios, gestores de trafego e agencias.

## Rodar localmente

```powershell
npm start
```

Se o `npm` nao estiver no PATH, rode direto:

```powershell
node server.js
```

Abra:

```text
http://localhost:3000
```

## IA

Sem chave, o app gera ideias locais para preview. Para usar OpenAI:

```powershell
$env:OPENAI_API_KEY="sua-chave"
$env:OPENAI_MODEL="gpt-4.1-mini"
npm start
```

## Meta

Para enviar rascunhos reais para a Meta, configure:

```powershell
$env:META_ACCESS_TOKEN="token-da-meta"
$env:META_AD_ACCOUNT_ID="act_000000000"
npm start
```

Para conectar clientes pelo OAuth oficial da Meta, configure tambem:

```powershell
$env:META_APP_ID="id-do-app-meta"
$env:META_APP_SECRET="segredo-do-app-meta"
$env:META_REDIRECT_URI="http://localhost:3000/api/meta/oauth/callback"
$env:META_GRAPH_VERSION="v24.0"
node server.js
```

No painel da Meta, coloque exatamente a mesma URL em **Valid OAuth Redirect URIs**.

O MVP deixa tudo como `PAUSED` por seguranca. A integracao real deve criar, nessa ordem:

1. Campaign
2. Ad Set
3. Ad Creative
4. Ad

Permissoes comuns no App Review da Meta:

- `ads_read`
- `ads_management`
- `business_management`, quando for gerenciar ativos do Business Manager

## Planos sugeridos

- Teste gratis: 7 dias.
- Anual mensal: R$ 197/mes, com compromisso anual e cobranca mensal.
- Mensal livre: R$ 297/mes, sem compromisso anual.

## Pagamentos com cartao

O AdsFlow nao deve guardar dados de cartao no banco. Use Stripe ou Mercado Pago para checkout e assinatura recorrente.

Para Stripe, crie dois produtos recorrentes no painel:

- `STRIPE_PRICE_ANNUAL_MONTHLY_197`: preco recorrente mensal de R$ 197.
- `STRIPE_PRICE_MONTHLY_297`: preco recorrente mensal de R$ 297.

Depois configure:

```powershell
$env:APP_URL="http://localhost:3000"
$env:STRIPE_SECRET_KEY="sk_test_..."
$env:STRIPE_PRICE_ANNUAL_MONTHLY_197="price_..."
$env:STRIPE_PRICE_MONTHLY_297="price_..."
node server.js
```

Para producao, adicione webhook da Stripe para atualizar `subscriptions.status` quando o pagamento for aprovado, cancelado ou falhar.

Importante: no plano anual mensal, deixe claro nos termos que existe compromisso anual, mas a cobranca no cartao ocorre mensalmente em R$ 197.

## Proximas etapas

- Criptografar tokens Meta salvos no banco antes de usar em producao.
- Upload de imagem/video.
- Criacao real de Campaign, AdSet, AdCreative e Ad.
- Pagamentos recorrentes.
- Politica de privacidade e termos de uso.
- Regras automaticas para pausar, duplicar ou alertar campanhas.

Antes de vender a publicacao real, publique politica de privacidade, termos de uso e deixe claro que o cliente aprova conteudo, orcamento e destino do anuncio.
