const runButton = document.getElementById("runButton");
const recentButton = document.getElementById("recentButton");
const settingsButton = document.getElementById("settingsButton");
const initialView = document.getElementById("initialView");
const changesView = document.getElementById("changesView");
const settingsView = document.getElementById("settingsView");
const backToInitialButton = document.getElementById("backToInitialButton");
const backFromSettingsButton = document.getElementById("backFromSettingsButton");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const clearSettingsButton = document.getElementById("clearSettingsButton");
const tokenNameInput = document.getElementById("tokenNameInput");
const tokenValueInput = document.getElementById("tokenValueInput");
const organizationInput = document.getElementById("organizationInput");
const projectSelect = document.getElementById("projectSelect");
const teamSelect = document.getElementById("teamSelect");
const settingsStatus = document.getElementById("settingsStatus");
const result = document.getElementById("result");
const sprintSelect = document.getElementById("sprintSelect");
const includeCurrentDayToggle = document.getElementById("includeCurrentDayToggle");
const recentList = document.getElementById("recentList");
const recentSection = document.getElementById("recentSection");
const detailSection = document.getElementById("detailSection");
const backArrowButton = document.getElementById("backArrowButton");
const detailOpenLinkButton = document.getElementById("detailOpenLinkButton");
const detailMeta = document.getElementById("detailMeta");
const detailDescription = document.getElementById("detailDescription");

let lastWindowScrollTop = 0;
let currentDetailItemUrl = "";
let hasCompleteSettings = false;

function showResult(text) {
	result.textContent = text;
	result.classList.remove("hidden");
}

function showSettingsStatus(text, isError = false) {
	settingsStatus.textContent = text;
	settingsStatus.classList.remove("hidden");
	settingsStatus.style.borderLeftColor = isError ? "#d13438" : "#107c10";
}

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

function populateSelect(selectElement, options, placeholder, selectedValue = "") {
	selectElement.innerHTML = "";

	const placeholderOption = document.createElement("option");
	placeholderOption.value = "";
	placeholderOption.textContent = placeholder;
	selectElement.appendChild(placeholderOption);

	for (const optionData of options) {
		const option = document.createElement("option");
		option.value = optionData.value;
		option.textContent = optionData.label;
		selectElement.appendChild(option);
	}

	selectElement.value = selectedValue || "";
}

function updateClearButtonVisibility(hasAnySavedData) {
	clearSettingsButton.classList.toggle("hidden", !hasAnySavedData);
}

function isCompleteSettings(settings) {
	return Boolean(
		settings.tokenValue &&
			settings.organization &&
			settings.projectId &&
			settings.projectName &&
			settings.teamId &&
			settings.teamName,
	);
}

function applySettingsToInputs(settings) {
	tokenNameInput.value = settings.tokenName || "";
	tokenValueInput.value = settings.tokenValue || "";
	organizationInput.value = settings.organization || "";
	hasCompleteSettings = isCompleteSettings(settings);
	updateClearButtonVisibility(
		Boolean(
			settings.tokenName ||
				settings.tokenValue ||
				settings.organization ||
				settings.projectId ||
				settings.teamId,
		),
	);
}

function normalizeType(type) {
	const value = String(type || "").toLowerCase();
	if (value === "bug") return "bug";
	if (value === "task") return "task";
	return "other";
}

function getStateColor(state) {
	const value = String(state || "").trim().toLowerCase();
	if (value === "pause") return "var(--state-pause)";
	if (value === "in progress" || value === "doing") return "var(--state-inprogress)";
	if (value === "to refactor" || value === "approved" || value === "to do") return "var(--state-neutral)";
	if (value === "to test") return "var(--state-test)";
	if (value === "to release") return "var(--state-release)";
	if (value === "to review") return "var(--state-review)";
	if (value === "done") return "var(--state-done)";
	return "#d0d0d4";
}

function formatNumber(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) {
		return "0";
	}

	if (Number.isInteger(numeric)) {
		return String(numeric);
	}

	return numeric.toFixed(4).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function createTagChip(text) {
	const chip = document.createElement("span");
	chip.className = "tag-chip";
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

	card.appendChild(header);
	card.appendChild(estimateStateRow);
	card.appendChild(completedSprintRow);

	if (item.tags?.length) {
		const tagRow = document.createElement("div");
		tagRow.className = "item-tags";
		item.tags.forEach((tag) => tagRow.appendChild(createTagChip(tag)));
		card.appendChild(tagRow);
	}

	return card;
}

function openItemInAzure(url) {
	if (!url) {
		return;
	}

	if (chrome?.tabs?.create) {
		chrome.tabs.create({ url });
		return;
	}

	window.open(url, "_blank", "noopener,noreferrer");
}

function populateSprintSelect(sprints, defaultSprint) {
	populateSelect(sprintSelect, sprints || [], "Selecione uma sprint", defaultSprint || "");
}

async function loadSavedSettings() {
	const response = await sendRuntimeMessage({ action: "getSettings" });
	if (!response?.ok) {
		throw new Error(response?.error || "Falha ao carregar configuracoes.");
	}

	return response;
}

async function loadProjects(selectedProjectId = "", selectedTeamId = "") {
	const organization = organizationInput.value.trim();
	const tokenValue = tokenValueInput.value.trim();

	if (!organization || !tokenValue) {
		populateSelect(projectSelect, [], "Selecione um projeto", "");
		populateSelect(teamSelect, [], "Selecione um time", "");
		return;
	}

	const response = await sendRuntimeMessage({
		action: "listProjects",
		organization,
		tokenValue,
	});

	if (!response?.ok) {
		throw new Error(response?.error || "Falha ao carregar projetos.");
	}

	organizationInput.value = response.organization || organization;
	populateSelect(projectSelect, response.projects || [], "Selecione um projeto", selectedProjectId);

	if (selectedProjectId) {
		await loadTeams(selectedProjectId, selectedTeamId);
	} else {
		populateSelect(teamSelect, [], "Selecione um time", "");
	}
}

async function loadTeams(projectId = projectSelect.value, selectedTeamId = "") {
	const organization = organizationInput.value.trim();
	const tokenValue = tokenValueInput.value.trim();

	if (!organization || !tokenValue || !projectId) {
		populateSelect(teamSelect, [], "Selecione um time", "");
		return;
	}

	const response = await sendRuntimeMessage({
		action: "listTeams",
		organization,
		projectId,
		tokenValue,
	});

	if (!response?.ok) {
		throw new Error(response?.error || "Falha ao carregar times.");
	}

	populateSelect(teamSelect, response.teams || [], "Selecione um time", selectedTeamId);
}

async function saveSettings() {
	const tokenName = tokenNameInput.value.trim();
	const tokenValue = tokenValueInput.value.trim();
	const organization = organizationInput.value.trim();
	const projectId = projectSelect.value;
	const teamId = teamSelect.value;
	const projectName = projectSelect.options[projectSelect.selectedIndex]?.text || "";
	const teamName = teamSelect.options[teamSelect.selectedIndex]?.text || "";

	const response = await sendRuntimeMessage({
		action: "saveSettings",
		settings: {
			tokenName,
			tokenValue,
			organization,
			projectId,
			projectName,
			teamId,
			teamName,
		},
	});

	if (!response?.ok) {
		throw new Error(response?.error || "Falha ao salvar configuracoes.");
	}
}

async function clearAllUserData() {
	const response = await sendRuntimeMessage({ action: "clearUserData" });
	if (!response?.ok) {
		throw new Error(response?.error || "Falha ao limpar dados.");
	}
}

function showDetail(item) {
	lastWindowScrollTop =
		window.scrollY ||
		(document.scrollingElement ? document.scrollingElement.scrollTop : 0) ||
		document.documentElement.scrollTop ||
		document.body.scrollTop ||
		0;

	detailMeta.innerHTML = "";
	const card = buildItemCard(item, { clickable: false });
	card.classList.add("detail-card");
	detailMeta.appendChild(card);

	detailDescription.innerHTML = item.description || "<em>Sem descricao.</em>";
	currentDetailItemUrl = item.itemUrl || "";
	detailOpenLinkButton.classList.toggle("hidden", !currentDetailItemUrl);
	recentSection.classList.add("hidden");
	detailSection.classList.remove("hidden");

	requestAnimationFrame(() => {
		window.scrollTo(0, 0);
		if (document.scrollingElement) {
			document.scrollingElement.scrollTop = 0;
		}
		document.documentElement.scrollTop = 0;
		document.body.scrollTop = 0;
		detailSection.scrollTop = 0;
	});
}

function showList() {
	detailSection.classList.add("hidden");
	recentSection.classList.remove("hidden");
	requestAnimationFrame(() => {
		window.scrollTo(0, lastWindowScrollTop);
		if (document.scrollingElement) {
			document.scrollingElement.scrollTop = lastWindowScrollTop;
		}
		document.documentElement.scrollTop = lastWindowScrollTop;
		document.body.scrollTop = lastWindowScrollTop;
	});
}

function showChangesView() {
	initialView.classList.add("hidden");
	settingsView.classList.add("hidden");
	changesView.classList.remove("hidden");
}

function showSettingsView() {
	initialView.classList.add("hidden");
	changesView.classList.add("hidden");
	settingsView.classList.remove("hidden");
}

function showInitialView() {
	if (!hasCompleteSettings) {
		showSettingsView();
		showSettingsStatus("Salve PAT, organizacao, projeto e time para acessar a tela inicial.", true);
		return;
	}

	settingsView.classList.add("hidden");
	changesView.classList.add("hidden");
	detailSection.classList.add("hidden");
	recentSection.classList.add("hidden");
	initialView.classList.remove("hidden");
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

async function loadSprints() {
	const response = await sendRuntimeMessage({ action: "listSprints" });
	if (!response?.ok) {
		throw new Error(response?.error || "Falha ao carregar sprints.");
	}

	populateSprintSelect(response.sprints || [], response.defaultSprint || "");
}

function formatMetrics(metrics) {
	return [
		`Sprint: ${metrics.selectedSprintLabel || "-"}`,
		`Tarefas iniciadas: ${metrics.startedTasks}`,
		`Soma de horas: ${Number(metrics.sumHours).toFixed(4)}`,
		`Dias considerados: ${metrics.completedDays}`,
		`Media diaria: ${Number(metrics.dailyAverage).toFixed(4)}`,
	].join("\n");
}

async function loadRecentChanges() {
	recentButton.disabled = true;
	showChangesView();
	detailSection.classList.add("hidden");
	recentSection.classList.remove("hidden");
	recentList.textContent = "Carregando itens alterados...";

	try {
		const response = await sendRuntimeMessage({ action: "listRecentChanges" });
		if (!response?.ok) {
			recentList.textContent = response?.error || "Erro ao buscar itens.";
			return;
		}

		renderRecentList(response.items || []);
	} catch (error) {
		recentList.textContent = `Erro: ${error instanceof Error ? error.message : "Falha inesperada."}`;
	} finally {
		recentButton.disabled = false;
	}
}

async function initializeSettingsView(savedSettings) {
	applySettingsToInputs(savedSettings);
	populateSelect(projectSelect, [], "Selecione um projeto", "");
	populateSelect(teamSelect, [], "Selecione um time", "");

	if (savedSettings.organization && savedSettings.tokenValue) {
		await loadProjects(savedSettings.projectId || "", savedSettings.teamId || "");
	}
}

async function init() {
	runButton.disabled = true;

	try {
		const savedSettings = await loadSavedSettings();
		await initializeSettingsView(savedSettings);

		if (!isCompleteSettings(savedSettings)) {
			hasCompleteSettings = false;
			showSettingsView();
			showSettingsStatus("Configure PAT, organizacao, projeto e time para comecar.");
			return;
		}

		hasCompleteSettings = true;
		await loadSprints();
	} catch (error) {
		showResult(`Erro: ${error instanceof Error ? error.message : "Falha ao carregar a extensao."}`);
	} finally {
		runButton.disabled = false;
	}
}

organizationInput.addEventListener("change", async () => {
	settingsStatus.classList.add("hidden");
	try {
		await loadProjects();
	} catch (error) {
		showSettingsStatus(`Erro: ${error instanceof Error ? error.message : "Falha ao carregar projetos."}`, true);
	}
});

tokenValueInput.addEventListener("change", async () => {
	settingsStatus.classList.add("hidden");
	try {
		await loadProjects();
	} catch (error) {
		showSettingsStatus(`Erro: ${error instanceof Error ? error.message : "Falha ao carregar projetos."}`, true);
	}
});

projectSelect.addEventListener("change", async () => {
	settingsStatus.classList.add("hidden");
	try {
		await loadTeams();
	} catch (error) {
		showSettingsStatus(`Erro: ${error instanceof Error ? error.message : "Falha ao carregar times."}`, true);
	}
});

runButton.addEventListener("click", () => {
	runButton.disabled = true;
	showResult("Consultando API do Azure DevOps...");

	chrome.runtime.sendMessage(
		{
			action: "openAzureAndCollect",
			sprintId: sprintSelect.value,
			includeCurrentDay: includeCurrentDayToggle.checked,
		},
		(response) => {
			runButton.disabled = false;

			const runtimeError = chrome.runtime.lastError;
			if (runtimeError) {
				showResult(`Erro: ${runtimeError.message}`);
				return;
			}

			if (!response?.ok) {
				showResult(`Erro: ${response?.error || "Falha inesperada."}`);
				return;
			}

			showResult(formatMetrics(response.metrics));
		},
	);
});

recentButton.addEventListener("click", () => {
	loadRecentChanges();
});

settingsButton.addEventListener("click", async () => {
	settingsStatus.classList.add("hidden");
	showSettingsView();

	try {
		const savedSettings = await loadSavedSettings();
		await initializeSettingsView(savedSettings);
	} catch (error) {
		showSettingsStatus(`Erro: ${error instanceof Error ? error.message : "Falha ao carregar configuracoes."}`, true);
	}
});

backToInitialButton.addEventListener("click", () => {
	showInitialView();
});

backFromSettingsButton.addEventListener("click", () => {
	showInitialView();
});

backArrowButton.addEventListener("click", () => {
	showList();
});

detailOpenLinkButton.addEventListener("click", () => {
	openItemInAzure(currentDetailItemUrl);
});

saveSettingsButton.addEventListener("click", async () => {
	const tokenName = tokenNameInput.value.trim();
	const tokenValue = tokenValueInput.value.trim();
	const organization = organizationInput.value.trim();
	const projectId = projectSelect.value;
	const teamId = teamSelect.value;

	if (!tokenName || !tokenValue || !organization || !projectId || !teamId) {
		showSettingsStatus("Preencha token, organizacao, projeto e time para salvar.", true);
		return;
	}

	saveSettingsButton.disabled = true;
	showSettingsStatus("Salvando configuracoes...");

	try {
		await saveSettings();
		hasCompleteSettings = true;
		updateClearButtonVisibility(true);
		await loadSprints();
		showInitialView();
	} catch (error) {
		showSettingsStatus(`Erro: ${error instanceof Error ? error.message : "Falha ao salvar configuracoes."}`, true);
	} finally {
		saveSettingsButton.disabled = false;
	}
});

clearSettingsButton.addEventListener("click", async () => {
	clearSettingsButton.disabled = true;
	showSettingsStatus("Limpando dados...");

	try {
		await clearAllUserData();
		window.location.reload();
	} catch (error) {
		showSettingsStatus(`Erro: ${error instanceof Error ? error.message : "Falha ao limpar dados."}`, true);
	} finally {
		clearSettingsButton.disabled = false;
	}
});

init();
