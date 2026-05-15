import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  consumeOauthState,
  createClient,
  createSession,
  createUser,
  deleteSession,
  getClient,
  getInstagramProfile,
  getMetaConnection,
  getUserByEmail,
  getUserBySession,
  getSubscription,
  listClients,
  loginUser,
  publicUser,
  saveMetaConnection,
  saveInstagramProfile,
  saveOauthState,
  updateUserOnboarding,
  upsertSubscription
} from "./db.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 3000);
const graphVersion = process.env.META_GRAPH_VERSION || "v24.0";
const plans = {
  trial: {
    label: "Teste gratis",
    price: 0,
    interval: "7 dias",
    stripePriceEnv: null
  },
  monthly_297: {
    label: "Mensal",
    price: 297,
    interval: "mensal",
    stripePriceEnv: "STRIPE_PRICE_MONTHLY_297"
  },
  annual_monthly_197: {
    label: "Anual mensal",
    price: 197,
    interval: "mensal por 12 meses",
    stripePriceEnv: "STRIPE_PRICE_ANNUAL_MONTHLY_197"
  }
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function setSessionCookie(res, session) {
  res.setHeader(
    "set-cookie",
    `adsflow_session=${encodeURIComponent(session.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 14}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("set-cookie", "adsflow_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

function getAuthUser(req) {
  return getUserBySession(parseCookies(req).adsflow_session);
}

function requireUser(req, res) {
  const user = getAuthUser(req);
  if (!user) {
    json(res, 401, { error: "Faca login para continuar." });
    return null;
  }
  return user;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function generateLocalIdeas({ product, audience, goal, tone }) {
  const cleanProduct = product || "sua oferta";
  const cleanAudience = audience || "seu publico";
  const cleanGoal = goal || "gerar resultados";
  const cleanTone = tone || "direto";

  return {
    source: "local",
    headline: `${cleanProduct}: pronto para ${cleanGoal}`,
    primaryText:
      `Mostre ${cleanProduct} para ${cleanAudience} com uma mensagem ${cleanTone}. ` +
      "Teste esta variacao com criativo claro, promessa objetiva e chamada para acao simples.",
    description: "Campanha criada para validar demanda com baixo risco.",
    variants: [
      `Oferta direta para ${cleanAudience}`,
      `Novo teste de ${cleanProduct}`,
      `${cleanProduct} com chamada objetiva`
    ],
    audiences: [
      `${cleanAudience} por interesse e comportamento`,
      "Publico semelhante aos melhores clientes",
      "Remarketing de visitantes e engajados"
    ]
  };
}

async function createWithOpenAI(input) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return generateLocalIdeas(input);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "Voce cria textos curtos para anuncios Meta Ads em portugues brasileiro. Responda apenas JSON valido."
        },
        {
          role: "user",
          content:
            `Produto: ${input.product}\nPublico: ${input.audience}\nObjetivo: ${input.goal}\nTom: ${input.tone}\n` +
            "Retorne headline, primaryText, description, variants array com 3 opcoes e audiences array com 3 sugestoes."
        }
      ],
      text: { format: { type: "json_object" } }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const text = data.output_text || data.output?.[0]?.content?.[0]?.text;
  return { source: "openai", ...JSON.parse(text) };
}

async function createMetaDraft(payload) {
  const token = process.env.META_ACCESS_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;

  if (!token || !accountId) {
    return {
      mode: "preview",
      message:
        "Defina META_ACCESS_TOKEN e META_AD_ACCOUNT_ID para enviar para a Meta. O rascunho local foi gerado.",
      campaign: {
        name: payload.name,
        objective: payload.objective,
        status: "PAUSED"
      },
      adSet: {
        dailyBudget: payload.dailyBudget,
        location: payload.location,
        age: payload.age
      },
      ad: {
        headline: payload.headline,
        primaryText: payload.primaryText,
        url: payload.url,
        placement: payload.placement
      }
    };
  }

  return {
    mode: "configured",
    message:
      "Credenciais Meta encontradas. Conecte aqui as chamadas de Campaign, AdSet, AdCreative e Ad pela Marketing API.",
    account: accountId,
    status: "PAUSED"
  };
}

function buildMetaRedirectUri(req) {
  return process.env.META_REDIRECT_URI || `http://${req.headers.host}/api/meta/oauth/callback`;
}

function buildMetaOauthUrl(req, user, clientId) {
  const appId = process.env.META_APP_ID;
  if (!appId) {
    return {
      configured: false,
      message: "Defina META_APP_ID e META_APP_SECRET para ativar o OAuth da Meta."
    };
  }

  const state = saveOauthState(user.id, clientId);
  const authUrl = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", buildMetaRedirectUri(req));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set(
    "scope",
    "public_profile,pages_show_list,pages_read_engagement,instagram_basic,instagram_manage_insights,ads_read,ads_management"
  );

  return {
    configured: true,
    url: authUrl.toString(),
    redirectUri: buildMetaRedirectUri(req),
    scopes: [
      "public_profile",
      "pages_show_list",
      "pages_read_engagement",
      "instagram_basic",
      "instagram_manage_insights",
      "ads_read",
      "ads_management"
    ]
  };
}

async function exchangeMetaCode(req, code) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("Configure META_APP_ID e META_APP_SECRET antes de concluir o OAuth.");
  }

  const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", buildMetaRedirectUri(req));
  tokenUrl.searchParams.set("code", code);

  const response = await fetch(tokenUrl);
  if (!response.ok) {
    throw new Error(`Meta OAuth falhou: ${await response.text()}`);
  }

  return response.json();
}

function buildOrigin(req) {
  return process.env.APP_URL || `http://${req.headers.host}`;
}

function encodeForm(data) {
  const params = new URLSearchParams();
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) params.append(key, value);
  });
  return params;
}

async function createStripeCheckout(req, user, planKey) {
  const plan = plans[planKey];
  if (!plan) {
    return { configured: false, message: "Plano invalido." };
  }

  if (planKey === "trial") {
    const trialEndsAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    return {
      configured: false,
      subscription: upsertSubscription(user.id, {
        planKey,
        status: "trialing",
        provider: "local",
        trialEndsAt
      }),
      message: "Teste gratis ativado por 7 dias."
    };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env[plan.stripePriceEnv];
  if (!secretKey || !priceId) {
    return {
      configured: false,
      message:
        "Configure STRIPE_SECRET_KEY e o Price ID do plano para ativar pagamento real. O plano ficou salvo em preview.",
      subscription: upsertSubscription(user.id, {
        planKey,
        status: "preview",
        provider: "stripe"
      })
    };
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: encodeForm({
      mode: "subscription",
      customer_email: user.email,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${buildOrigin(req)}/?billing=success`,
      cancel_url: `${buildOrigin(req)}/?billing=cancel`,
      "metadata[userId]": user.id,
      "metadata[planKey]": planKey,
      "subscription_data[metadata][userId]": user.id,
      "subscription_data[metadata][planKey]": planKey
    })
  });

  if (!response.ok) {
    throw new Error(`Stripe falhou: ${await response.text()}`);
  }

  const checkout = await response.json();
  upsertSubscription(user.id, {
    planKey,
    status: "checkout_started",
    provider: "stripe"
  });

  return {
    configured: true,
    url: checkout.url
  };
}

async function graphGet(path, accessToken, params = {}) {
  const url = new URL(`https://graph.facebook.com/${graphVersion}/${path.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Meta Graph falhou: ${await response.text()}`);
  }
  return response.json();
}

async function importInstagramFromMeta(userId, clientId) {
  const connection = getMetaConnection(userId, clientId);
  if (!connection) {
    return {
      connected: false,
      message: "Conecte a Meta primeiro para importar o Instagram."
    };
  }

  const pages = await graphGet("me/accounts", connection.access_token, {
    fields: "id,name,access_token,instagram_business_account{id,username,name,biography,followers_count,media_count,website,profile_picture_url}"
  });

  const page = (pages.data || []).find((item) => item.instagram_business_account);
  if (!page) {
    return {
      connected: false,
      message:
        "Nenhum Instagram profissional ligado a uma Pagina foi encontrado. Confira se o Instagram e Business/Criador e esta conectado a uma Pagina."
    };
  }

  const ig = page.instagram_business_account;
  const profile = saveInstagramProfile(userId, clientId, {
    pageId: page.id,
    pageName: page.name,
    instagramId: ig.id,
    username: ig.username,
    name: ig.name,
    biography: ig.biography,
    followersCount: ig.followers_count,
    mediaCount: ig.media_count,
    website: ig.website,
    profilePictureUrl: ig.profile_picture_url
  });

  return {
    connected: true,
    profile
  };
}

function buildSimpleCampaign(profile, body = {}) {
  const username = profile?.username ? `@${profile.username}` : "seu Instagram";
  const bio = profile?.biography || "negocio local";
  const followers = profile?.followers_count ? `${profile.followers_count} seguidores` : "publico atual";
  const website = profile?.website || body.url || "";

  return {
    name: `Impulsionamento simples - ${username}`,
    product: profile?.name || username,
    audience: `pessoas parecidas com seguidores de ${username} e interessadas em ${bio.slice(0, 80)}`,
    objective: body.objective || "OUTCOME_ENGAGEMENT",
    dailyBudget: body.dailyBudget || "30",
    tone: "direto",
    location: body.location || "Brasil",
    age: body.age || "18-54",
    placement: "Instagram",
    url: website,
    context: {
      username,
      biography: bio,
      followers,
      mediaCount: profile?.media_count || 0
    }
  };
}

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = getAuthUser(req);
    return json(res, 200, {
      user: publicUser(user),
      subscription: user ? getSubscription(user.id) : null
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readJson(req);
    if (!body.email || !body.password) {
      return json(res, 400, { error: "E-mail e senha sao obrigatorios." });
    }
    if (getUserByEmail(body.email)) {
      return json(res, 409, { error: "Este e-mail ja esta cadastrado." });
    }
    const user = createUser(body);
    const session = createSession(user.id);
    setSessionCookie(res, session);
    return json(res, 201, { user: publicUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(req);
    const user = loginUser(body.email || "", body.password || "");
    if (!user) {
      return json(res, 401, { error: "Login invalido." });
    }
    const session = createSession(user.id);
    setSessionCookie(res, session);
    return json(res, 200, { user: publicUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    deleteSession(parseCookies(req).adsflow_session);
    clearSessionCookie(res);
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/onboarding") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    return json(res, 200, { user: publicUser(updateUserOnboarding(user.id, body)) });
  }

  if (req.method === "GET" && url.pathname === "/api/billing/plans") {
    return json(res, 200, { plans });
  }

  if (req.method === "GET" && url.pathname === "/api/billing/subscription") {
    const user = requireUser(req, res);
    if (!user) return;
    return json(res, 200, { subscription: getSubscription(user.id) });
  }

  if (req.method === "POST" && url.pathname === "/api/billing/checkout") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    return json(res, 200, await createStripeCheckout(req, user, body.planKey));
  }

  if (req.method === "GET" && url.pathname === "/api/clients") {
    const user = requireUser(req, res);
    if (!user) return;
    return json(res, 200, { clients: listClients(user.id) });
  }

  if (req.method === "POST" && url.pathname === "/api/clients") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (!body.name) {
      return json(res, 400, { error: "Nome do cliente e obrigatorio." });
    }
    return json(res, 201, { client: createClient(user.id, body) });
  }

  if (req.method === "GET" && url.pathname === "/api/meta/oauth/url") {
    const user = requireUser(req, res);
    if (!user) return;
    const clientId = url.searchParams.get("clientId");
    if (!clientId || !getClient(user.id, clientId)) {
      return json(res, 404, { error: "Cliente nao encontrado." });
    }
    return json(res, 200, buildMetaOauthUrl(req, user, clientId));
  }

  if (req.method === "GET" && url.pathname === "/api/instagram/profile") {
    const user = requireUser(req, res);
    if (!user) return;
    const clientId = url.searchParams.get("clientId");
    if (!clientId || !getClient(user.id, clientId)) {
      return json(res, 404, { error: "Cliente nao encontrado." });
    }
    return json(res, 200, { profile: getInstagramProfile(user.id, clientId) });
  }

  if (req.method === "POST" && url.pathname === "/api/instagram/import") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (!body.clientId || !getClient(user.id, body.clientId)) {
      return json(res, 404, { error: "Cliente nao encontrado." });
    }
    return json(res, 200, await importInstagramFromMeta(user.id, body.clientId));
  }

  if (req.method === "POST" && url.pathname === "/api/instagram/mock") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (!body.clientId || !getClient(user.id, body.clientId)) {
      return json(res, 404, { error: "Cliente nao encontrado." });
    }
    const profile = saveInstagramProfile(user.id, body.clientId, {
      pageName: body.pageName || "Pagina Demo",
      instagramId: body.instagramId || "demo_ig",
      username: body.username || "adsflow.demo",
      name: body.name || "Negocio Demo",
      biography: body.biography || "Perfil importado para teste do modo simples.",
      followersCount: body.followersCount || 1200,
      mediaCount: body.mediaCount || 42,
      website: body.website || ""
    });
    return json(res, 201, { profile });
  }

  if (req.method === "POST" && url.pathname === "/api/instagram/simple-campaign") {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (!body.clientId || !getClient(user.id, body.clientId)) {
      return json(res, 404, { error: "Cliente nao encontrado." });
    }
    const profile = getInstagramProfile(user.id, body.clientId);
    if (!profile) {
      return json(res, 404, { error: "Importe o Instagram antes de usar o modo simples." });
    }
    const campaign = buildSimpleCampaign(profile, body);
    const creative = await createWithOpenAI({
      product: campaign.product,
      audience: campaign.audience,
      goal: "patrocinar o Instagram e gerar visitas qualificadas",
      tone: campaign.tone
    });
    return json(res, 200, { campaign, creative });
  }

  if (req.method === "GET" && url.pathname === "/api/meta/oauth/callback") {
    if (url.searchParams.get("error")) {
      return redirect(
        res,
        `/?meta=error&message=${encodeURIComponent(url.searchParams.get("error_description") || "Acesso negado")}`
      );
    }
    const stateRow = consumeOauthState(url.searchParams.get("state"));
    if (!stateRow) {
      return redirect(res, "/?meta=error&message=state_invalido");
    }
    const token = await exchangeMetaCode(req, url.searchParams.get("code"));
    saveMetaConnection({
      userId: stateRow.user_id,
      clientId: stateRow.client_id,
      accessToken: token.access_token,
      tokenType: token.token_type,
      expiresIn: token.expires_in,
      scopes: token.scope
    });
    return redirect(res, "/?meta=connected");
  }

  if (req.method === "POST" && url.pathname === "/api/generate-ad") {
    const body = await readJson(req);
    return json(res, 200, await createWithOpenAI(body));
  }

  if (req.method === "POST" && url.pathname === "/api/meta/draft") {
    const body = await readJson(req);
    return json(res, 200, await createMetaDraft(body));
  }

  if (url.pathname.startsWith("/api/")) {
    return json(res, 404, { error: "Endpoint nao encontrado." });
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const apiResult = await routeApi(req, res, url);
    if (apiResult !== null || url.pathname.startsWith("/api/")) return;

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(publicDir, safePath);
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": mime[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return json(res, 404, { error: "Not found" });
    }
    return json(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`AdsFlow running at http://localhost:${port}`);
});
