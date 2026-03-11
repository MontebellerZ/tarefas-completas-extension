const runButton = document.getElementById("runButton");
const result = document.getElementById("result");
const daysInput = document.getElementById("days");

function formatMetrics(metrics) {
  return [
    `Tarefas iniciadas: ${metrics.startedTasks}`,
    `Soma de horas: ${Number(metrics.sumHours).toFixed(4)}`,
    `Dias concluidos: ${metrics.completedDays}`,
    `Media diaria: ${Number(metrics.dailyAverage).toFixed(4)}`,
  ].join("\n");
}

runButton.addEventListener("click", () => {
  runButton.disabled = true;
  result.textContent = "Consultando API do Azure DevOps...";

  const days = Number(daysInput.value);

  chrome.runtime.sendMessage({ action: "openAzureAndCollect", days }, (response) => {
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
