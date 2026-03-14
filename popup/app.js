function openItemInAzure(url) {
	if (!url) return;
	if (chrome?.tabs?.create) {
		chrome.tabs.create({ url });
		return;
	}
	window.open(url, "_blank", "noopener,noreferrer");
}

function getSelectedToken() {
	return PopupState.availableTokens.find((token) => String(token.value) === String(PopupDom.tokenSelect.value || "")) || null;
}

function getSelectedTokenValue() {
	return String(getSelectedToken()?.tokenValue || "").trim();
}

function clearTokenForm() {
	PopupDom.tokenNameInput.value = "";
	PopupDom.tokenValueInput.value = "";
	PopupDom.tokenStatus.classList.add("hidden");
}

function showTokenSetupView(allowBack) {
	PopupDom.initialView.classList.add("hidden");
	PopupDom.settingsView.classList.add("hidden");
	PopupDom.changesView.classList.add("hidden");
	PopupDom.tokenSetupView.classList.remove("hidden");
	PopupDom.backFromTokenButton.classList.toggle("hidden", !allowBack);
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
	if (!PopupState.availableTokens.length) {
		showTokenSetupView(false);
		return;
	}

	PopupDom.initialView.classList.add("hidden");
	PopupDom.tokenSetupView.classList.add("hidden");
	PopupDom.settingsView.classList.add("hidden");
	PopupDom.changesView.classList.remove("hidden");
}

function showSettingsView() {
	if (!PopupState.availableTokens.length) {
		showTokenSetupView(false);
		return;
	}

	PopupDom.initialView.classList.add("hidden");
	PopupDom.tokenSetupView.classList.add("hidden");
	PopupDom.changesView.classList.add("hidden");
	PopupDom.settingsView.classList.remove("hidden");
}

function showInitialView() {
	if (!PopupState.availableTokens.length) {
		showTokenSetupView(false);
		PopupRender.showTokenStatus("Cadastre ao menos um token para continuar.", true);
		return;
	}

	if (!PopupState.hasCompleteSettings) {
		showSettingsView();
		PopupRender.showSettingsStatus("Salve token, organizacao, projeto e time para acessar a tela inicial.", true);
		return;
	}

	PopupDom.tokenSetupView.classList.add("hidden");
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

function updateTokenFormState() {
	const tokenName = PopupDom.tokenNameInput.value.trim();
	const tokenValue = PopupDom.tokenValueInput.value.trim();
	PopupDom.saveTokenButton.disabled = !(tokenName && tokenValue);
	PopupDom.backFromTokenButton.classList.toggle("hidden", !PopupState.availableTokens.length);
}

function updateSettingsFormState() {
	const tokenId = String(PopupDom.tokenSelect.value || "").trim();
	const organization = String(PopupDom.organizationSelect.value || "").trim();
	const projectId = String(PopupDom.projectSelect.value || "").trim();
	const teamId = String(PopupDom.teamSelect.value || "").trim();

	PopupDom.tokenSelect.disabled = !PopupState.availableTokens.length;
	PopupDom.deleteTokenButton.disabled = !tokenId;
	PopupDom.organizationSelect.disabled = !tokenId;
	PopupDom.projectSelect.disabled = !organization;
	PopupDom.teamSelect.disabled = !projectId;
	PopupDom.userSelect.disabled = !teamId;
	PopupDom.saveSettingsButton.disabled = !(tokenId && organization && projectId && teamId);
}

async function loadSavedSettings() {
	const response = await PopupApi.getSettings();
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar configuracoes.");
	return response;
}

async function loadTokens(selectedTokenId = "") {
	const response = await PopupApi.listTokens();
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar tokens.");
	PopupState.availableTokens = response.tokens || [];
	const preferred = selectedTokenId || response.selectedTokenId || PopupState.availableTokens[0]?.value || "";
	PopupRender.populateSelect(PopupDom.tokenSelect, PopupState.availableTokens, "Selecione um token", preferred);
	updateTokenFormState();
	updateSettingsFormState();
}

async function loadProjects(selectedProjectId = "", selectedTeamId = "", selectedUserId = "") {
	const organization = String(PopupDom.organizationSelect.value || "").trim();
	const tokenValue = getSelectedTokenValue();

	if (!organization || !tokenValue) {
		PopupRender.populateSelect(PopupDom.projectSelect, [], "Selecione um projeto", "");
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", "");
		PopupState.availableUsers = [];
		updateSettingsFormState();
		return;
	}

	const response = await PopupApi.listProjects(organization, tokenValue);
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar projetos.");

	PopupDom.organizationSelect.value = response.organization || organization;
	PopupRender.populateSelect(PopupDom.projectSelect, response.projects || [], "Selecione um projeto", selectedProjectId);

	if (selectedProjectId) {
		await loadTeams(selectedProjectId, selectedTeamId, selectedUserId);
	} else {
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", "");
		PopupState.availableUsers = [];
	}

	updateSettingsFormState();
}

async function loadOrganizations(selectedOrganization = "") {
	const tokenValue = getSelectedTokenValue();

	if (!tokenValue) {
		PopupRender.populateSelect(PopupDom.organizationSelect, [], "Selecione uma organizacao", "");
		PopupRender.populateSelect(PopupDom.projectSelect, [], "Selecione um projeto", "");
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", "");
		PopupState.availableUsers = [];
		updateSettingsFormState();
		return;
	}

	const response = await PopupApi.listOrganizations(tokenValue);
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar organizacoes.");

	const options = [...(response.organizations || [])];
	if (selectedOrganization && !options.some((entry) => String(entry.value) === String(selectedOrganization))) {
		options.unshift({ value: selectedOrganization, label: selectedOrganization, name: selectedOrganization });
	}
	const preferred = selectedOrganization || response.defaultOrganization || "";
	PopupRender.populateSelect(PopupDom.organizationSelect, options, "Selecione uma organizacao", preferred);
	updateSettingsFormState();
}

async function loadTeams(projectId = PopupDom.projectSelect.value, selectedTeamId = "", selectedUserId = "") {
	const organization = String(PopupDom.organizationSelect.value || "").trim();
	const tokenValue = getSelectedTokenValue();

	if (!organization || !tokenValue || !projectId) {
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", "");
		PopupState.availableUsers = [];
		updateSettingsFormState();
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

	updateSettingsFormState();
}

async function loadUsers(projectId = PopupDom.projectSelect.value, teamId = PopupDom.teamSelect.value, selectedUserId = "") {
	const organization = String(PopupDom.organizationSelect.value || "").trim();
	const tokenValue = getSelectedTokenValue();

	if (!organization || !tokenValue || !projectId || !teamId) {
		PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", "");
		PopupState.availableUsers = [];
		updateSettingsFormState();
		return;
	}

	const response = await PopupApi.listUsers(organization, projectId, teamId, tokenValue);
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar usuarios.");

	PopupState.availableUsers = response.users || [];
	PopupRender.populateSelect(PopupDom.userSelect, PopupState.availableUsers, "Eu mesmo", selectedUserId || "");
	updateSettingsFormState();
}

async function saveCurrentSettings() {
	const selectedToken = getSelectedToken();
	const organization = String(PopupDom.organizationSelect.value || "").trim();
	const projectId = PopupDom.projectSelect.value;
	const teamId = PopupDom.teamSelect.value;
	const selectedUserId = PopupDom.userSelect.value;
	const projectName = PopupDom.projectSelect.options[PopupDom.projectSelect.selectedIndex]?.text || "";
	const teamName = PopupDom.teamSelect.options[PopupDom.teamSelect.selectedIndex]?.text || "";
	const selectedUser = PopupState.availableUsers.find((user) => String(user.value) === String(selectedUserId));

	const response = await PopupApi.saveSettings({
		selectedTokenId: selectedToken?.id || selectedToken?.value || PopupDom.tokenSelect.value,
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

async function saveCurrentToken() {
	const response = await PopupApi.saveToken({
		name: PopupDom.tokenNameInput.value.trim(),
		value: PopupDom.tokenValueInput.value.trim(),
	});
	if (!response?.ok) throw new Error(response?.error || "Falha ao salvar token.");
	return response;
}

async function deleteCurrentToken() {
	const tokenId = String(PopupDom.tokenSelect.value || "").trim();
	if (!tokenId) return { hasTokens: PopupState.availableTokens.length > 0 };
	const response = await PopupApi.deleteToken(tokenId);
	if (!response?.ok) throw new Error(response?.error || "Falha ao excluir token.");
	return response;
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
	await loadTokens(savedSettings.selectedTokenId || "");
	PopupRender.populateSelect(PopupDom.organizationSelect, [], "Selecione uma organizacao", savedSettings.organization || "");
	PopupRender.populateSelect(PopupDom.projectSelect, [], "Selecione um projeto", "");
	PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
	const selectedUserValue = savedSettings.selectedUserId || savedSettings.selectedUserDescriptor || savedSettings.selectedUserUniqueName || "";
	PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", selectedUserValue);
	PopupState.availableUsers = [];

	if (PopupState.availableTokens.length && savedSettings.selectedTokenId) {
		await loadOrganizations(savedSettings.organization || "");
		if (savedSettings.organization) {
			await loadProjects(savedSettings.projectId || "", savedSettings.teamId || "", selectedUserValue);
		}
	}

	updateSettingsFormState();
}

async function runSettingsAction(action, fallbackMessage) {
	PopupDom.settingsStatus.classList.add("hidden");
	try {
		await action();
	} catch (error) {
		PopupRender.showSettingsStatus(`Erro: ${error instanceof Error ? error.message : fallbackMessage}`, true);
	}
}

async function runTokenAction(action, fallbackMessage) {
	PopupDom.tokenStatus.classList.add("hidden");
	try {
		await action();
	} catch (error) {
		PopupRender.showTokenStatus(`Erro: ${error instanceof Error ? error.message : fallbackMessage}`, true);
	}
}

function bindEvents() {
	PopupDom.tokenNameInput.addEventListener("input", () => {
		updateTokenFormState();
	});

	PopupDom.tokenValueInput.addEventListener("input", () => {
		updateTokenFormState();
	});

	PopupDom.backFromTokenButton.addEventListener("click", () => {
		if (!PopupState.availableTokens.length) {
			showTokenSetupView(false);
			return;
		}
		showSettingsView();
	});

	PopupDom.saveTokenButton.addEventListener("click", async () => {
		PopupDom.saveTokenButton.disabled = true;
		PopupRender.showTokenStatus("Salvando token...");
		await runTokenAction(async () => {
			const response = await saveCurrentToken();
			clearTokenForm();
			const savedSettings = await loadSavedSettings();
			await initializeSettingsView(savedSettings);
			showSettingsView();
			PopupRender.showSettingsStatus("Token salvo. Configure organizacao, projeto e time.");
			if (response?.tokenId) {
				PopupDom.tokenSelect.value = response.tokenId;
			}
		}, "Falha ao salvar token.");
		updateTokenFormState();
	});

	PopupDom.tokenSelect.addEventListener("change", async () => {
		updateSettingsFormState();
		await runSettingsAction(async () => {
			await loadOrganizations("");
			await loadProjects();
		}, "Falha ao carregar organizacoes/projetos.");
	});

	PopupDom.addTokenButton.addEventListener("click", () => {
		clearTokenForm();
		showTokenSetupView(PopupState.availableTokens.length > 0);
		updateTokenFormState();
	});

	PopupDom.deleteTokenButton.addEventListener("click", async () => {
		const selectedToken = getSelectedToken();
		if (!selectedToken) return;
		const confirmed = window.confirm(`Deseja realmente excluir o token \"${selectedToken.name}\"?`);
		if (!confirmed) return;

		PopupDom.deleteTokenButton.disabled = true;
		await runSettingsAction(async () => {
			const response = await deleteCurrentToken();
			if (!response.hasTokens) {
				PopupState.availableTokens = [];
				PopupState.hasCompleteSettings = false;
				clearTokenForm();
				showTokenSetupView(false);
				PopupRender.showTokenStatus("Cadastre um novo token para continuar.", true);
				updateTokenFormState();
				updateSettingsFormState();
				return;
			}

			const savedSettings = await loadSavedSettings();
			await initializeSettingsView(savedSettings);
			showSettingsView();
			PopupRender.showSettingsStatus("Token excluido.");
		}, "Falha ao excluir token.");
		updateSettingsFormState();
	});

	PopupDom.organizationSelect.addEventListener("change", async () => {
		updateSettingsFormState();
		await runSettingsAction(() => loadProjects(), "Falha ao carregar projetos.");
	});

	PopupDom.projectSelect.addEventListener("change", async () => {
		updateSettingsFormState();
		await runSettingsAction(() => loadTeams(), "Falha ao carregar times.");
	});

	PopupDom.teamSelect.addEventListener("change", async () => {
		updateSettingsFormState();
		await runSettingsAction(() => loadUsers(), "Falha ao carregar usuarios.");
	});

	PopupDom.userSelect.addEventListener("change", () => {
		updateSettingsFormState();
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
		if (!PopupState.availableTokens.length) {
			showTokenSetupView(false);
			return;
		}
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
		const tokenId = String(PopupDom.tokenSelect.value || "").trim();
		const organization = String(PopupDom.organizationSelect.value || "").trim();
		const projectId = PopupDom.projectSelect.value;
		const teamId = PopupDom.teamSelect.value;

		if (!tokenId || !organization || !projectId || !teamId) {
			PopupRender.showSettingsStatus("Preencha token, organizacao, projeto e time para salvar.", true);
			return;
		}

		PopupDom.saveSettingsButton.disabled = true;
		PopupRender.showSettingsStatus("Salvando configuracoes...");

		await runSettingsAction(async () => {
			await saveCurrentSettings();
			PopupState.hasCompleteSettings = true;
			await loadSprints();
			showInitialView();
		}, "Falha ao salvar configuracoes.");
		updateSettingsFormState();
	});
}

async function init() {
	PopupDom.runButton.disabled = true;
	try {
		const savedSettings = await loadSavedSettings();
		await loadTokens(savedSettings.selectedTokenId || "");

		if (!PopupState.availableTokens.length) {
			PopupState.hasCompleteSettings = false;
			clearTokenForm();
			showTokenSetupView(false);
			PopupRender.showTokenStatus("Cadastre ao menos um token para continuar.", true);
			return;
		}

		await initializeSettingsView(savedSettings);

		if (!PopupRender.isCompleteSettings(savedSettings)) {
			PopupState.hasCompleteSettings = false;
			showSettingsView();
			PopupRender.showSettingsStatus("Configure token, organizacao, projeto e time para comecar.");
			return;
		}

		PopupState.hasCompleteSettings = true;
		await loadSprints();
	} catch (error) {
		PopupRender.showResult(`Erro: ${error instanceof Error ? error.message : "Falha ao carregar a extensao."}`);
	} finally {
		PopupDom.runButton.disabled = false;
		updateTokenFormState();
		updateSettingsFormState();
	}
}

window.PopupApp = {
	init,
};

bindEvents();
