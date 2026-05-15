# Publicar o AdsFlow Online

O jeito mais simples para compartilhar com clientes e ter um link real e usar Render.

## Link que o cliente vai acessar

Depois do deploy, o Render gera um link parecido com:

```text
https://adsflow.onrender.com
```

Quando voce comprar um dominio, pode trocar para:

```text
https://app.adsflow.com.br
```

## Passo a passo no Render

1. Crie uma conta em https://render.com.
2. Suba este projeto para um repositorio GitHub.
3. No Render, escolha **New +** e depois **Blueprint**.
4. Conecte o repositorio que tem o arquivo `render.yaml`.
5. Preencha as variaveis marcadas como secret.
6. Clique em deploy.

## Variaveis obrigatorias para rodar online

Para um primeiro teste sem pagamentos e sem Meta real, configure apenas:

```text
APP_URL=https://seu-link.onrender.com
SQLITE_PATH=/var/data/adsflow.sqlite
```

Para IA real:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

Para conectar Instagram/Meta:

```text
META_APP_ID=...
META_APP_SECRET=...
META_REDIRECT_URI=https://seu-link.onrender.com/api/meta/oauth/callback
META_GRAPH_VERSION=v24.0
```

Para pagamento recorrente:

```text
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_ANNUAL_MONTHLY_197=price_...
STRIPE_PRICE_MONTHLY_297=price_...
```

## Importante

- O banco fica salvo em `/var/data/adsflow.sqlite`.
- No Render, esse disco persistente precisa estar ativo para nao perder usuarios.
- O cartao do cliente nao fica no AdsFlow; fica na Stripe.
- Para producao completa, ainda falta adicionar webhook da Stripe para liberar/bloquear acesso automaticamente.
