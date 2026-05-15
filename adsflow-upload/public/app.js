const form = document.querySelector("#adForm");
const generateBtn = document.querySelector("#generateBtn");
const toast = document.querySelector("#toast");
const ideas = document.querySelector("#ideas");
const drafts = document.querySelector("#drafts");
const draftCount = document.querySelector("#draftCount");
const metaStatus = document.querySelector("#metaStatus");
const connectMeta = document.querySelector("#connectMeta");
const loginForm = document.querySelector("#loginForm");
const loginBtn = document.querySelector("#loginBtn");
const clientForm = document.querySelector("#clientForm");
const clientList = document.querySelector(".client-list");
const onboardingForm = document.querySelector("#onboardingForm");
const connectInstagramBtn = document.querySelector("#connectInstagramBtn");
const importInstagramBtn = document.querySelector("#importInstagramBtn");
const demoInstagramBtn = document.querySelector("#demoInstagramBtn");
const simpleCampaignBtn = document.querySelector("#simpleCampaignBtn");
const instagramSummary = document.querySelector("#instagramSummary");

const state = {
  user: null,
  clients: [],
  selectedClientId: null,
  instagramProfile: null,
  subscription: null,
  drafts: [],
  creative: {
    headline: "Titulo do anuncio",
    primaryText: "Preencha os dados e gere um texto com IA para visualizar o anuncio.",
    description: "Descricao curta"
  }
};

const params = new URLSearchParams(window.location.search);
if (params.get("meta") === "connected") {
  showToast("Conta Meta conectada com sucesso.");
}
if (params.get("meta") === "error") {
  showToast(`Falha na conexao Meta: ${params.get("message") || "erro desconhecido"}`);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3200);
}

function formData() {
  return Object.fromEntries(new FormData(form).entries());
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[char]);
}

function renderCreative() {
  document.querySelector("#headline").textContent = state.creative.headline;
  document.querySelector("#primaryText").textContent = state.creative.primaryText;
  document.querySelector("#description").textContent = state.creative.description;
}

function renderIdeas(result) {
  const items = [
    ...(result.variants || []).map((item) => `Texto: ${item}`),
    ...(result.audiences || []).map((item) => `Publico: ${item}`)
  ];
  ideas.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderDrafts() {
  draftCount.textContent = String(state.drafts.length);
  if (!state.drafts.length) {
    drafts.innerHTML = '<tr><td colspan="4">Nenhum rascunho ainda.</td></tr>';
    return;
  }

  drafts.innerHTML = state.drafts
    .map(
      (draft) => `
        <tr>
          <td>${escapeHtml(draft.name)}</td>
          <td>${escapeHtml(draft.objective)}</td>
          <td>${money(draft.dailyBudget)}</td>
          <td>${escapeHtml(draft.status)}</td>
        </tr>
      `
    )
    .join("");
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Falha na requisicao");
  }

  return response.json();
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Falha na requisicao");
  }
  return response.json();
}

function updateAuthUi() {
  if (state.user) {
    loginBtn.textContent = state.user.name || "Logado";
    return;
  }
  loginBtn.textContent = "Entrar";
}

function renderClients() {
  if (!state.clients.length) {
    clientList.innerHTML = `
      <button class="client-row active" type="button">
        <span>
          <strong>Nenhum cliente cadastrado</strong>
          <small>Cadastre o primeiro cliente abaixo</small>
        </span>
        <em>Setup</em>
      </button>
    `;
    return;
  }

  if (!state.selectedClientId) {
    state.selectedClientId = state.clients[0].id;
  }

  clientList.innerHTML = state.clients
    .map(
      (client) => `
        <button class="client-row ${client.id === state.selectedClientId ? "active" : ""}" type="button" data-client-id="${client.id}">
          <span>
            <strong>${escapeHtml(client.name)}</strong>
            <small>${escapeHtml(client.ad_account_id || "Conta Meta pendente")}</small>
          </span>
          <em>${client.meta_connected ? "Meta ok" : client.status}</em>
        </button>
      `
    )
    .join("");

  clientList.querySelectorAll(".client-row").forEach((button) => {
    button.addEventListener("click", async () => {
      state.selectedClientId = button.dataset.clientId;
      renderClients();
      await loadInstagramProfile();
      showToast(`${button.querySelector("strong").textContent} selecionado.`);
    });
  });
}

function renderInstagramProfile() {
  if (!state.instagramProfile) {
    instagramSummary.innerHTML = `
      <strong>Nenhum Instagram importado</strong>
      <span>Conecte a Meta ou use o demo para testar o fluxo simples.</span>
    `;
    return;
  }

  const profile = state.instagramProfile;
  instagramSummary.innerHTML = `
    <strong>@${escapeHtml(profile.username || "instagram")}</strong>
    <span>${escapeHtml(profile.biography || profile.name || "Perfil pronto para campanha")} · ${Number(profile.followers_count || 0).toLocaleString("pt-BR")} seguidores</span>
  `;
}

function selectedClientOrToast() {
  if (!state.user) {
    showToast("Faca login antes de usar o modo simples.");
    return null;
  }
  if (!state.selectedClientId) {
    showToast("Cadastre e selecione um cliente primeiro.");
    return null;
  }
  return state.selectedClientId;
}

async function loadClients() {
  if (!state.user) {
    state.clients = [];
    renderClients();
    return;
  }
  const result = await getJson("/api/clients");
  state.clients = result.clients || [];
  renderClients();
  await loadInstagramProfile();
}

async function loadInstagramProfile() {
  if (!state.user || !state.selectedClientId) {
    state.instagramProfile = null;
    renderInstagramProfile();
    return;
  }
  const result = await getJson(`/api/instagram/profile?clientId=${encodeURIComponent(state.selectedClientId)}`);
  state.instagramProfile = result.profile;
  renderInstagramProfile();
}

async function loadSession() {
  const result = await getJson("/api/auth/me");
  state.user = result.user;
  state.subscription = result.subscription;
  updateAuthUi();
  hydrateOnboarding();
  await loadClients();
}

function hydrateOnboarding() {
  if (!state.user || !onboardingForm) return;
  if (state.user.niche) onboardingForm.elements.niche.value = state.user.niche;
  if (state.user.businessGoal) onboardingForm.elements.businessGoal.value = state.user.businessGoal;
  if (state.user.experienceLevel) onboardingForm.elements.experienceLevel.value = state.user.experienceLevel;
}

generateBtn.addEventListener("click", async () => {
  const payload = formData();
  if (!payload.product || !payload.audience) {
    showToast("Preencha produto e publico para gerar com IA.");
    return;
  }

  generateBtn.disabled = true;
  generateBtn.textContent = "Gerando...";

  try {
    const result = await postJson("/api/generate-ad", payload);
    state.creative = {
      headline: result.headline,
      primaryText: result.primaryText,
      description: result.description
    };
    renderCreative();
    renderIdeas(result);
    showToast(result.source === "openai" ? "Criativo gerado pela OpenAI." : "Criativo local gerado para preview.");
  } catch (error) {
    showToast(error.message);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Gerar com IA";
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    ...formData(),
    ...state.creative,
    clientId: state.selectedClientId
  };

  try {
    const result = await postJson("/api/meta/draft", payload);
    state.drafts.unshift({
      name: payload.name,
      objective: payload.objective,
      dailyBudget: payload.dailyBudget,
      status: result.mode === "preview" ? "Preview pausado" : "Meta pausado"
    });
    metaStatus.textContent = result.mode === "preview" ? "Preview" : "Configurado";
    renderDrafts();
    showToast(result.message);
  } catch (error) {
    showToast(error.message);
  }
});

connectMeta.addEventListener("click", () => {
  startMetaConnection();
});

function startMetaConnection() {
  if (!state.user) {
    showToast("Faca login antes de conectar a Meta.");
    return;
  }
  if (!state.selectedClientId) {
    showToast("Cadastre e selecione um cliente primeiro.");
    return;
  }

  getJson(`/api/meta/oauth/url?clientId=${encodeURIComponent(state.selectedClientId)}`)
    .then((result) => {
      if (!result.configured) {
        showToast(result.message);
        return;
      }
      window.location.href = result.url;
    })
    .catch((error) => showToast(error.message));
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(loginForm).entries());

  try {
    let result;
    try {
      result = await postJson("/api/auth/login", payload);
    } catch (error) {
      if (!error.message.includes("Login invalido")) throw error;
      result = await postJson("/api/auth/register", {
        ...payload,
        name: payload.email.split("@")[0]
      });
    }

    state.user = result.user;
    updateAuthUi();
    hydrateOnboarding();
    await loadClients();
    showToast(`Bem-vindo ao AdsFlow, ${state.user.email}.`);
  } catch (error) {
    showToast(error.message);
  }
});

loginBtn.addEventListener("click", () => {
  loginForm.scrollIntoView({ behavior: "smooth", block: "center" });
});

document.querySelectorAll("[data-jump]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(button.dataset.jump).scrollIntoView({ behavior: "smooth" });
  });
});

document.querySelectorAll(".plan button").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!state.user) {
      showToast("Faca login antes de escolher um plano.");
      return;
    }

    try {
      const result = await postJson("/api/billing/checkout", { planKey: button.dataset.planKey });
      if (result.configured && result.url) {
        window.location.href = result.url;
        return;
      }
      state.subscription = result.subscription;
      showToast(result.message);
    } catch (error) {
      showToast(error.message);
    }
  });
});

clientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user) {
    showToast("Faca login antes de cadastrar clientes.");
    return;
  }

  try {
    const payload = Object.fromEntries(new FormData(clientForm).entries());
    const result = await postJson("/api/clients", payload);
    state.clients.unshift(result.client);
    state.selectedClientId = result.client.id;
    clientForm.reset();
    renderClients();
    await loadInstagramProfile();
    showToast("Cliente cadastrado no banco de dados.");
  } catch (error) {
    showToast(error.message);
  }
});

onboardingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user) {
    showToast("Faca login para salvar seu nicho.");
    return;
  }

  try {
    const payload = Object.fromEntries(new FormData(onboardingForm).entries());
    const result = await postJson("/api/onboarding", payload);
    state.user = result.user;

    const nicheLabel = onboardingForm.elements.niche.options[onboardingForm.elements.niche.selectedIndex].text;
    if (form.elements.product && !form.elements.product.value) {
      form.elements.product.value = nicheLabel;
      form.elements.audience.value = `pessoas interessadas em ${nicheLabel.toLowerCase()} na sua regiao`;
    }

    showToast("Nicho salvo. O AdsFlow simplificou o painel para esse tipo de negocio.");
  } catch (error) {
    showToast(error.message);
  }
});

connectInstagramBtn.addEventListener("click", () => {
  startMetaConnection();
});

importInstagramBtn.addEventListener("click", async () => {
  const clientId = selectedClientOrToast();
  if (!clientId) return;

  try {
    const result = await postJson("/api/instagram/import", { clientId });
    if (!result.connected) {
      showToast(result.message);
      return;
    }
    state.instagramProfile = result.profile;
    renderInstagramProfile();
    showToast("Instagram importado. A IA ja pode montar a campanha.");
  } catch (error) {
    showToast(error.message);
  }
});

demoInstagramBtn.addEventListener("click", async () => {
  const clientId = selectedClientOrToast();
  if (!clientId) return;

  try {
    const result = await postJson("/api/instagram/mock", {
      clientId,
      username: "adsflow.store",
      name: "AdsFlow Store",
      biography: "Loja online com ofertas semanais, atendimento rapido e entrega para todo o Brasil.",
      followersCount: 3840,
      mediaCount: 96,
      website: "https://example.com"
    });
    state.instagramProfile = result.profile;
    renderInstagramProfile();
    showToast("Perfil demo importado para testar o modo simples.");
  } catch (error) {
    showToast(error.message);
  }
});

simpleCampaignBtn.addEventListener("click", async () => {
  const clientId = selectedClientOrToast();
  if (!clientId) return;

  try {
    const result = await postJson("/api/instagram/simple-campaign", { clientId });
    const campaign = result.campaign;
    const creative = result.creative;
    form.elements.name.value = campaign.name;
    form.elements.product.value = campaign.product;
    form.elements.audience.value = campaign.audience;
    form.elements.objective.value = campaign.objective;
    form.elements.dailyBudget.value = campaign.dailyBudget;
    form.elements.tone.value = campaign.tone;
    form.elements.location.value = campaign.location;
    form.elements.age.value = campaign.age;
    form.elements.placement.value = campaign.placement;
    form.elements.url.value = campaign.url || "";

    state.creative = {
      headline: creative.headline,
      primaryText: creative.primaryText,
      description: creative.description
    };
    renderCreative();
    renderIdeas(creative);
    document.querySelector("#builder").scrollIntoView({ behavior: "smooth" });
    showToast("Campanha simples criada pela IA a partir do Instagram.");
  } catch (error) {
    showToast(error.message);
  }
});

renderCreative();
renderDrafts();
loadSession().catch((error) => showToast(error.message));
