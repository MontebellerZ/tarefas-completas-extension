const runButton = document.getElementById("runButton");
const recentButton = document.getElementById("recentButton");
const result = document.getElementById("result");
const daysInput = document.getElementById("days");
const sprintSelect = document.getElementById("sprintSelect");
const recentList = document.getElementById("recentList");
const detailSection = document.getElementById("detailSection");
const detailMeta = document.getElementById("detailMeta");
const detailDescription = document.getElementById("detailDescription");

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

function formatListMeta(item) {
  const tags = item.tags?.length ? item.tags.join(", ") : "Sem tags";
  return [
    `Tipo: ${item.type || "-"}`,
    `Estimated: ${Number(item.estimated || 0).toFixed(4)}`,
    `Completed: ${Number(item.completed || 0).toFixed(4)}`,
    `State: ${item.state || "-"}`,
    `Tags: ${tags}`,
    `Sprint: ${item.sprint || "Sem sprint"}`,
  ].join(" | ");
}

function showDetail(item) {
  const tags = item.tags?.length ? item.tags.join(", ") : "Sem tags";
  detailMeta.textContent = [
    `#${item.id}`,
    item.title || "Sem titulo",
    `Tipo: ${item.type || "-"}`,
    `State: ${item.state || "-"}`,
    `Estimated: ${Number(item.estimated || 0).toFixed(4)}`,
    `Completed: ${Number(item.completed || 0).toFixed(4)}`,
    `Tags: ${tags}`,
    `Sprint: ${item.sprint || "Sem sprint"}`,
  ].join("\n");

  detailDescription.textContent = decodeHtmlToText(item.description);
  detailSection.classList.remove("hidden");
}

function renderRecentList(items) {
  if (!items.length) {
    recentList.textContent = "Nenhum item alterado encontrado no periodo.";
    detailSection.classList.add("hidden");
    return;
  }

  recentList.innerHTML = "";

  for (const item of items) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "recent-item";

    const title = document.createElement("div");
    title.className = "recent-item-title";
    title.textContent = `#${item.id} - ${item.title || "Sem titulo"}`;

    const meta = document.createElement("div");
    meta.className = "recent-item-meta";
    meta.textContent = formatListMeta(item);

    card.appendChild(title);
    card.appendChild(meta);
    card.addEventListener("click", () => showDetail(item));
    recentList.appendChild(card);
  }
}

async function loadRecentChanges() {
  recentButton.disabled = true;
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

init();
