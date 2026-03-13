const runButton = document.getElementById("runButton");
const recentButton = document.getElementById("recentButton");
const result = document.getElementById("result");
const daysInput = document.getElementById("days");
const sprintSelect = document.getElementById("sprintSelect");
const recentList = document.getElementById("recentList");
const recentSection = document.getElementById("recentSection");
const detailSection = document.getElementById("detailSection");
const backArrowButton = document.getElementById("backArrowButton");
const detailMeta = document.getElementById("detailMeta");
const detailDescription = document.getElementById("detailDescription");

let lastRecentScrollTop = 0;

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(response);
    });
  });
}

function populateSprintSelect(sprints, defaultSprint) {
  sprintSelect.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "Todas as sprints";
  sprintSelect.appendChild(allOption);

  for (const sprint of sprints) {
    const option = document.createElement("option");
    option.value = sprint.value;
    option.textContent = sprint.label;
    sprintSelect.appendChild(option);
  }

  if (defaultSprint) {
    sprintSelect.value = defaultSprint;
  }
}

function decodeHtmlToText(html) {
  if (!html) {
    return "Sem descricao.";
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(String(html), "text/html");
  const text = (doc.body.textContent || "").replace(/\s+\n/g, "\n").trim();
  return text || "Sem descricao.";
}

function normalizeType(type) {
  const value = String(type || "").toLowerCase();
  if (value === "bug") {
    return "bug";
  }
  if (value === "task") {
    return "task";
  }
  return "other";
}

function getStateColor(state) {
  const value = String(state || "").trim().toLowerCase();

  if (value === "pause") {
    return "var(--state-pause)";
  }
  if (value === "in progress" || value === "doing") {
    return "var(--state-inprogress)";
  }
  if (value === "to refactor" || value === "approved" || value === "to do") {
    return "var(--state-neutral)";
  }
  if (value === "to test") {
    return "var(--state-test)";
  }
  if (value === "to release") {
    return "var(--state-release)";
  }
  if (value === "to review") {
    return "var(--state-review)";
  }
  if (value === "done") {
    return "var(--state-done)";
  }

  return "#d0d0d4";
}

function formatNumber(value) {
  if (!Number.isFinite(Number(value))) {
    return "0";
  }

  const normalized = Number(value);
  if (Number.isInteger(normalized)) {
    return String(normalized);
  }

  return normalized.toFixed(4).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function createTagChip(text, isEmpty = false) {
  const chip = document.createElement("span");
  chip.className = isEmpty ? "tag-chip empty" : "tag-chip";
  chip.textContent = text;
  return chip;
}

function buildItemCard(item, { clickable = true } = {}) {
  const typeClass = `type-${normalizeType(item.type)}`;

  const card = document.createElement(clickable ? "button" : "div");
  if (clickable) {
    card.type = "button";
  }
  card.className = `recent-item ${typeClass}`;

  const header = document.createElement("div");
  header.className = "recent-item-header";

  const chip = document.createElement("span");
  chip.className = "item-id-chip";
  chip.textContent = String(item.id || "-");

  const title = document.createElement("div");
  title.className = "recent-item-title";
  title.textContent = item.title || "Sem titulo";

  header.appendChild(chip);
  header.appendChild(title);

  const estimateStateRow = document.createElement("div");
  estimateStateRow.className = "recent-item-row";
  const estimated = document.createElement("span");
  estimated.textContent = `Estimated: ${formatNumber(item.estimated)}`;

  const state = document.createElement("span");
  state.className = "item-state";
  state.textContent = item.state || "-";
  state.style.color = getStateColor(item.state);

  estimateStateRow.appendChild(estimated);
  estimateStateRow.appendChild(state);

  const completedSprintRow = document.createElement("div");
  completedSprintRow.className = "recent-item-row";
  const completed = document.createElement("span");
  completed.textContent = `Completed: ${formatNumber(item.completed)}`;

  const sprint = document.createElement("span");
  sprint.className = "item-sprint";
  sprint.textContent = item.sprint || "Sem sprint";

  completedSprintRow.appendChild(completed);
  completedSprintRow.appendChild(sprint);

  let tagRow = null;

  if (item.tags?.length) {
    tagRow = document.createElement("div");
    tagRow.className = "item-tags";
    item.tags.forEach((tag) => tagRow.appendChild(createTagChip(tag)));
  }

  card.appendChild(header);
  card.appendChild(estimateStateRow);
  card.appendChild(completedSprintRow);
  if (tagRow) {
    card.appendChild(tagRow);
  }

  return card;
}

function showDetail(item) {
  lastRecentScrollTop = recentList.scrollTop;

  detailMeta.innerHTML = "";
  const card = buildItemCard(item, { clickable: false });
  card.classList.add("detail-card");
  detailMeta.appendChild(card);

  detailDescription.textContent = decodeHtmlToText(item.description);
  recentSection.classList.add("hidden");
  detailSection.classList.remove("hidden");
}

function showList() {
  detailSection.classList.add("hidden");
  recentSection.classList.remove("hidden");
  requestAnimationFrame(() => {
    recentList.scrollTop = lastRecentScrollTop;
  });
}

function renderRecentList(items) {
  if (!items.length) {
    recentList.textContent = "Nenhum item alterado encontrado no periodo.";
    detailSection.classList.add("hidden");
    recentSection.classList.remove("hidden");
    return;
  }

  recentList.innerHTML = "";

  for (const item of items) {
    const card = buildItemCard(item);
    card.addEventListener("click", () => showDetail(item));
    recentList.appendChild(card);
  }

  detailSection.classList.add("hidden");
  recentSection.classList.remove("hidden");
}

async function loadRecentChanges() {
  recentButton.disabled = true;
  detailSection.classList.add("hidden");
  recentSection.classList.remove("hidden");
  recentList.textContent = "Carregando itens alterados...";

  try {
    const response = await sendRuntimeMessage({ action: "listRecentChanges" });
    if (!response?.ok) {
      throw new Error(response?.error || "Falha ao buscar itens alterados.");
    }

    renderRecentList(response.items || []);
  } catch (error) {
    recentList.textContent = `Erro: ${error instanceof Error ? error.message : "Falha ao buscar itens alterados."}`;
  } finally {
    recentButton.disabled = false;
  }
}

async function loadSprints() {
  const response = await sendRuntimeMessage({ action: "listSprints" });
  if (!response?.ok) {
    throw new Error(response?.error || "Falha ao carregar sprints.");
  }

  populateSprintSelect(response.sprints || [], response.defaultSprint || "");
}

function formatMetrics(metrics) {
  return [
    `Sprint: ${metrics.selectedSprintLabel || "Todas as sprints"}`,
    `Tarefas iniciadas: ${metrics.startedTasks}`,
    `Soma de horas: ${Number(metrics.sumHours).toFixed(4)}`,
    `Dias concluidos: ${metrics.completedDays}`,
    `Media diaria: ${Number(metrics.dailyAverage).toFixed(4)}`,
  ].join("\n");
}

async function init() {
  runButton.disabled = true;
  result.textContent = "Carregando sprints da API...";

  try {
    await loadSprints();
    result.textContent = "Selecione a sprint e clique para calcular.";
  } catch (error) {
    result.textContent = `Erro: ${error instanceof Error ? error.message : "Falha ao carregar sprints."}`;
  } finally {
    runButton.disabled = false;
  }
}

runButton.addEventListener("click", () => {
  runButton.disabled = true;
  result.textContent = "Consultando API do Azure DevOps...";

  const days = Number(daysInput.value) > 0 ? Number(daysInput.value) : 15;
  const sprint = sprintSelect.value;

  chrome.runtime.sendMessage({ action: "openAzureAndCollect", days, sprint }, (response) => {
    runButton.disabled = false;

    const runtimeError = chrome.runtime.lastError;
    if (runtimeError) {
      result.textContent = `Erro: ${runtimeError.message}`;
      return;
    }

    if (!response?.ok) {
      result.textContent = `Erro: ${response?.error || "Falha inesperada."}`;
      return;
    }

    result.textContent = formatMetrics(response.metrics);
  });
});

recentButton.addEventListener("click", () => {
  loadRecentChanges();
});

backArrowButton.addEventListener("click", () => {
  showList();
});

init();
