function openItemInAzure(url) {
	if (!url) return;
	if (chrome?.tabs?.create) {
		chrome.tabs.create({ url });
		return;
	}
	window.open(url, "_blank", "noopener,noreferrer");
}

const UI_STATE_STORAGE_KEY = "popupUiState";
const LIST_MODE_TITLES = {
	recent: "Alterações desde o último dia útil",
	critical: "Análises críticas pendentes",
	"metric:started": "Tarefas iniciadas",
	"metric:pending": "Tarefas em andamento",
	"metric:validating": "Tarefas em validação",
	"metric:finished": "Tarefas finalizadas",
};

const LIST_MODE_EMPTY_MESSAGES = {
	recent: "Nenhum item alterado encontrado no periodo.",
	critical: "Nenhuma análise crítica pendente encontrada nas últimas 3 sprints.",
	"metric:started": "Nenhuma tarefa iniciada encontrada para a sprint selecionada.",
	"metric:pending": "Nenhuma tarefa em andamento encontrada para a sprint selecionada.",
	"metric:validating": "Nenhuma tarefa em validação encontrada para a sprint selecionada.",
	"metric:finished": "Nenhuma tarefa finalizada encontrada para a sprint selecionada.",
};

function getListTitleByMode(mode) {
	return LIST_MODE_TITLES[mode] || LIST_MODE_TITLES.recent;
}

function getListEmptyMessageByMode(mode) {
	return LIST_MODE_EMPTY_MESSAGES[mode] || LIST_MODE_EMPTY_MESSAGES.recent;
}

function normalizeItemsPerPage(value) {
	const numeric = Number(value);
	if (numeric === 20) return 20;
	if (numeric === 40) return 40;
	return 10;
}

function getTotalPagesForCurrentList() {
	const totalItems = PopupState.currentListItems.length;
	const perPage = normalizeItemsPerPage(PopupState.itemsPerPage);
	return Math.max(1, Math.ceil(totalItems / perPage));
}

function updatePaginationControls() {
	const totalPages = getTotalPagesForCurrentList();
	PopupState.currentListPage = Math.min(Math.max(1, PopupState.currentListPage), totalPages);
	PopupDom.previousPageButton.disabled = PopupState.currentListPage <= 1;
	PopupDom.nextPageButton.disabled = PopupState.currentListPage >= totalPages;
	PopupDom.paginationStatus.textContent = `Página ${PopupState.currentListPage} de ${totalPages}`;
	PopupDom.itemsPerPageSelect.value = String(normalizeItemsPerPage(PopupState.itemsPerPage));
}

function getCurrentWindowScrollTop() {
	return Number(
		window.scrollY ||
			(document.scrollingElement ? document.scrollingElement.scrollTop : 0) ||
			document.documentElement.scrollTop ||
			document.body.scrollTop ||
			0,
	);
}

function getCurrentViewName() {
	if (!PopupDom.initialView.classList.contains("hidden")) return "initial";
	if (!PopupDom.settingsView.classList.contains("hidden")) return "settings";
	if (!PopupDom.tokenSetupView.classList.contains("hidden")) return "token";
	if (!PopupDom.changesView.classList.contains("hidden")) {
		if (!PopupDom.detailSection.classList.contains("hidden")) return "detail";
		return "changes";
	}
	return "initial";
}

function persistUiStateIfNeeded() {
	if (PopupState.isRestoringUiState) return;
	void saveUiStateSnapshot();
}

async function getSavedUiStateSnapshot() {
	try {
		const stored = await chrome.storage.local.get(UI_STATE_STORAGE_KEY);
		return stored?.[UI_STATE_STORAGE_KEY] || null;
	} catch {
		return null;
	}
}

async function saveUiStateSnapshot(overrides = {}) {
	const snapshot = {
		view: getCurrentViewName(),
		listMode: PopupState.currentListMode || "recent",
		sprintId: String(PopupDom.sprintSelect?.value || "").trim(),
		includeCurrentDay: Boolean(PopupDom.includeCurrentDayToggle?.checked),
		detailItemId: String(PopupState.currentDetailItemId || "").trim(),
		detailItemUrl: String(PopupState.currentDetailItemUrl || "").trim(),
		listCurrentPage: Number(PopupState.currentListPage || 1),
		listItemsPerPage: Number(normalizeItemsPerPage(PopupState.itemsPerPage)),
		windowScrollTop: getCurrentWindowScrollTop(),
		listScrollTop: Number(PopupDom.recentList?.scrollTop || 0),
		detailDescriptionScrollTop: Number(PopupDom.detailDescription?.scrollTop || 0),
		updatedAt: Date.now(),
		...overrides,
	};

	try {
		await chrome.storage.local.set({ [UI_STATE_STORAGE_KEY]: snapshot });
	} catch {
		// Ignore persistence errors in popup UI.
	}
}

function applySavedUiStateInputs(savedUiState) {
	if (!savedUiState) return;
	if (typeof savedUiState.includeCurrentDay === "boolean") {
		PopupDom.includeCurrentDayToggle.checked = savedUiState.includeCurrentDay;
	}
	PopupState.itemsPerPage = normalizeItemsPerPage(savedUiState.listItemsPerPage);
	PopupState.currentListPage = Math.max(1, Number(savedUiState.listCurrentPage || 1));
	PopupDom.itemsPerPageSelect.value = String(PopupState.itemsPerPage);
}

function restoreChangesScroll(savedUiState) {
	const scrollTop = Number(savedUiState?.listScrollTop || 0);
	if (!(scrollTop > 0)) return;
	requestAnimationFrame(() => {
		PopupDom.recentList.scrollTop = scrollTop;
	});
}

function restoreWindowScroll(savedUiState) {
	const scrollTop = Number(savedUiState?.windowScrollTop || 0);
	requestAnimationFrame(() => {
		window.scrollTo(0, scrollTop);
		if (document.scrollingElement) {
			document.scrollingElement.scrollTop = scrollTop;
		}
		document.documentElement.scrollTop = scrollTop;
		document.body.scrollTop = scrollTop;
	});
}

function restoreDetailDescriptionScroll(savedUiState) {
	const scrollTop = Number(savedUiState?.detailDescriptionScrollTop || 0);
	if (!(scrollTop > 0)) return;
	requestAnimationFrame(() => {
		PopupDom.detailDescription.scrollTop = scrollTop;
	});
}

function restoreDetailIfNeeded(savedUiState, items = []) {
	if (!savedUiState || savedUiState.view !== "detail") {
		restoreWindowScroll(savedUiState);
		restoreChangesScroll(savedUiState);
		return;
	}

	const targetId = String(savedUiState.detailItemId || "").trim();
	const targetUrl = String(savedUiState.detailItemUrl || "").trim();
	const targetItem = items.find((item) => {
		const itemId = String(item?.id || "").trim();
		const itemUrl = String(item?.itemUrl || "").trim();
		if (targetId && itemId === targetId) return true;
		if (targetUrl && itemUrl === targetUrl) return true;
		return false;
	});

	if (targetItem) {
		showDetail(targetItem);
		restoreWindowScroll(savedUiState);
		restoreDetailDescriptionScroll(savedUiState);
		return;
	}

	restoreWindowScroll(savedUiState);
	restoreChangesScroll(savedUiState);
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

function updateLoadingOverlayState() {
	const isLoading = PopupState.loadingRequests > 0;
	PopupDom.loadingOverlay.classList.toggle("hidden", !isLoading);
	PopupDom.loadingOverlay.setAttribute("aria-hidden", String(!isLoading));
}

function beginLoading() {
	PopupState.loadingRequests += 1;
	updateLoadingOverlayState();
}

function endLoading() {
	PopupState.loadingRequests = Math.max(0, PopupState.loadingRequests - 1);
	updateLoadingOverlayState();
}

function openConfirmationModal({ title, description, confirmText = "Sim", cancelText = "Não" }) {
	PopupDom.confirmationTitle.textContent = title;
	PopupDom.confirmationDescription.textContent = description;
	PopupDom.confirmationConfirmButton.textContent = confirmText;
	PopupDom.confirmationCancelButton.textContent = cancelText;
	PopupDom.confirmationOverlay.classList.remove("hidden");
	PopupDom.confirmationOverlay.setAttribute("aria-hidden", "false");
	requestAnimationFrame(() => {
		PopupDom.confirmationCancelButton.focus();
	});
}

function closeConfirmationModal(confirmed) {
	PopupDom.confirmationOverlay.classList.add("hidden");
	PopupDom.confirmationOverlay.setAttribute("aria-hidden", "true");
	const resolver = PopupState.confirmationResolver;
	PopupState.confirmationResolver = null;
	if (typeof resolver === "function") {
		resolver(Boolean(confirmed));
	}
}

function requestConfirmation(options) {
	if (PopupState.confirmationResolver) {
		closeConfirmationModal(false);
	}

	openConfirmationModal(options);
	return new Promise((resolve) => {
		PopupState.confirmationResolver = resolve;
	});
}

async function withBlockingUi(action) {
	beginLoading();
	try {
		return await action();
	} finally {
		endLoading();
	}
}

function getTokenScopedSettingsByTokenId(tokenId) {
	const key = String(tokenId || "").trim();
	if (!key) {
		return {
			organization: "",
			projectId: "",
			projectName: "",
			teamId: "",
			teamName: "",
			selectedUserId: "",
			selectedUserName: "",
			selectedUserUniqueName: "",
			selectedUserDescriptor: "",
		};
	}

	return {
		organization: String(PopupState.tokenSettingsByTokenId[key]?.organization || "").trim(),
		projectId: String(PopupState.tokenSettingsByTokenId[key]?.projectId || "").trim(),
		projectName: String(PopupState.tokenSettingsByTokenId[key]?.projectName || "").trim(),
		teamId: String(PopupState.tokenSettingsByTokenId[key]?.teamId || "").trim(),
		teamName: String(PopupState.tokenSettingsByTokenId[key]?.teamName || "").trim(),
		selectedUserId: String(PopupState.tokenSettingsByTokenId[key]?.selectedUserId || "").trim(),
		selectedUserName: String(PopupState.tokenSettingsByTokenId[key]?.selectedUserName || "").trim(),
		selectedUserUniqueName: String(PopupState.tokenSettingsByTokenId[key]?.selectedUserUniqueName || "").trim(),
		selectedUserDescriptor: String(PopupState.tokenSettingsByTokenId[key]?.selectedUserDescriptor || "").trim(),
	};
}

function getSelectedUserValue(settings = {}) {
	return String(settings.selectedUserId || settings.selectedUserDescriptor || settings.selectedUserUniqueName || "").trim();
}

function populateEmptySettingsSelects() {
	PopupRender.populateSelect(PopupDom.organizationSelect, [], "Selecione uma organização", "");
	PopupRender.populateSelect(PopupDom.projectSelect, [], "Selecione um projeto", "");
	PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
	PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", "");
	PopupState.availableUsers = [];
}

function previewTokenScopedSettings(settings = {}) {
	const organization = String(settings.organization || "").trim();
	const projectId = String(settings.projectId || "").trim();
	const projectName = String(settings.projectName || projectId || "").trim();
	const teamId = String(settings.teamId || "").trim();
	const teamName = String(settings.teamName || teamId || "").trim();
	const userValue = getSelectedUserValue(settings);
	const userName = String(settings.selectedUserName || userValue || "").trim();

	PopupRender.populateSelect(
		PopupDom.organizationSelect,
		organization ? [{ value: organization, label: organization, name: organization }] : [],
		"Selecione uma organização",
		organization,
	);
	PopupRender.populateSelect(
		PopupDom.projectSelect,
		projectId ? [{ value: projectId, label: projectName, id: projectId, name: projectName }] : [],
		"Selecione um projeto",
		projectId,
	);
	PopupRender.populateSelect(
		PopupDom.teamSelect,
		teamId ? [{ value: teamId, label: teamName, id: teamId, name: teamName }] : [],
		"Selecione um time",
		teamId,
	);
	PopupRender.populateSelect(
		PopupDom.userSelect,
		userValue ? [{ value: userValue, label: userName, id: settings.selectedUserId || userValue, name: userName }] : [],
		"Eu mesmo",
		userValue,
	);

	PopupState.availableUsers = userValue
		? [
			{
				value: userValue,
				id: settings.selectedUserId || userValue,
				name: userName,
				uniqueName: settings.selectedUserUniqueName || "",
				descriptor: settings.selectedUserDescriptor || "",
			},
		]
		: [];
}

async function loadTokenScopedSettings(tokenId, { shouldRefreshFromStorage = false } = {}) {
	const selectedTokenId = String(tokenId || "").trim();
	if (!selectedTokenId) {
		populateEmptySettingsSelects();
		updateSettingsFormState();
		return;
	}

	if (shouldRefreshFromStorage) {
		const savedSettings = await loadSavedSettings();
		PopupState.tokenSettingsByTokenId = savedSettings.tokenConfigurations || {};
	}

	const scopedSettings = getTokenScopedSettingsByTokenId(selectedTokenId);
	const selectedUserValue = getSelectedUserValue(scopedSettings);
	previewTokenScopedSettings(scopedSettings);

	await loadOrganizations(scopedSettings.organization || "");
	if (scopedSettings.organization) {
		await loadProjects(scopedSettings.projectId || "", scopedSettings.teamId || "", selectedUserValue);
	} else {
		PopupRender.populateSelect(PopupDom.projectSelect, [], "Selecione um projeto", "");
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupRender.populateSelect(PopupDom.userSelect, [], "Eu mesmo", "");
		PopupState.availableUsers = [];
	}

	updateSettingsFormState();
}

function showTokenSetupView(allowBack) {
	PopupDom.initialView.classList.add("hidden");
	PopupDom.settingsView.classList.add("hidden");
	PopupDom.changesView.classList.add("hidden");
	PopupDom.tokenSetupView.classList.remove("hidden");
	PopupDom.backFromTokenButton.classList.toggle("hidden", !allowBack);
	persistUiStateIfNeeded();
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
	PopupState.currentDetailItemId = String(item?.id || "").trim();
	PopupState.currentDetailItemUrl = item.itemUrl || "";
	PopupDom.detailOpenLinkButton.classList.toggle("hidden", !PopupState.currentDetailItemUrl);
	PopupDom.criticalAnalysisButton.classList.toggle(
		"hidden",
		PopupState.currentListMode !== "critical" || !PopupState.currentDetailItemUrl,
	);
	PopupDom.recentSection.classList.add("hidden");
	PopupDom.detailSection.classList.remove("hidden");
	persistUiStateIfNeeded();

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
	PopupState.currentDetailItemId = "";
	PopupState.currentDetailItemUrl = "";
	PopupDom.criticalAnalysisButton.classList.add("hidden");
	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.remove("hidden");
	persistUiStateIfNeeded();
	requestAnimationFrame(() => {
		window.scrollTo(0, PopupState.lastWindowScrollTop);
		if (document.scrollingElement) {
			document.scrollingElement.scrollTop = PopupState.lastWindowScrollTop;
		}
		document.documentElement.scrollTop = PopupState.lastWindowScrollTop;
		document.body.scrollTop = PopupState.lastWindowScrollTop;
	});
}

function showChangesView(mode = "recent") {
	if (!PopupState.availableTokens.length) {
		showTokenSetupView(false);
		return;
	}

	PopupState.currentListMode = mode;
	PopupDom.changesViewTitle.textContent = getListTitleByMode(mode);
	PopupDom.criticalAnalysisButton.classList.add("hidden");

	PopupDom.initialView.classList.add("hidden");
	PopupDom.tokenSetupView.classList.add("hidden");
	PopupDom.settingsView.classList.add("hidden");
	PopupDom.changesView.classList.remove("hidden");
	updatePaginationControls();
	persistUiStateIfNeeded();
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
	persistUiStateIfNeeded();
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
	persistUiStateIfNeeded();
}

function renderCurrentListPage({ mode = "recent" } = {}) {
	const items = PopupState.currentListItems || [];
	const perPage = normalizeItemsPerPage(PopupState.itemsPerPage);
	const totalPages = getTotalPagesForCurrentList();
	PopupState.currentListPage = Math.min(Math.max(1, PopupState.currentListPage), totalPages);

	PopupDom.recentList.innerHTML = "";
	const isCriticalMode = mode === "critical";

	if (!items.length) {
		PopupDom.recentList.textContent = getListEmptyMessageByMode(mode);
		PopupDom.detailSection.classList.add("hidden");
		PopupDom.recentSection.classList.remove("hidden");
		updatePaginationControls();
		persistUiStateIfNeeded();
		return;
	}

	const startIndex = (PopupState.currentListPage - 1) * perPage;
	const endIndex = startIndex + perPage;
	const pageItems = items.slice(startIndex, endIndex);

	for (const item of pageItems) {
		const card = PopupRender.buildItemCard(item, {
			criticalAlertText: isCriticalMode ? item.criticalAlertText : "",
		});
		card.addEventListener("click", () => showDetail(item));
		PopupDom.recentList.appendChild(card);
	}

	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.remove("hidden");
	updatePaginationControls();
	persistUiStateIfNeeded();
}

function renderRecentList(items, { mode = "recent" } = {}) {
	PopupState.currentListItems = Array.isArray(items) ? items : [];
	PopupState.currentListPage = 1;
	renderCurrentListPage({ mode });
}

async function loadMetricItemsByBucket(metricBucket, savedUiState = null) {
	const bucket = String(metricBucket || "").trim().toLowerCase();
	const mode = `metric:${bucket}`;
	showChangesView(mode);
	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.remove("hidden");
	PopupRender.showRecentChangesSkeleton(3, { mode: "recent" });

	const sprintId = String(PopupDom.sprintSelect.value || "").trim();
	if (!sprintId) {
		PopupDom.recentList.textContent = "Selecione uma sprint para listar as tarefas dessa métrica.";
		return;
	}

	try {
		const response = await PopupApi.listSprintItemsByMetricBucket(sprintId, bucket);
		if (!response?.ok) {
			PopupDom.recentList.textContent = response?.error || "Erro ao buscar tarefas da métrica selecionada.";
			return;
		}
		const items = response.items || [];
		renderRecentList(items, { mode });
		if (
			savedUiState &&
			(savedUiState.view === "changes" || savedUiState.view === "detail") &&
			savedUiState.listMode === mode
		) {
			PopupState.currentListPage = Math.max(1, Number(savedUiState.listCurrentPage || 1));
			renderCurrentListPage({ mode });
		}
		restoreDetailIfNeeded(savedUiState, items);
		persistUiStateIfNeeded();
	} catch (error) {
		PopupDom.recentList.textContent = `Erro: ${error instanceof Error ? error.message : "Falha inesperada."}`;
	}
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
	PopupState.tokenSettingsByTokenId = response.tokenConfigurations || {};
	return response;
}

async function loadTokens(selectedTokenId = "") {
	const response = await PopupApi.listTokens();
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar tokens.");
	PopupState.availableTokens = response.tokens || [];
	const preferred = selectedTokenId || response.selectedTokenId || PopupState.availableTokens[0]?.value || "";
	PopupDom.tokenSelect.innerHTML = "";
	for (const token of PopupState.availableTokens) {
		const option = document.createElement("option");
		option.value = token.value;
		option.textContent = token.label;
		PopupDom.tokenSelect.appendChild(option);
	}
	PopupDom.tokenSelect.value = preferred;
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
	const projectOptions = [...(response.projects || [])];
	const selectedProjectLabel =
		PopupDom.projectSelect.options[PopupDom.projectSelect.selectedIndex]?.text || selectedProjectId || "";
	if (selectedProjectId && !projectOptions.some((entry) => String(entry.value) === String(selectedProjectId))) {
		projectOptions.unshift({ value: selectedProjectId, label: selectedProjectLabel, id: selectedProjectId, name: selectedProjectLabel });
	}
	PopupRender.populateSelect(PopupDom.projectSelect, projectOptions, "Selecione um projeto", selectedProjectId);

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
		PopupRender.populateSelect(PopupDom.organizationSelect, [], "Selecione uma organização", "");
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
	const preferred = selectedOrganization || "";
	PopupRender.populateSelect(PopupDom.organizationSelect, options, "Selecione uma organização", preferred);
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

	const teamOptions = [...(response.teams || [])];
	const selectedTeamLabel = PopupDom.teamSelect.options[PopupDom.teamSelect.selectedIndex]?.text || selectedTeamId || "";
	if (selectedTeamId && !teamOptions.some((entry) => String(entry.value) === String(selectedTeamId))) {
		teamOptions.unshift({ value: selectedTeamId, label: selectedTeamLabel, id: selectedTeamId, name: selectedTeamLabel });
	}
	PopupRender.populateSelect(PopupDom.teamSelect, teamOptions, "Selecione um time", selectedTeamId);

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

	const userOptions = [...(response.users || [])];
	const selectedUserLabel = PopupDom.userSelect.options[PopupDom.userSelect.selectedIndex]?.text || selectedUserId || "";
	if (selectedUserId && !userOptions.some((entry) => String(entry.value) === String(selectedUserId))) {
		userOptions.unshift({
			value: selectedUserId,
			label: selectedUserLabel,
			id: selectedUserId,
			name: selectedUserLabel,
			uniqueName: "",
			descriptor: "",
		});
	}

	PopupState.availableUsers = userOptions;
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

	const selectedTokenId = String(selectedToken?.id || selectedToken?.value || PopupDom.tokenSelect.value || "").trim();
	if (selectedTokenId) {
		PopupState.tokenSettingsByTokenId[selectedTokenId] = {
			organization,
			projectId,
			projectName,
			teamId,
			teamName,
			selectedUserId: selectedUser?.id || selectedUserId || "",
			selectedUserName: selectedUser?.name || "",
			selectedUserUniqueName: selectedUser?.uniqueName || "",
			selectedUserDescriptor: selectedUser?.descriptor || "",
		};
	}
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
	const sprints = response.sprints || [];
	PopupRender.populateSprintSelect(sprints, response.defaultSprint || "");
	return sprints.length > 0;
}

async function loadMetricsForCurrentSelection() {
	const sprintId = String(PopupDom.sprintSelect.value || "").trim();
	if (!sprintId) {
		PopupRender.showResult("Nenhuma sprint disponível para cálculo.");
		persistUiStateIfNeeded();
		return;
	}

	PopupRender.showMetricsSkeleton();
	const response = await PopupApi.collectMetrics(sprintId, PopupDom.includeCurrentDayToggle.checked);
	if (!response?.ok) {
		PopupRender.showResult(`Erro: ${response?.error || "Falha inesperada."}`);
		persistUiStateIfNeeded();
		return;
	}

	PopupRender.showMetrics(response.metrics);
	persistUiStateIfNeeded();
}

async function runMetricsAction() {
	try {
		await withBlockingUi(loadMetricsForCurrentSelection);
	} catch (error) {
		PopupRender.showResult(`Erro: ${error instanceof Error ? error.message : "Falha ao calcular métricas."}`);
	}
}

async function refreshSprintsAndMetrics(fallbackMessage = "Falha ao atualizar sprints e métricas.") {
	if (!PopupState.hasCompleteSettings) {
		showSettingsView();
		PopupRender.showSettingsStatus("Configure token, organizacao, projeto e time para atualizar os dados.", true);
		return;
	}

	PopupDom.refreshMetricsButton.disabled = true;
	await runSettingsAction(async () => {
		PopupRender.showMetricsSkeleton();
		const hasSprints = await loadSprints();
		if (!hasSprints) {
			PopupRender.showResult("Nenhuma sprint disponível para o contexto atual. Verifique as configurações do time/projeto.");
			return;
		}
		await loadMetricsForCurrentSelection();
	}, fallbackMessage);
	PopupDom.refreshMetricsButton.disabled = false;
}

async function loadRecentChanges(savedUiState = null) {
	PopupDom.recentButton.disabled = true;
	showChangesView("recent");
	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.remove("hidden");
	PopupRender.showRecentChangesSkeleton(3, { mode: "recent" });

	try {
		const response = await PopupApi.listRecentChanges();
		if (!response?.ok) {
			PopupDom.recentList.textContent = response?.error || "Erro ao buscar itens.";
			return;
		}
		const items = response.items || [];
		renderRecentList(items, { mode: "recent" });
		if (savedUiState && (savedUiState.view === "changes" || savedUiState.view === "detail") && savedUiState.listMode === "recent") {
			PopupState.currentListPage = Math.max(1, Number(savedUiState.listCurrentPage || 1));
			renderCurrentListPage({ mode: "recent" });
		}
		restoreDetailIfNeeded(savedUiState, items);
		persistUiStateIfNeeded();
	} catch (error) {
		PopupDom.recentList.textContent = `Erro: ${error instanceof Error ? error.message : "Falha inesperada."}`;
	} finally {
		PopupDom.recentButton.disabled = false;
	}
}

async function loadCriticalPendingAnalyses(savedUiState = null) {
	PopupDom.criticalPendingButton.disabled = true;
	showChangesView("critical");
	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.remove("hidden");
	PopupRender.showRecentChangesSkeleton(3, { mode: "critical" });

	try {
		const response = await PopupApi.listCriticalPendingAnalyses();
		if (!response?.ok) {
			PopupDom.recentList.textContent = response?.error || "Erro ao buscar análises críticas pendentes.";
			return;
		}
		const items = response.items || [];
		renderRecentList(items, { mode: "critical" });
		if (savedUiState && (savedUiState.view === "changes" || savedUiState.view === "detail") && savedUiState.listMode === "critical") {
			PopupState.currentListPage = Math.max(1, Number(savedUiState.listCurrentPage || 1));
			renderCurrentListPage({ mode: "critical" });
		}
		restoreDetailIfNeeded(savedUiState, items);
		persistUiStateIfNeeded();
	} catch (error) {
		PopupDom.recentList.textContent = `Erro: ${error instanceof Error ? error.message : "Falha inesperada."}`;
	} finally {
		PopupDom.criticalPendingButton.disabled = false;
	}
}

async function initializeSettingsView(savedSettings) {
	PopupRender.applySettingsToInputs(savedSettings);
	await loadTokens(savedSettings.selectedTokenId || "");
	if (!PopupState.availableTokens.length) {
		populateEmptySettingsSelects();
		updateSettingsFormState();
		return;
	}

	const selectedTokenId = String(PopupDom.tokenSelect.value || savedSettings.selectedTokenId || "").trim();
	await loadTokenScopedSettings(selectedTokenId);

	updateSettingsFormState();
}

async function runSettingsAction(action, fallbackMessage) {
	PopupDom.settingsStatus.classList.add("hidden");
	try {
		await withBlockingUi(action);
	} catch (error) {
		PopupRender.showSettingsStatus(`Erro: ${error instanceof Error ? error.message : fallbackMessage}`, true);
	}
}

async function runTokenAction(action, fallbackMessage) {
	PopupDom.tokenStatus.classList.add("hidden");
	try {
		await withBlockingUi(action);
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
			await loadTokenScopedSettings(PopupDom.tokenSelect.value);
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
		const confirmed = await requestConfirmation({
			title: "Excluir token",
			description: `Deseja realmente excluir o token \"${selectedToken.name}\"?`,
			confirmText: "Sim",
			cancelText: "Não",
		});
		if (!confirmed) return;

		PopupDom.deleteTokenButton.disabled = true;
		await runSettingsAction(async () => {
			const response = await deleteCurrentToken();
			if (!response.hasTokens) {
				PopupState.availableTokens = [];
				PopupState.hasCompleteSettings = false;
				PopupState.shouldReloadMetricsAfterTokenDeletion = false;
				clearTokenForm();
				showTokenSetupView(false);
				PopupRender.showTokenStatus("Cadastre um novo token para continuar.", true);
				updateTokenFormState();
				updateSettingsFormState();
				return;
			}

			const savedSettings = await loadSavedSettings();
			await initializeSettingsView(savedSettings);
			PopupState.shouldReloadMetricsAfterTokenDeletion = true;
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

	PopupDom.sprintSelect.addEventListener("change", () => {
		persistUiStateIfNeeded();
		runMetricsAction();
	});

	PopupDom.includeCurrentDayToggle.addEventListener("change", () => {
		persistUiStateIfNeeded();
		runMetricsAction();
	});

	PopupDom.result.addEventListener("click", (event) => {
		const tile = event.target?.closest?.("[data-metric-bucket]");
		if (!tile) return;
		const metricBucket = String(tile.getAttribute("data-metric-bucket") || "").trim();
		if (!metricBucket) return;
		loadMetricItemsByBucket(metricBucket);
	});

	window.addEventListener(
		"scroll",
		() => {
			persistUiStateIfNeeded();
		},
		{ passive: true },
	);

	PopupDom.recentList.addEventListener(
		"scroll",
		() => {
			persistUiStateIfNeeded();
		},
		{ passive: true },
	);

	PopupDom.detailDescription.addEventListener(
		"scroll",
		() => {
			persistUiStateIfNeeded();
		},
		{ passive: true },
	);

	PopupDom.previousPageButton.addEventListener("click", () => {
		if (PopupState.currentListPage <= 1) return;
		PopupState.currentListPage -= 1;
		renderCurrentListPage({ mode: PopupState.currentListMode });
	});

	PopupDom.nextPageButton.addEventListener("click", () => {
		const totalPages = getTotalPagesForCurrentList();
		if (PopupState.currentListPage >= totalPages) return;
		PopupState.currentListPage += 1;
		renderCurrentListPage({ mode: PopupState.currentListMode });
	});

	PopupDom.itemsPerPageSelect.addEventListener("change", () => {
		PopupState.itemsPerPage = normalizeItemsPerPage(PopupDom.itemsPerPageSelect.value);
		PopupState.currentListPage = 1;
		renderCurrentListPage({ mode: PopupState.currentListMode });
	});

	PopupDom.recentButton.addEventListener("click", () => {
		loadRecentChanges();
	});

	PopupDom.criticalPendingButton.addEventListener("click", () => {
		loadCriticalPendingAnalyses();
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

	PopupDom.refreshMetricsButton.addEventListener("click", async () => {
		await refreshSprintsAndMetrics("Falha ao atualizar sprints e métricas.");
	});

	PopupDom.backToInitialButton.addEventListener("click", () => {
		showInitialView();
	});

	PopupDom.backFromSettingsButton.addEventListener("click", async () => {
		showInitialView();

		if (!PopupState.shouldReloadMetricsAfterTokenDeletion || !PopupState.hasCompleteSettings) {
			return;
		}

		PopupState.shouldReloadMetricsAfterTokenDeletion = false;
		await refreshSprintsAndMetrics("Falha ao recarregar sprints e métricas após exclusão de token.");
	});

	PopupDom.backArrowButton.addEventListener("click", () => {
		showList();
	});

	PopupDom.detailOpenLinkButton.addEventListener("click", () => {
		openItemInAzure(PopupState.currentDetailItemUrl);
	});

	PopupDom.criticalAnalysisButton.addEventListener("click", () => {
		openItemInAzure(PopupState.currentDetailItemUrl);
	});

	PopupDom.confirmationCancelButton.addEventListener("click", () => {
		closeConfirmationModal(false);
	});

	PopupDom.confirmationConfirmButton.addEventListener("click", () => {
		closeConfirmationModal(true);
	});

	PopupDom.confirmationOverlay.addEventListener("click", (event) => {
		if (event.target === PopupDom.confirmationOverlay) {
			closeConfirmationModal(false);
		}
	});

	PopupDom.confirmationDialog.addEventListener("click", (event) => {
		event.stopPropagation();
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
			PopupRender.showMetricsSkeleton();
			const hasSprints = await loadSprints();
			showInitialView();
			if (!hasSprints) {
				PopupRender.showResult("Nenhuma sprint disponível para o contexto atual. Verifique as configurações do time/projeto.");
				return;
			}
			await loadMetricsForCurrentSelection();
		}, "Falha ao salvar configuracoes.");
		updateSettingsFormState();
	});
}

async function init() {
		PopupRender.showMetricsSkeleton();
	try {
		PopupState.isRestoringUiState = true;
		const savedUiState = await getSavedUiStateSnapshot();
		applySavedUiStateInputs(savedUiState);

		const savedSettings = await withBlockingUi(async () => {
			const settings = await loadSavedSettings();
			await loadTokens(settings.selectedTokenId || "");
			return settings;
		});

		if (!PopupState.availableTokens.length) {
			PopupState.hasCompleteSettings = false;
			clearTokenForm();
			showTokenSetupView(false);
			PopupRender.showTokenStatus("Cadastre ao menos um token para continuar.", true);
			return;
		}

		await withBlockingUi(() => initializeSettingsView(savedSettings));

		if (!PopupRender.isCompleteSettings(savedSettings)) {
			PopupState.hasCompleteSettings = false;
			showSettingsView();
			PopupRender.showSettingsStatus("Configure token, organizacao, projeto e time para comecar.");
			return;
		}

		PopupState.hasCompleteSettings = true;
		PopupRender.showMetricsSkeleton();
		await withBlockingUi(async () => {
			const hasSprints = await loadSprints();
			const savedSprintId = String(savedUiState?.sprintId || "").trim();
			if (savedSprintId && Array.from(PopupDom.sprintSelect.options).some((option) => String(option.value) === savedSprintId)) {
				PopupDom.sprintSelect.value = savedSprintId;
			}
			if (!hasSprints) {
				PopupRender.showResult("Nenhuma sprint disponível para o contexto atual. Verifique as configurações do time/projeto.");
				return;
			}
			await loadMetricsForCurrentSelection();

			if (savedUiState?.view === "changes" || savedUiState?.view === "detail") {
				if (savedUiState?.listMode === "critical") {
					await loadCriticalPendingAnalyses(savedUiState);
				} else if (String(savedUiState?.listMode || "").startsWith("metric:")) {
					const metricBucket = String(savedUiState.listMode).slice("metric:".length);
					await loadMetricItemsByBucket(metricBucket, savedUiState);
				} else {
					await loadRecentChanges(savedUiState);
				}
				return;
			}

			if (savedUiState?.view === "settings") {
				showSettingsView();
				restoreWindowScroll(savedUiState);
			}
			if (savedUiState?.view === "token") {
				showTokenSetupView(PopupState.availableTokens.length > 0);
				restoreWindowScroll(savedUiState);
			}
			if (!savedUiState || savedUiState.view === "initial") {
				restoreWindowScroll(savedUiState);
			}
		});
	} catch (error) {
		PopupRender.showResult(`Erro: ${error instanceof Error ? error.message : "Falha ao carregar a extensao."}`);
	} finally {
		PopupState.isRestoringUiState = false;
		persistUiStateIfNeeded();
		updatePaginationControls();
		updateTokenFormState();
		updateSettingsFormState();
	}
}

window.PopupApp = {
	init,
};

bindEvents();
