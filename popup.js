const runButton = document.getElementById("runButton");
const result = document.getElementById("result");
const daysInput = document.getElementById("days");
const sprintSelect = document.getElementById("sprintSelect");

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
    option.value = sprint;
    option.textContent = sprint;
    sprintSelect.appendChild(option);
  }

  if (defaultSprint) {
    sprintSelect.value = defaultSprint;
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
    `Sprint: ${metrics.selectedSprint || "Todas as sprints"}`,
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

init();
