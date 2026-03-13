function openItemInAzure(url) {
	if (!url) return;
	if (chrome?.tabs?.create) {
		chrome.tabs.create({ url });
		return;
	}
	window.open(url, "_blank", "noopener,noreferrer");
}

function showDetail(item) {
	PopupState.lastWindowScrollTop =
		window.scrollY ||
		(document.scrollingElement ? document.scrollingElement.scrollTop : 0) ||
		document.documentElement.scrollTop ||
		document.body.scrollTop ||
		0;

	PopupDom.detailMeta.innerHTML = "";
	const card = PopupRender.buildItemCard(item, { clickable: false });
	card.classList.add("detail-card");
	PopupDom.detailMeta.appendChild(card);

	PopupDom.detailDescription.innerHTML = item.description || "<em>Sem descricao.</em>";
	PopupState.currentDetailItemUrl = item.itemUrl || "";
	PopupDom.detailOpenLinkButton.classList.toggle("hidden", !PopupState.currentDetailItemUrl);
	PopupDom.recentSection.classList.add("hidden");
	PopupDom.detailSection.classList.remove("hidden");

	requestAnimationFrame(() => {
		window.scrollTo(0, 0);
		if (document.scrollingElement) {
			document.scrollingElement.scrollTop = 0;
		}
		document.documentElement.scrollTop = 0;
		document.body.scrollTop = 0;
		PopupDom.detailSection.scrollTop = 0;
	});
}

function showList() {
	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.remove("hidden");
	requestAnimationFrame(() => {
		window.scrollTo(0, PopupState.lastWindowScrollTop);
		if (document.scrollingElement) {
			document.scrollingElement.scrollTop = PopupState.lastWindowScrollTop;
		}
		document.documentElement.scrollTop = PopupState.lastWindowScrollTop;
		document.body.scrollTop = PopupState.lastWindowScrollTop;
	});
}

function showChangesView() {
	PopupDom.initialView.classList.add("hidden");
	PopupDom.settingsView.classList.add("hidden");
	PopupDom.changesView.classList.remove("hidden");
}

function showSettingsView() {
	PopupDom.initialView.classList.add("hidden");
	PopupDom.changesView.classList.add("hidden");
	PopupDom.settingsView.classList.remove("hidden");
}

function showInitialView() {
	if (!PopupState.hasCompleteSettings) {
		showSettingsView();
		PopupRender.showSettingsStatus("Salve PAT, organizacao, projeto e time para acessar a tela inicial.", true);
		return;
	}

	PopupDom.settingsView.classList.add("hidden");
	PopupDom.changesView.classList.add("hidden");
	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.add("hidden");
	PopupDom.initialView.classList.remove("hidden");
}

function renderRecentList(items) {
	if (!items.length) {
		PopupDom.recentList.textContent = "Nenhum item alterado encontrado no periodo.";
		PopupDom.detailSection.classList.add("hidden");
		PopupDom.recentSection.classList.remove("hidden");
		return;
	}

	PopupDom.recentList.innerHTML = "";
	for (const item of items) {
		const card = PopupRender.buildItemCard(item);
		card.addEventListener("click", () => showDetail(item));
		PopupDom.recentList.appendChild(card);
	}

	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.remove("hidden");
}

async function loadSavedSettings() {
	const response = await PopupApi.getSettings();
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar configuracoes.");
	return response;
}

async function loadProjects(selectedProjectId = "", selectedTeamId = "", selectedUserId = "") {
	const organization = PopupDom.organizationInput.value.trim();
	const tokenValue = PopupDom.tokenValueInput.value.trim();

	if (!organization || !tokenValue) {
		PopupRender.populateSelect(PopupDom.projectSelect, [], "Selecione um projeto", "");
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", "");
		PopupState.availableUsers = [];
		return;
	}

	const response = await PopupApi.listProjects(organization, tokenValue);
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar projetos.");

	PopupDom.organizationInput.value = response.organization || organization;
	PopupRender.populateSelect(PopupDom.projectSelect, response.projects || [], "Selecione um projeto", selectedProjectId);

	if (selectedProjectId) {
		await loadTeams(selectedProjectId, selectedTeamId, selectedUserId);
	} else {
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", "");
		PopupState.availableUsers = [];
	}
}

async function loadTeams(projectId = PopupDom.projectSelect.value, selectedTeamId = "", selectedUserId = "") {
	const organization = PopupDom.organizationInput.value.trim();
	const tokenValue = PopupDom.tokenValueInput.value.trim();

	if (!organization || !tokenValue || !projectId) {
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", "");
		PopupState.availableUsers = [];
		return;
	}

	const response = await PopupApi.listTeams(organization, projectId, tokenValue);
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar times.");

	PopupRender.populateSelect(PopupDom.teamSelect, response.teams || [], "Selecione um time", selectedTeamId);

	if (selectedTeamId) {
		await loadUsers(projectId, selectedTeamId, selectedUserId);
	} else {
		PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", "");
		PopupState.availableUsers = [];
	}
}

async function loadUsers(projectId = PopupDom.projectSelect.value, teamId = PopupDom.teamSelect.value, selectedUserId = "") {
	const organization = PopupDom.organizationInput.value.trim();
	const tokenValue = PopupDom.tokenValueInput.value.trim();

	if (!organization || !tokenValue || !projectId || !teamId) {
		PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", "");
		PopupState.availableUsers = [];
		return;
	}

	const response = await PopupApi.listUsers(organization, projectId, teamId, tokenValue);
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar usuarios.");

	PopupState.availableUsers = response.users || [];
	PopupRender.populateSelect(PopupDom.userSelect, PopupState.availableUsers, "Eu mesmo", selectedUserId || "");
}

async function saveSettings() {
	const tokenName = PopupDom.tokenNameInput.value.trim();
	const tokenValue = PopupDom.tokenValueInput.value.trim();
	const organization = PopupDom.organizationInput.value.trim();
	const projectId = PopupDom.projectSelect.value;
	const teamId = PopupDom.teamSelect.value;
	const selectedUserId = PopupDom.userSelect.value;
	const projectName = PopupDom.projectSelect.options[PopupDom.projectSelect.selectedIndex]?.text || "";
	const teamName = PopupDom.teamSelect.options[PopupDom.teamSelect.selectedIndex]?.text || "";
	const selectedUser = PopupState.availableUsers.find((user) => String(user.value) === String(selectedUserId));

	const response = await PopupApi.saveSettings({
		tokenName,
		tokenValue,
		organization,
		projectId,
		projectName,
		teamId,
		teamName,
		selectedUserId: selectedUser?.id || selectedUserId || "",
		selectedUserName: selectedUser?.name || "",
		selectedUserUniqueName: selectedUser?.uniqueName || "",
		selectedUserDescriptor: selectedUser?.descriptor || "",
	});

	if (!response?.ok) throw new Error(response?.error || "Falha ao salvar configuracoes.");
}

async function clearAllUserData() {
	const response = await PopupApi.clearUserData();
	if (!response?.ok) throw new Error(response?.error || "Falha ao limpar dados.");
}

async function loadSprints() {
	const response = await PopupApi.listSprints();
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar sprints.");
	PopupRender.populateSprintSelect(response.sprints || [], response.defaultSprint || "");
}

async function loadRecentChanges() {
	PopupDom.recentButton.disabled = true;
	showChangesView();
	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.remove("hidden");
	PopupDom.recentList.textContent = "Carregando itens alterados...";

	try {
		const response = await PopupApi.listRecentChanges();
		if (!response?.ok) {
			PopupDom.recentList.textContent = response?.error || "Erro ao buscar itens.";
			return;
		}
		renderRecentList(response.items || []);
	} catch (error) {
		PopupDom.recentList.textContent = `Erro: ${error instanceof Error ? error.message : "Falha inesperada."}`;
	} finally {
		PopupDom.recentButton.disabled = false;
	}
}

async function initializeSettingsView(savedSettings) {
	PopupRender.applySettingsToInputs(savedSettings);
	PopupRender.populateSelect(PopupDom.projectSelect, [], "Selecione um projeto", "");
	PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
	const selectedUserValue = savedSettings.selectedUserId || savedSettings.selectedUserDescriptor || savedSettings.selectedUserUniqueName || "";
	PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", selectedUserValue);
	PopupState.availableUsers = [];

	if (savedSettings.organization && savedSettings.tokenValue) {
		await loadProjects(savedSettings.projectId || "", savedSettings.teamId || "", selectedUserValue);
	}
}

async function runSettingsAction(action, fallbackMessage) {
	PopupDom.settingsStatus.classList.add("hidden");
	try {
		await action();
	} catch (error) {
		PopupRender.showSettingsStatus(`Erro: ${error instanceof Error ? error.message : fallbackMessage}`, true);
	}
}

function bindEvents() {
	PopupDom.organizationInput.addEventListener("change", async () => {
		await runSettingsAction(() => loadProjects(), "Falha ao carregar projetos.");
	});

	PopupDom.tokenValueInput.addEventListener("change", async () => {
		await runSettingsAction(() => loadProjects(), "Falha ao carregar projetos.");
	});

	PopupDom.projectSelect.addEventListener("change", async () => {
		await runSettingsAction(() => loadTeams(), "Falha ao carregar times.");
	});

	PopupDom.teamSelect.addEventListener("change", async () => {
		await runSettingsAction(() => loadUsers(), "Falha ao carregar usuarios.");
	});

	PopupDom.runButton.addEventListener("click", () => {
		PopupDom.runButton.disabled = true;
		PopupRender.showResult("Consultando API do Azure DevOps...");

		chrome.runtime.sendMessage(
			{
				action: "openAzureAndCollect",
				sprintId: PopupDom.sprintSelect.value,
				includeCurrentDay: PopupDom.includeCurrentDayToggle.checked,
			},
			(response) => {
				PopupDom.runButton.disabled = false;
				const runtimeError = chrome.runtime.lastError;
				if (runtimeError) {
					PopupRender.showResult(`Erro: ${runtimeError.message}`);
					return;
				}
				if (!response?.ok) {
					PopupRender.showResult(`Erro: ${response?.error || "Falha inesperada."}`);
					return;
				}
				PopupRender.showResult(PopupRender.formatMetrics(response.metrics));
			},
		);
	});

	PopupDom.recentButton.addEventListener("click", () => {
		loadRecentChanges();
	});

	PopupDom.settingsButton.addEventListener("click", async () => {
		showSettingsView();
		await runSettingsAction(async () => {
			const savedSettings = await loadSavedSettings();
			await initializeSettingsView(savedSettings);
		}, "Falha ao carregar configuracoes.");
	});

	PopupDom.backToInitialButton.addEventListener("click", () => {
		showInitialView();
	});

	PopupDom.backFromSettingsButton.addEventListener("click", () => {
		showInitialView();
	});

	PopupDom.backArrowButton.addEventListener("click", () => {
		showList();
	});

	PopupDom.detailOpenLinkButton.addEventListener("click", () => {
		openItemInAzure(PopupState.currentDetailItemUrl);
	});

	PopupDom.saveSettingsButton.addEventListener("click", async () => {
		const tokenName = PopupDom.tokenNameInput.value.trim();
		const tokenValue = PopupDom.tokenValueInput.value.trim();
		const organization = PopupDom.organizationInput.value.trim();
		const projectId = PopupDom.projectSelect.value;
		const teamId = PopupDom.teamSelect.value;

		if (!tokenName || !tokenValue || !organization || !projectId || !teamId) {
			PopupRender.showSettingsStatus("Preencha token, organizacao, projeto e time para salvar.", true);
			return;
		}

		PopupDom.saveSettingsButton.disabled = true;
		PopupRender.showSettingsStatus("Salvando configuracoes...");

		try {
			await saveSettings();
			PopupState.hasCompleteSettings = true;
			PopupRender.updateClearButtonVisibility(true);
			await loadSprints();
			showInitialView();
		} catch (error) {
			PopupRender.showSettingsStatus(`Erro: ${error instanceof Error ? error.message : "Falha ao salvar configuracoes."}`, true);
		} finally {
			PopupDom.saveSettingsButton.disabled = false;
		}
	});

	PopupDom.clearSettingsButton.addEventListener("click", async () => {
		PopupDom.clearSettingsButton.disabled = true;
		PopupRender.showSettingsStatus("Limpando dados...");

		try {
			await clearAllUserData();
			window.location.reload();
		} catch (error) {
			PopupRender.showSettingsStatus(`Erro: ${error instanceof Error ? error.message : "Falha ao limpar dados."}`, true);
		} finally {
			PopupDom.clearSettingsButton.disabled = false;
		}
	});
}

async function init() {
	PopupDom.runButton.disabled = true;
	try {
		const savedSettings = await loadSavedSettings();
		await initializeSettingsView(savedSettings);

		if (!PopupRender.isCompleteSettings(savedSettings)) {
			PopupState.hasCompleteSettings = false;
			showSettingsView();
			PopupRender.showSettingsStatus("Configure PAT, organizacao, projeto e time para comecar.");
			return;
		}

		PopupState.hasCompleteSettings = true;
		await loadSprints();
	} catch (error) {
		PopupRender.showResult(`Erro: ${error instanceof Error ? error.message : "Falha ao carregar a extensao."}`);
	} finally {
		PopupDom.runButton.disabled = false;
	}
}

window.PopupApp = {
	init,
};

bindEvents();
