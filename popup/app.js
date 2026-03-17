function openItemInAzure(url) {
	if (!url) return;
	if (chrome?.tabs?.create) {
		chrome.tabs.create({ url });
		return;
	}
	window.open(url, "_blank", "noopener,noreferrer");
}

const UI_STATE_STORAGE_KEY = "popupUiState";
const PROFILE_STORAGE_KEY = "popupSelectedProfile";
const PROFILES = {
	ANALYST: "analyst",
	TESTS: "tests",
	MANAGEMENT: "management",
};

const SCOPES = {
	ME: "me",
	SPECIFIC_USER: "specific-user",
	ALL_USERS: "all-users",
};

const MANAGEMENT_ALL_USERS_VALUE = "__all_analysts__";

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

function getActiveProfile() {
	const normalized = String(PopupState.activeProfile || "").trim().toLowerCase();
	if (normalized === PROFILES.TESTS) return PROFILES.TESTS;
	if (normalized === PROFILES.MANAGEMENT) return PROFILES.MANAGEMENT;
	return PROFILES.ANALYST;
}

function getSettingsDraftProfile() {
	const normalized = String(PopupState.settingsDraftProfile || PopupState.activeProfile || "").trim().toLowerCase();
	if (normalized === PROFILES.TESTS) return PROFILES.TESTS;
	if (normalized === PROFILES.MANAGEMENT) return PROFILES.MANAGEMENT;
	return PROFILES.ANALYST;
}

function getUserScopeForActiveProfile() {
	const profile = getActiveProfile();
	if (profile === PROFILES.ANALYST) {
		return { scope: SCOPES.ME, selectedUser: null };
	}

	if (profile === PROFILES.TESTS) {
		return { scope: SCOPES.ALL_USERS, selectedUser: null };
	}

	const selectedUserId = String(PopupState.managementSelectedUserId || "").trim();
	if (!selectedUserId || selectedUserId === MANAGEMENT_ALL_USERS_VALUE) {
		return { scope: SCOPES.ALL_USERS, selectedUser: null };
	}

	const selectedUser = PopupState.availableUsers.find((user) => String(user.value) === selectedUserId) || null;
	if (!selectedUser) {
		return { scope: SCOPES.ALL_USERS, selectedUser: null };
	}

	return {
		scope: SCOPES.SPECIFIC_USER,
		selectedUser: {
			id: selectedUser.id || selectedUser.value,
			descriptor: selectedUser.descriptor || "",
			uniqueName: selectedUser.uniqueName || "",
			name: selectedUser.name || selectedUser.label || "",
		},
	};
}

function getStatusRegionLabelsByProfile(profile = getActiveProfile()) {
	if (profile === PROFILES.TESTS) {
		return {
			pending: "Pendentes",
			validating: "Liberados",
			finished: "",
		};
	}

	return {
		pending: "Andamento",
		validating: "Validando",
		finished: "Finalizadas",
	};
}

async function getSavedProfile() {
	try {
		const stored = await chrome.storage.local.get(PROFILE_STORAGE_KEY);
		const value = String(stored?.[PROFILE_STORAGE_KEY] || "").trim().toLowerCase();
		if (value === PROFILES.TESTS) return PROFILES.TESTS;
		if (value === PROFILES.MANAGEMENT) return PROFILES.MANAGEMENT;
	} catch {
		// Ignore profile persistence errors.
	}
	return PROFILES.ANALYST;
}

async function saveProfile(profile) {
	try {
		await chrome.storage.local.set({ [PROFILE_STORAGE_KEY]: profile });
	} catch {
		// Ignore profile persistence errors.
	}
}

function updateProfileSwitcherUi() {
	const profile = getSettingsDraftProfile();
	PopupDom.profileAnalystButton.classList.toggle("active", profile === PROFILES.ANALYST);
	PopupDom.profileTestsButton.classList.toggle("active", profile === PROFILES.TESTS);
	PopupDom.profileManagementButton.classList.toggle("active", profile === PROFILES.MANAGEMENT);
}

function applyStatusRegionLabels() {
	const profile = getSettingsDraftProfile();
	const labels = getStatusRegionLabelsByProfile(profile);
	const zonesGrid = PopupDom.statusMappingSection.querySelector(".status-drop-zones-grid");
	const wrappers = PopupDom.statusMappingSection.querySelectorAll(".status-drop-zone-wrapper");
	const titles = PopupDom.statusMappingSection.querySelectorAll(".status-drop-zone-wrapper h4");
	if (titles[0]) titles[0].textContent = labels.pending;
	if (titles[1]) titles[1].textContent = labels.validating;
	if (titles[2]) titles[2].textContent = labels.finished;
	if (wrappers[2]) wrappers[2].classList.toggle("hidden", profile === PROFILES.TESTS);
	if (zonesGrid) {
		zonesGrid.style.gridTemplateColumns =
			profile === PROFILES.TESTS ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))";
	}
	const description = PopupDom.statusMappingSection.querySelector(".status-mapping-description");
	if (description) {
		description.textContent =
			profile === PROFILES.TESTS
				? `Arraste os chips de status para as regiões ${labels.pending} e ${labels.validating} para definir como cada status será contabilizado nas métricas e listagens. Você também pode ajustar a cor de cada status pelo seletor no próprio chip.`
				: `Arraste os chips de status para as regiões ${labels.pending}, ${labels.validating} e ${labels.finished} para definir como cada status será contabilizado nas métricas e listagens. Você também pode ajustar a cor de cada status pelo seletor no próprio chip.`;
	}
}

function applyProfileUiRules() {
	const profile = getActiveProfile();
	const isTests = profile === PROFILES.TESTS;
	const isManagement = profile === PROFILES.MANAGEMENT;

	PopupDom.managementUserFilterGroup.classList.toggle("hidden", !isManagement);
	PopupDom.mainControlsRow?.classList.toggle("controls-analyst", profile === PROFILES.ANALYST);
	PopupDom.mainControlsRow?.classList.toggle("controls-tests", profile === PROFILES.TESTS);
	PopupDom.mainControlsRow?.classList.toggle("controls-management", isManagement);
	PopupDom.includeCurrentDayToggle.closest(".field-toggle")?.classList.toggle("hidden", isTests);
	PopupDom.recentButton.classList.toggle("hidden", isTests);
	PopupDom.criticalPendingButton.classList.toggle("hidden", isTests);
	PopupDom.changesManagementFilterRow.classList.toggle(
		"hidden",
		!(isManagement && !PopupDom.changesView.classList.contains("hidden") && PopupDom.detailSection.classList.contains("hidden")),
	);
	if (isTests) {
		PopupDom.includeCurrentDayToggle.checked = true;
	}
	updateSprintSelectAutoWidth();
	applyStatusRegionLabels();
	updateProfileSwitcherUi();
}

async function setActiveProfile(profile, { persist = true, reloadData = true } = {}) {
	const normalized = String(profile || "").trim().toLowerCase();
	PopupState.activeProfile =
		normalized === PROFILES.TESTS ? PROFILES.TESTS : normalized === PROFILES.MANAGEMENT ? PROFILES.MANAGEMENT : PROFILES.ANALYST;

	if (persist) {
		await saveProfile(PopupState.activeProfile);
	}

	applyProfileUiRules();
	if (PopupState.hasCompleteSettings && reloadData) {
		await runSettingsAction(async () => {
			await loadProjectStatusDiscoveryAndMapping();
			await refreshSprintsAndMetrics("Falha ao atualizar dados após troca de perfil.");
		}, "Falha ao alternar perfil.");
	}
	markSettingsAsSaved();
}

async function commitActiveProfile(profile, { persist = true } = {}) {
	const normalized = String(profile || "").trim().toLowerCase();
	PopupState.activeProfile =
		normalized === PROFILES.TESTS ? PROFILES.TESTS : normalized === PROFILES.MANAGEMENT ? PROFILES.MANAGEMENT : PROFILES.ANALYST;
	PopupState.settingsDraftProfile = PopupState.activeProfile;
	if (persist) {
		await saveProfile(PopupState.activeProfile);
	}
	applyProfileUiRules();
}

const STATUS_REGION_DEFAULT_COLORS = {
	pool: "#6b7280",
	pending: "#0f6cbd",
	validating: "#b58900",
	finished: "#0f7a31",
};

const STATUS_REGION_DEFAULT_COLORS_TESTS = {
	pool: "#6b7280",
	pending: "#b58900",
	validating: "#0f7a31",
	finished: "#0f7a31",
};

function getListTitleByMode(mode) {
	if (getActiveProfile() === PROFILES.TESTS) {
		if (mode === "metric:pending") return "Itens pendentes";
		if (mode === "metric:validating") return "Itens liberados";
		if (mode === "metric:finished") return "Itens finalizados";
		if (mode === "metric:started") return "Total de itens";
	}
	return LIST_MODE_TITLES[mode] || LIST_MODE_TITLES.recent;
}

function getListEmptyMessageByMode(mode) {
	if (getActiveProfile() === PROFILES.TESTS) {
		if (mode === "metric:pending") return "Nenhum item pendente encontrado para a sprint selecionada.";
		if (mode === "metric:validating") return "Nenhum item liberado encontrado para a sprint selecionada.";
		if (mode === "metric:finished") return "Nenhum item finalizado encontrado para a sprint selecionada.";
	}
	return LIST_MODE_EMPTY_MESSAGES[mode] || LIST_MODE_EMPTY_MESSAGES.recent;
}

function normalizeStatusValues(values) {
	if (!Array.isArray(values)) return [];
	const seen = new Set();
	const normalized = [];
	for (const value of values) {
		const text = String(value || "").trim();
		if (!text) continue;
		const key = text.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		normalized.push(text);
	}
	return normalized;
}

function sanitizeDisplayedUserName(value) {
	const text = String(value || "").trim();
	if (!text) return "";
	return text.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function shortenUserNameToTwoParts(value) {
	const normalized = sanitizeDisplayedUserName(value);
	if (!normalized) return "";
	const parts = normalized.split(" ").filter(Boolean);
	if (parts.length <= 2) return normalized;
	return `${parts[0]} ${parts[1]}`;
}

function normalizeStatusMapping(mapping = {}) {
	return {
		configured: Boolean(mapping?.configured),
		buckets: {
			pending: normalizeStatusValues(mapping?.buckets?.pending),
			validating: normalizeStatusValues(mapping?.buckets?.validating),
			finished: normalizeStatusValues(mapping?.buckets?.finished),
		},
		stateColors: Object.fromEntries(
			Object.entries(mapping?.stateColors || {}).filter(([key, value]) => {
				const normalizedKey = String(key || "").trim().toLowerCase();
				const normalizedColor = String(value || "").trim().toLowerCase();
				return Boolean(normalizedKey && /^#[0-9a-f]{6}$/.test(normalizedColor));
			}),
		),
		statusColorOverrides: Object.fromEntries(
			Object.entries(mapping?.statusColorOverrides || {}).map(([key, value]) => [String(key || "").trim().toLowerCase(), Boolean(value)]),
		),
		availableStates: normalizeStatusValues(mapping?.availableStates),
		workItemTypes: normalizeStatusValues(mapping?.workItemTypes),
		updatedAt: Number(mapping?.updatedAt || 0),
	};
}

function isStatusMappingConfigured(mapping) {
	const normalized = normalizeStatusMapping(mapping || {});
	return Boolean(normalized.configured);
}

function createEmptyStatusMappingDraft() {
	return {
		pool: [],
		pending: [],
		validating: [],
		finished: [],
		stateColors: {},
		statusColorOverrides: {},
	};
}

function getRegionDefaultColor(zoneKey) {
	if (getSettingsDraftProfile() === PROFILES.TESTS) {
		return STATUS_REGION_DEFAULT_COLORS_TESTS[zoneKey] || STATUS_REGION_DEFAULT_COLORS_TESTS.pool;
	}
	return STATUS_REGION_DEFAULT_COLORS[zoneKey] || STATUS_REGION_DEFAULT_COLORS.pool;
}

function getStateColorKey(stateName) {
	return String(stateName || "").trim().toLowerCase();
}

function getStatusZoneByName(statusName, draft = PopupState.statusMappingDraft || createEmptyStatusMappingDraft()) {
	const key = getStateColorKey(statusName);
	if (!key) return "pool";
	for (const zone of ["pending", "validating", "finished"]) {
		if ((draft[zone] || []).some((entry) => getStateColorKey(entry) === key)) {
			return zone;
		}
	}
	return "pool";
}

function getDraftStatusColor(statusName, draft = PopupState.statusMappingDraft || createEmptyStatusMappingDraft()) {
	const key = getStateColorKey(statusName);
	if (!key) return getRegionDefaultColor("pool");
	const explicitColor = String(draft.stateColors?.[key] || "").trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(explicitColor)) {
		return explicitColor;
	}
	return getRegionDefaultColor(getStatusZoneByName(statusName, draft));
}

function buildStatusMappingDraft(mapping, availableStates) {
	const normalizedMapping = normalizeStatusMapping(mapping || {});
	const available = normalizeStatusValues(availableStates || normalizedMapping.availableStates || []);
	const availableLookup = new Set(available.map((entry) => entry.toLowerCase()));

	const filterKnown = (values) =>
		normalizeStatusValues(values || []).filter((stateName) => availableLookup.has(String(stateName || "").toLowerCase()));

	const pending = filterKnown(normalizedMapping.buckets.pending);
	const validating = filterKnown(normalizedMapping.buckets.validating);
	const finished = filterKnown(normalizedMapping.buckets.finished);

	const used = new Set([...pending, ...validating, ...finished].map((entry) => entry.toLowerCase()));
	const pool = available.filter((stateName) => !used.has(stateName.toLowerCase()));
	const stateColors = { ...(normalizedMapping.stateColors || {}) };
	const statusColorOverrides = { ...(normalizedMapping.statusColorOverrides || {}) };

	for (const stateName of available) {
		const key = getStateColorKey(stateName);
		if (!key) continue;
		if (!stateColors[key]) {
			const zone = pending.some((entry) => getStateColorKey(entry) === key)
				? "pending"
				: validating.some((entry) => getStateColorKey(entry) === key)
					? "validating"
					: finished.some((entry) => getStateColorKey(entry) === key)
						? "finished"
						: "pool";
			stateColors[key] = getRegionDefaultColor(zone);
		}
		if (typeof statusColorOverrides[key] !== "boolean") {
			statusColorOverrides[key] = false;
		}
	}

	return {
		pool,
		pending,
		validating,
		finished,
		stateColors,
		statusColorOverrides,
	};
}

function getStatusBucketsFromDraft() {
	const draft = PopupState.statusMappingDraft || createEmptyStatusMappingDraft();
	return {
		pending: normalizeStatusValues(draft.pending),
		validating: normalizeStatusValues(draft.validating),
		finished: normalizeStatusValues(draft.finished),
	};
}

function getStatusColorsFromDraft() {
	const draft = PopupState.statusMappingDraft || createEmptyStatusMappingDraft();
	const colors = {};
	for (const stateName of PopupState.availableProjectStates || []) {
		const key = getStateColorKey(stateName);
		if (!key) continue;
		colors[key] = getDraftStatusColor(stateName, draft);
	}
	return colors;
}

function getStatusColorOverridesFromDraft() {
	const draft = PopupState.statusMappingDraft || createEmptyStatusMappingDraft();
	const overrides = {};
	for (const stateName of PopupState.availableProjectStates || []) {
		const key = getStateColorKey(stateName);
		if (!key) continue;
		overrides[key] = Boolean(draft.statusColorOverrides?.[key]);
	}
	return overrides;
}

function sortDraftZonesByAvailableOrder() {
	const draft = PopupState.statusMappingDraft || createEmptyStatusMappingDraft();
	const order = new Map(PopupState.availableProjectStates.map((name, index) => [String(name || "").toLowerCase(), index]));

	const sortByKnownOrder = (values) =>
		[...(values || [])].sort(
			(left, right) =>
				(Number(order.get(String(left || "").toLowerCase()) || 0) - Number(order.get(String(right || "").toLowerCase()) || 0)),
		);

	draft.pool = sortByKnownOrder(draft.pool);
	draft.pending = sortByKnownOrder(draft.pending);
	draft.validating = sortByKnownOrder(draft.validating);
	draft.finished = sortByKnownOrder(draft.finished);
	PopupState.statusMappingDraft = draft;
}

function renderStatusZone(containerElement, statuses, zoneKey) {
	containerElement.innerHTML = "";
	if (!statuses.length) {
		const placeholder = document.createElement("span");
		placeholder.className = "status-drop-empty";
		placeholder.textContent = zoneKey === "pool" ? "Arraste status para as regiões abaixo" : "Nenhum status";
		containerElement.appendChild(placeholder);
		return;
	}

	for (const stateName of statuses) {
		const chip = document.createElement("div");
		chip.className = "status-chip";
		const statusColor = getDraftStatusColor(stateName);
		chip.style.color = statusColor;
		chip.style.borderColor = statusColor;
		chip.draggable = true;
		chip.dataset.statusName = stateName;
		chip.dataset.sourceZone = zoneKey;

		const label = document.createElement("span");
		label.className = "status-chip-label";
		label.textContent = stateName;

		const colorInput = document.createElement("input");
		colorInput.type = "color";
		colorInput.className = "status-chip-color-picker";
		colorInput.value = statusColor;
		colorInput.title = `Cor do status ${stateName}`;
		colorInput.addEventListener("mousedown", (event) => {
			event.stopPropagation();
		});
		colorInput.addEventListener("click", (event) => {
			event.stopPropagation();
		});
		colorInput.addEventListener("change", (event) => {
			event.stopPropagation();
			const value = String(event.target?.value || "").trim().toLowerCase();
			if (!/^#[0-9a-f]{6}$/.test(value)) return;
			const draft = PopupState.statusMappingDraft || createEmptyStatusMappingDraft();
			const key = getStateColorKey(stateName);
			draft.stateColors[key] = value;
			draft.statusColorOverrides[key] = true;
			PopupState.statusMappingDraft = draft;
			renderStatusMappingDraft();
		});

		chip.appendChild(label);
		chip.appendChild(colorInput);
		chip.addEventListener("dragstart", (event) => {
			PopupState.draggingStatusName = stateName;
			event.dataTransfer?.setData("text/plain", stateName);
			event.dataTransfer?.setData("application/x-status-zone", zoneKey);
			event.dataTransfer.effectAllowed = "move";
		});
		chip.addEventListener("dragend", () => {
			PopupState.draggingStatusName = "";
		});
		containerElement.appendChild(chip);
	}
}

function renderStatusMappingDraft() {
	const draft = PopupState.statusMappingDraft || createEmptyStatusMappingDraft();
	renderStatusZone(PopupDom.statusPool, draft.pool, "pool");
	renderStatusZone(PopupDom.pendingDropZone, draft.pending, "pending");
	renderStatusZone(PopupDom.validatingDropZone, draft.validating, "validating");
	renderStatusZone(PopupDom.finishedDropZone, draft.finished, "finished");
}

function moveStatusToZone(statusName, targetZone) {
	const allowedZones = new Set(["pool", "pending", "validating", "finished"]);
	if (!allowedZones.has(targetZone)) return;

	const status = String(statusName || "").trim();
	if (!status) return;

	const draft = PopupState.statusMappingDraft || createEmptyStatusMappingDraft();
	draft.stateColors = draft.stateColors || {};
	draft.statusColorOverrides = draft.statusColorOverrides || {};
	for (const zone of ["pool", "pending", "validating", "finished"]) {
		draft[zone] = (draft[zone] || []).filter((item) => String(item || "").toLowerCase() !== status.toLowerCase());
	}

	draft[targetZone].push(status);

	const stateKey = getStateColorKey(status);
	if (!draft.statusColorOverrides?.[stateKey]) {
		draft.stateColors[stateKey] = getRegionDefaultColor(targetZone);
	}

	PopupState.statusMappingDraft = draft;
	sortDraftZonesByAvailableOrder();
	renderStatusMappingDraft();
}

function updateStatusMappingFormState() {
	const hasProjectContext =
		Boolean(String(PopupDom.organizationSelect.value || "").trim()) &&
		Boolean(String(PopupDom.projectSelect.value || "").trim());
	const hasStates = PopupState.availableProjectStates.length > 0;
	const disabled = !hasProjectContext || !hasStates;

	PopupDom.statusPool.classList.toggle("disabled", disabled);
	PopupDom.pendingDropZone.classList.toggle("disabled", disabled);
	PopupDom.validatingDropZone.classList.toggle("disabled", disabled);
	PopupDom.finishedDropZone.classList.toggle("disabled", disabled);
}

function renderStatusMappingSection() {
	const mapping = normalizeStatusMapping(PopupState.currentProjectStatusMapping || {});
	const availableStates = normalizeStatusValues(PopupState.availableProjectStates || mapping.availableStates || []);
	const labels = getStatusRegionLabelsByProfile(getSettingsDraftProfile());
	PopupState.availableProjectStates = availableStates;
	PopupState.statusMappingDraft = buildStatusMappingDraft(mapping, availableStates);
	renderStatusMappingDraft();
	applyStatusRegionLabels();

	if (!availableStates.length) {
		PopupDom.statusMappingStatus.classList.remove("hidden");
		PopupDom.statusMappingStatus.textContent = "Selecione organização e projeto para carregar os status disponíveis.";
	} else if (!mapping.configured) {
		PopupDom.statusMappingStatus.classList.remove("hidden");
		PopupDom.statusMappingStatus.textContent =
			getSettingsDraftProfile() === PROFILES.TESTS
				? `Mapeamento obrigatório: classifique os status do projeto em ${labels.pending} e ${labels.validating} antes de usar métricas e listagens.`
				: `Mapeamento obrigatório: classifique os status do projeto em ${labels.pending}, ${labels.validating} e ${labels.finished} antes de usar métricas e listagens.`;
	} else {
		PopupDom.statusMappingStatus.classList.add("hidden");
	}

	updateStatusMappingFormState();
}

function ensureStatusMappingReadyForDataViews() {
	if (isStatusMappingConfigured(PopupState.currentProjectStatusMapping)) {
		return true;
	}

	showSettingsView();
	PopupDom.statusMappingStatus.classList.remove("hidden");
	PopupDom.statusMappingStatus.textContent =
		"Mapeamento de status pendente: configure os buckets do projeto para continuar.";
	return false;
}

function normalizeItemsPerPage(value) {
	const numeric = Number(value);
	if (numeric === 20) return 20;
	if (numeric === 40) return 40;
	return 10;
}

function updateSprintSelectAutoWidth() {
	const select = PopupDom.sprintSelect;
	if (!select) return;
	if (getActiveProfile() !== PROFILES.MANAGEMENT) {
		select.style.width = "";
		return;
	}

	const texts = Array.from(select.options || []).map((option) => String(option?.textContent || "").trim()).filter(Boolean);
	const longestText = texts.reduce((longest, current) => (current.length > longest.length ? current : longest), "");
	if (!longestText) {
		select.style.width = "";
		return;
	}

	const computed = window.getComputedStyle(select);
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d");
	if (!context) return;
	context.font = computed.font;
	const contentWidth = Math.ceil(context.measureText(longestText).width);
	const horizontalPadding = 44;
	select.style.width = `${contentWidth + horizontalPadding}px`;
}

function getTotalPagesForCurrentList() {
	const totalItems = PopupState.currentListItems.length;
	const perPage = normalizeItemsPerPage(PopupState.itemsPerPage);
	return Math.max(1, Math.ceil(totalItems / perPage));
}

function updatePaginationControls() {
	const totalItems = PopupState.currentListItems.length;
	const totalPages = getTotalPagesForCurrentList();
	PopupState.currentListPage = Math.min(Math.max(1, PopupState.currentListPage), totalPages);
	PopupDom.previousPageButton.disabled = PopupState.currentListPage <= 1;
	PopupDom.nextPageButton.disabled = PopupState.currentListPage >= totalPages;
	PopupDom.previousPageButtonBottom.disabled = PopupState.currentListPage <= 1;
	PopupDom.nextPageButtonBottom.disabled = PopupState.currentListPage >= totalPages;
	PopupDom.paginationStatus.textContent = `Página ${PopupState.currentListPage} de ${totalPages} • ${totalItems} itens`;
	PopupDom.paginationStatusBottom.textContent = `Página ${PopupState.currentListPage} de ${totalPages} • ${totalItems} itens`;
	PopupDom.itemsPerPageSelect.value = String(normalizeItemsPerPage(PopupState.itemsPerPage));
	PopupDom.itemsPerPageSelectBottom.value = String(normalizeItemsPerPage(PopupState.itemsPerPage));
}

function setPaginationLoadingState(isLoading) {
	const loading = Boolean(isLoading);
	const controls = [
		PopupDom.previousPageButton,
		PopupDom.nextPageButton,
		PopupDom.previousPageButtonBottom,
		PopupDom.nextPageButtonBottom,
		PopupDom.itemsPerPageSelect,
		PopupDom.itemsPerPageSelectBottom,
	];

	for (const control of controls) {
		control.disabled = loading;
	}

	PopupDom.paginationStatus.classList.toggle("pagination-status-skeleton", loading);
	PopupDom.paginationStatusBottom.classList.toggle("pagination-status-skeleton", loading);

	if (loading) {
		PopupDom.paginationStatus.textContent = " ";
		PopupDom.paginationStatusBottom.textContent = " ";
		return;
	}

	updatePaginationControls();
	updateBottomPaginationVisibility();
}

function updateBottomPaginationVisibility() {
	requestAnimationFrame(() => {
		const isListVisible = !PopupDom.recentSection.classList.contains("hidden") && !PopupDom.changesView.classList.contains("hidden");
		if (!isListVisible) {
			PopupDom.bottomPaginationControls.classList.add("hidden");
			return;
		}

		const recentListNeedsScroll = PopupDom.recentList.scrollHeight > PopupDom.recentList.clientHeight + 1;
		const scrollingElement = document.scrollingElement || document.documentElement;
		const pageNeedsScroll = Number(scrollingElement.scrollHeight || 0) > Number(scrollingElement.clientHeight || window.innerHeight || 0) + 1;
		const shouldShowBottomPagination = recentListNeedsScroll || pageNeedsScroll;

		PopupDom.bottomPaginationControls.classList.toggle("hidden", !shouldShowBottomPagination);
	});
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
		profile: getActiveProfile(),
		listMode: PopupState.currentListMode || "recent",
		sprintId: String(PopupDom.sprintSelect?.value || "").trim(),
		managementSelectedUserId: String(PopupState.managementSelectedUserId || "").trim(),
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
	if (typeof savedUiState.managementSelectedUserId === "string") {
		const restored = String(savedUiState.managementSelectedUserId || "").trim();
		PopupState.managementSelectedUserId = restored === MANAGEMENT_ALL_USERS_VALUE ? "" : restored;
	}
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

function openConfirmationModal({ title, description, confirmText = "Sim", cancelText = "Não", showConfirmButton = true }) {
	PopupDom.confirmationTitle.textContent = title;
	PopupDom.confirmationDescription.textContent = description;
	PopupDom.confirmationConfirmButton.textContent = confirmText;
	PopupDom.confirmationCancelButton.textContent = cancelText;
	PopupDom.confirmationConfirmButton.classList.toggle("hidden", !showConfirmButton);
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
		};
	}

	return {
		organization: String(PopupState.tokenSettingsByTokenId[key]?.organization || "").trim(),
		projectId: String(PopupState.tokenSettingsByTokenId[key]?.projectId || "").trim(),
		projectName: String(PopupState.tokenSettingsByTokenId[key]?.projectName || "").trim(),
		teamId: String(PopupState.tokenSettingsByTokenId[key]?.teamId || "").trim(),
		teamName: String(PopupState.tokenSettingsByTokenId[key]?.teamName || "").trim(),
	};
}

function populateEmptySettingsSelects() {
	PopupRender.populateSelect(PopupDom.organizationSelect, [], "Selecione uma organização", "");
	PopupRender.populateSelect(PopupDom.projectSelect, [], "Selecione um projeto", "");
	PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
	PopupState.availableUsers = [];
}

function previewTokenScopedSettings(settings = {}) {
	const organization = String(settings.organization || "").trim();
	const projectId = String(settings.projectId || "").trim();
	const projectName = String(settings.projectName || projectId || "").trim();
	const teamId = String(settings.teamId || "").trim();
	const teamName = String(settings.teamName || teamId || "").trim();

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
}

async function loadTokenScopedSettings(tokenId, { shouldRefreshFromStorage = false } = {}) {
	const selectedTokenId = String(tokenId || "").trim();
	if (!selectedTokenId) {
		populateEmptySettingsSelects();
		PopupState.availableProjectStates = [];
		PopupState.availableProjectWorkItemTypes = [];
		PopupState.currentProjectStatusMapping = normalizeStatusMapping({ configured: false, buckets: {} });
		renderStatusMappingSection();
		updateSettingsFormState();
		return;
	}

	if (shouldRefreshFromStorage) {
		const savedSettings = await loadSavedSettings();
		PopupState.tokenSettingsByTokenId = savedSettings.tokenConfigurations || {};
	}

	const scopedSettings = getTokenScopedSettingsByTokenId(selectedTokenId);
	previewTokenScopedSettings(scopedSettings);

	await loadOrganizations(scopedSettings.organization || "");
	if (scopedSettings.organization) {
		await loadProjects(scopedSettings.projectId || "", scopedSettings.teamId || "");
	} else {
		PopupRender.populateSelect(PopupDom.projectSelect, [], "Selecione um projeto", "");
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupState.availableUsers = [];
	}

	await loadProjectStatusDiscoveryAndMapping();

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
	const card = PopupRender.buildItemCard(item, {
		clickable: false,
		profile: getActiveProfile(),
		criticalAlertText: PopupState.currentListMode === "critical" ? item.criticalAlertText : "",
	});
	card.classList.add("detail-card");
	PopupDom.detailMeta.appendChild(card);

	PopupDom.detailDescription.innerHTML = item.description || "<em>Sem descricao.</em>";
	PopupState.currentDetailItemId = String(item?.id || "").trim();
	PopupState.currentDetailItemUrl = item.itemUrl || "";
	PopupDom.detailOpenLinkButton.classList.toggle("hidden", !PopupState.currentDetailItemUrl);
	PopupDom.criticalAnalysisButton.textContent =
		getActiveProfile() === PROFILES.MANAGEMENT ? "Requerir análise crítica" : "Fazer análise crítica";
	PopupDom.criticalAnalysisButton.classList.toggle(
		"hidden",
		PopupState.currentListMode !== "critical" || !PopupState.currentDetailItemUrl,
	);
	PopupDom.recentSection.classList.add("hidden");
	PopupDom.detailSection.classList.remove("hidden");
	PopupDom.topPaginationControls.classList.add("hidden");
	PopupDom.bottomPaginationControls.classList.add("hidden");
	applyProfileUiRules();
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
	PopupDom.topPaginationControls.classList.remove("hidden");
	applyProfileUiRules();
	updateBottomPaginationVisibility();
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
	PopupDom.topPaginationControls.classList.remove("hidden");
	applyProfileUiRules();
	updatePaginationControls();
	updateBottomPaginationVisibility();
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
	PopupDom.topPaginationControls.classList.add("hidden");
	PopupDom.bottomPaginationControls.classList.add("hidden");
	applyProfileUiRules();
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
	PopupDom.topPaginationControls.classList.add("hidden");
	PopupDom.bottomPaginationControls.classList.add("hidden");
	PopupDom.initialView.classList.remove("hidden");
	applyProfileUiRules();
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
			profile: getActiveProfile(),
			criticalAlertText: isCriticalMode ? item.criticalAlertText : "",
		});
		card.addEventListener("click", () => showDetail(item));
		PopupDom.recentList.appendChild(card);
	}

	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.remove("hidden");
	updatePaginationControls();
	updateBottomPaginationVisibility();
	persistUiStateIfNeeded();
}

function renderRecentList(items, { mode = "recent" } = {}) {
	PopupState.currentListItems = Array.isArray(items) ? items : [];
	PopupState.currentListPage = 1;
	renderCurrentListPage({ mode });
}

async function loadMetricItemsByBucket(metricBucket, savedUiState = null) {
	if (!ensureStatusMappingReadyForDataViews()) {
		return;
	}

	const bucket = String(metricBucket || "").trim().toLowerCase();
	const mode = `metric:${bucket}`;
	showChangesView(mode);
	setPaginationLoadingState(true);
	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.remove("hidden");
	PopupRender.showRecentChangesSkeleton(3, { mode: "recent" });

	const sprintId = String(PopupDom.sprintSelect.value || "").trim();
	if (!sprintId) {
		PopupDom.recentList.textContent = "Selecione uma sprint para listar as tarefas dessa métrica.";
		setPaginationLoadingState(false);
		return;
	}

	try {
		const userScope = getUserScopeForActiveProfile();
		const response = await PopupApi.listSprintItemsByMetricBucket(
			sprintId,
			bucket,
			getActiveProfile(),
			userScope.scope,
			userScope.selectedUser,
		);
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
	} finally {
		setPaginationLoadingState(false);
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
	PopupDom.saveSettingsButton.disabled = !(tokenId && organization && projectId && teamId);
}

function normalizeSignatureList(values) {
	return normalizeStatusValues(values || [])
		.map((value) => String(value || "").trim().toLowerCase())
		.filter(Boolean)
		.sort((left, right) => left.localeCompare(right));
}

function normalizeSignatureObject(values = {}) {
	return Object.fromEntries(
		Object.entries(values || {})
			.map(([key, value]) => [String(key || "").trim().toLowerCase(), String(value ?? "").trim().toLowerCase()])
			.filter(([key, value]) => Boolean(key && value))
			.sort(([left], [right]) => left.localeCompare(right)),
	);
}

function normalizeSignatureBooleanObject(values = {}) {
	return Object.fromEntries(
		Object.entries(values || {})
			.map(([key, value]) => [String(key || "").trim().toLowerCase(), Boolean(value)])
			.filter(([key]) => Boolean(key))
			.sort(([left], [right]) => left.localeCompare(right)),
	);
}

function buildSettingsSavedSignature() {
	const tokenId = String(PopupDom.tokenSelect.value || "").trim();
	const organization = String(PopupDom.organizationSelect.value || "").trim();
	const projectId = String(PopupDom.projectSelect.value || "").trim();
	const teamId = String(PopupDom.teamSelect.value || "").trim();
	const buckets = getStatusBucketsFromDraft();

	return JSON.stringify({
		profile: getSettingsDraftProfile(),
		tokenId,
		organization,
		projectId,
		teamId,
		buckets: {
			pending: normalizeSignatureList(buckets.pending),
			validating: normalizeSignatureList(buckets.validating),
			finished: normalizeSignatureList(buckets.finished),
		},
		stateColors: normalizeSignatureObject(getStatusColorsFromDraft()),
		statusColorOverrides: normalizeSignatureBooleanObject(getStatusColorOverridesFromDraft()),
	});
}

function markSettingsAsSaved() {
	PopupState.settingsSavedSignature = buildSettingsSavedSignature();
}

function hasUnsavedSettingsChanges() {
	if (!PopupDom.settingsView || PopupDom.settingsView.classList.contains("hidden")) {
		return false;
	}

	const currentSignature = buildSettingsSavedSignature();
	const savedSignature = String(PopupState.settingsSavedSignature || "");
	if (!savedSignature) {
		return Boolean(currentSignature);
	}

	return currentSignature !== savedSignature;
}

async function confirmLeaveSettingsViewIfNeeded() {
	if (!hasUnsavedSettingsChanges()) {
		return true;
	}

	return requestConfirmation({
		title: "Sair sem salvar",
		description: "Você possui alterações não salvas em Configurações. Deseja sair mesmo assim?",
		confirmText: "Sair sem salvar",
		cancelText: "Continuar editando",
	});
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

function populateManagementUsersSelect(selectedUserId = "") {
	const rawSelectedValue = String(selectedUserId || "").trim();
	const selectedValue = rawSelectedValue === MANAGEMENT_ALL_USERS_VALUE ? "" : rawSelectedValue;
	const options = [
		...(PopupState.availableUsers || []).map((user) => ({
			value: user.value,
			label: shortenUserNameToTwoParts(user.label || user.name || user.uniqueName || "") || user.label,
		})),
	];
	PopupRender.populateSelect(PopupDom.managementUserSelect, options, "Todos os analistas", selectedValue);
	PopupRender.populateSelect(PopupDom.managementUserSelectChanges, options, "Todos os analistas", selectedValue);
}

async function loadProjects(selectedProjectId = "", selectedTeamId = "") {
	const organization = String(PopupDom.organizationSelect.value || "").trim();
	const tokenValue = getSelectedTokenValue();

	if (!organization || !tokenValue) {
		PopupRender.populateSelect(PopupDom.projectSelect, [], "Selecione um projeto", "");
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupState.availableUsers = [];
		populateManagementUsersSelect("");
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
		await loadTeams(selectedProjectId, selectedTeamId);
	} else {
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupState.availableUsers = [];
		populateManagementUsersSelect("");
	}

	updateSettingsFormState();
}

async function loadOrganizations(selectedOrganization = "") {
	const tokenValue = getSelectedTokenValue();

	if (!tokenValue) {
		PopupRender.populateSelect(PopupDom.organizationSelect, [], "Selecione uma organização", "");
		PopupRender.populateSelect(PopupDom.projectSelect, [], "Selecione um projeto", "");
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupState.availableUsers = [];
		populateManagementUsersSelect("");
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

async function loadTeams(projectId = PopupDom.projectSelect.value, selectedTeamId = "") {
	const organization = String(PopupDom.organizationSelect.value || "").trim();
	const tokenValue = getSelectedTokenValue();

	if (!organization || !tokenValue || !projectId) {
		PopupRender.populateSelect(PopupDom.teamSelect, [], "Selecione um time", "");
		PopupState.availableUsers = [];
		populateManagementUsersSelect("");
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
		await loadUsers(projectId, selectedTeamId, PopupState.managementSelectedUserId);
	} else {
		PopupState.availableUsers = [];
		populateManagementUsersSelect("");
	}

	updateSettingsFormState();
}

async function loadUsers(projectId = PopupDom.projectSelect.value, teamId = PopupDom.teamSelect.value, selectedUserId = "") {
	const organization = String(PopupDom.organizationSelect.value || "").trim();
	const tokenValue = getSelectedTokenValue();

	if (!organization || !tokenValue || !projectId || !teamId) {
		PopupState.availableUsers = [];
		populateManagementUsersSelect("");
		updateSettingsFormState();
		return;
	}

	const response = await PopupApi.listUsers(organization, projectId, teamId, tokenValue);
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar usuarios.");

	const userOptions = [...(response.users || [])];
	const selectedUserLabel =
		PopupDom.managementUserSelect.options[PopupDom.managementUserSelect.selectedIndex]?.text || selectedUserId || "";
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
	populateManagementUsersSelect(selectedUserId || PopupState.managementSelectedUserId || "");
	updateSettingsFormState();
}

async function loadProjectStatusDiscoveryAndMapping() {
	const organization = String(PopupDom.organizationSelect.value || "").trim();
	const projectId = String(PopupDom.projectSelect.value || "").trim();
	const projectName = String(PopupDom.projectSelect.options[PopupDom.projectSelect.selectedIndex]?.text || "").trim();
	const tokenValue = getSelectedTokenValue();

	if (!organization || !projectId || !projectName || !tokenValue) {
		PopupState.availableProjectStates = [];
		PopupState.availableProjectWorkItemTypes = [];
		PopupState.currentProjectStatusMapping = normalizeStatusMapping({ configured: false, buckets: {} });
		renderStatusMappingSection();
		return;
	}

	const settingsProfile = getSettingsDraftProfile();
	const discoveryResponse = await PopupApi.listProjectWorkItemStates(
		organization,
		projectId,
		projectName,
		tokenValue,
		settingsProfile,
	);
	if (!discoveryResponse?.ok) {
		throw new Error(discoveryResponse?.error || "Falha ao carregar status do projeto.");
	}

	PopupState.availableProjectStates = normalizeStatusValues(discoveryResponse.availableStates || []);
	PopupState.availableProjectWorkItemTypes = normalizeStatusValues(discoveryResponse.workItemTypes || []);

	const mappingResponse = await PopupApi.getProjectStatusMapping(organization, projectId, settingsProfile);
	if (!mappingResponse?.ok) {
		throw new Error(mappingResponse?.error || "Falha ao carregar mapeamento de status.");
	}

	const mapping = normalizeStatusMapping(mappingResponse.mapping || discoveryResponse.statusMapping || {});
	PopupState.currentProjectStatusMapping = {
		...mapping,
		availableStates: PopupState.availableProjectStates,
		workItemTypes: PopupState.availableProjectWorkItemTypes,
	};
	renderStatusMappingSection();
}

async function saveCurrentProjectStatusMapping() {
	const organization = String(PopupDom.organizationSelect.value || "").trim();
	const projectId = String(PopupDom.projectSelect.value || "").trim();

	if (!organization || !projectId) {
		throw new Error("Selecione organização e projeto para salvar o mapeamento de status.");
	}

	const buckets = getStatusBucketsFromDraft();
	const stateColors = getStatusColorsFromDraft();
	const statusColorOverrides = getStatusColorOverridesFromDraft();

	const response = await PopupApi.saveProjectStatusMapping(organization, projectId, {
		configured: true,
		buckets,
		stateColors,
		statusColorOverrides,
		availableStates: PopupState.availableProjectStates,
		workItemTypes: PopupState.availableProjectWorkItemTypes,
	}, getSettingsDraftProfile());

	if (!response?.ok) {
		throw new Error(response?.error || "Falha ao salvar mapeamento de status.");
	}

	PopupState.currentProjectStatusMapping = normalizeStatusMapping(response.mapping || {});
	renderStatusMappingSection();
}

async function saveCurrentSettings() {
	const selectedToken = getSelectedToken();
	const organization = String(PopupDom.organizationSelect.value || "").trim();
	const projectId = PopupDom.projectSelect.value;
	const teamId = PopupDom.teamSelect.value;
	const projectName = PopupDom.projectSelect.options[PopupDom.projectSelect.selectedIndex]?.text || "";
	const teamName = PopupDom.teamSelect.options[PopupDom.teamSelect.selectedIndex]?.text || "";

	const response = await PopupApi.saveSettings({
		selectedTokenId: selectedToken?.id || selectedToken?.value || PopupDom.tokenSelect.value,
		organization,
		projectId,
		projectName,
		teamId,
		teamName,
		selectedProfile: getSettingsDraftProfile(),
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
	const response = await PopupApi.listSprints(getActiveProfile());
	if (!response?.ok) throw new Error(response?.error || "Falha ao carregar sprints.");
	const sprints = response.sprints || [];
	PopupRender.populateSprintSelect(sprints, response.defaultSprint || "");
	updateSprintSelectAutoWidth();
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
	const userScope = getUserScopeForActiveProfile();
	const includeCurrentDay = getActiveProfile() === PROFILES.TESTS ? true : PopupDom.includeCurrentDayToggle.checked;
	const response = await PopupApi.collectMetrics(
		sprintId,
		includeCurrentDay,
		getActiveProfile(),
		userScope.scope,
		userScope.selectedUser,
	);
	if (!response?.ok) {
		PopupRender.showResult(`Erro: ${response?.error || "Falha inesperada."}`);
		persistUiStateIfNeeded();
		return;
	}

	PopupRender.showMetrics(response.metrics);
	persistUiStateIfNeeded();
}

async function runMetricsAction() {
	if (!ensureStatusMappingReadyForDataViews()) {
		return;
	}

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

	if (!ensureStatusMappingReadyForDataViews()) {
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
	if (!ensureStatusMappingReadyForDataViews()) {
		return;
	}

	PopupDom.recentButton.disabled = true;
	showChangesView("recent");
	setPaginationLoadingState(true);
	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.remove("hidden");
	PopupRender.showRecentChangesSkeleton(3, { mode: "recent" });

	try {
		const userScope = getUserScopeForActiveProfile();
		const response = await PopupApi.listRecentChanges(getActiveProfile(), userScope.scope, userScope.selectedUser);
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
		setPaginationLoadingState(false);
		PopupDom.recentButton.disabled = false;
	}
}

async function loadCriticalPendingAnalyses(savedUiState = null) {
	if (!ensureStatusMappingReadyForDataViews()) {
		return;
	}

	PopupDom.criticalPendingButton.disabled = true;
	showChangesView("critical");
	setPaginationLoadingState(true);
	PopupDom.detailSection.classList.add("hidden");
	PopupDom.recentSection.classList.remove("hidden");
	PopupRender.showRecentChangesSkeleton(3, { mode: "critical" });

	try {
		const userScope = getUserScopeForActiveProfile();
		const response = await PopupApi.listCriticalPendingAnalyses(getActiveProfile(), userScope.scope, userScope.selectedUser);
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
		setPaginationLoadingState(false);
		PopupDom.criticalPendingButton.disabled = false;
	}
}

async function initializeSettingsView(savedSettings) {
	PopupRender.applySettingsToInputs(savedSettings);
	PopupState.activeProfile = String(savedSettings?.selectedProfile || PopupState.activeProfile || PROFILES.ANALYST).trim().toLowerCase();
	PopupState.settingsDraftProfile = PopupState.activeProfile;
	updateProfileSwitcherUi();
	await loadTokens(savedSettings.selectedTokenId || "");
	if (!PopupState.availableTokens.length) {
		populateEmptySettingsSelects();
		PopupState.availableProjectStates = [];
		PopupState.availableProjectWorkItemTypes = [];
		PopupState.currentProjectStatusMapping = normalizeStatusMapping({ configured: false, buckets: {} });
		renderStatusMappingSection();
		updateSettingsFormState();
		return;
	}

	const selectedTokenId = String(PopupDom.tokenSelect.value || savedSettings.selectedTokenId || "").trim();
	await loadTokenScopedSettings(selectedTokenId);

	updateSettingsFormState();
	markSettingsAsSaved();
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
		void (async () => {
			const canLeave = await confirmLeaveSettingsViewIfNeeded();
			if (!canLeave) return;
			clearTokenForm();
			showTokenSetupView(PopupState.availableTokens.length > 0);
			updateTokenFormState();
		})();
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
		await runSettingsAction(async () => {
			await loadProjects();
			await loadProjectStatusDiscoveryAndMapping();
		}, "Falha ao carregar projetos e status do projeto.");
	});

	PopupDom.projectSelect.addEventListener("change", async () => {
		updateSettingsFormState();
		await runSettingsAction(async () => {
			await loadTeams();
			await loadProjectStatusDiscoveryAndMapping();
		}, "Falha ao carregar times e status do projeto.");
	});

	PopupDom.teamSelect.addEventListener("change", async () => {
		updateSettingsFormState();
		await runSettingsAction(() => loadUsers(), "Falha ao carregar usuarios.");
	});

	const statusDropZones = [
		{ element: PopupDom.statusPool, zone: "pool" },
		{ element: PopupDom.pendingDropZone, zone: "pending" },
		{ element: PopupDom.validatingDropZone, zone: "validating" },
		{ element: PopupDom.finishedDropZone, zone: "finished" },
	];

	for (const zoneConfig of statusDropZones) {
		zoneConfig.element.addEventListener("dragover", (event) => {
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
		});

		zoneConfig.element.addEventListener("drop", (event) => {
			event.preventDefault();
			if (zoneConfig.element.classList.contains("disabled")) return;
			const statusName =
				String(event.dataTransfer?.getData("text/plain") || "").trim() ||
				String(PopupState.draggingStatusName || "").trim();
			moveStatusToZone(statusName, zoneConfig.zone);
		});
	}

	const profileButtons = [
		PopupDom.profileAnalystButton,
		PopupDom.profileTestsButton,
		PopupDom.profileManagementButton,
	];

	for (const button of profileButtons) {
		button.addEventListener("click", async () => {
			const profile = String(button.dataset.profile || PROFILES.ANALYST).trim().toLowerCase();
			PopupState.settingsDraftProfile =
				profile === PROFILES.TESTS ? PROFILES.TESTS : profile === PROFILES.MANAGEMENT ? PROFILES.MANAGEMENT : PROFILES.ANALYST;
			updateProfileSwitcherUi();
			await runSettingsAction(async () => {
				await loadProjectStatusDiscoveryAndMapping();
			}, "Falha ao alternar perfil na configuração.");
		});
	}

	const handleManagementUserChange = (event) => {
		const selected = String(event?.target?.value ?? "").trim();
		PopupState.managementSelectedUserId = selected;
		PopupDom.managementUserSelect.value = selected;
		PopupDom.managementUserSelectChanges.value = selected;
		persistUiStateIfNeeded();
		if (getActiveProfile() === PROFILES.MANAGEMENT) {
			runMetricsAction();
			if (!PopupDom.changesView.classList.contains("hidden")) {
				if (PopupState.currentListMode === "critical") {
					loadCriticalPendingAnalyses();
				} else if (String(PopupState.currentListMode || "").startsWith("metric:")) {
					loadMetricItemsByBucket(String(PopupState.currentListMode).slice("metric:".length));
				} else {
					loadRecentChanges();
				}
			}
		}
	};

	PopupDom.managementUserSelect.addEventListener("change", handleManagementUserChange);
	PopupDom.managementUserSelectChanges.addEventListener("change", handleManagementUserChange);

	PopupDom.sprintSelect.addEventListener("change", () => {
		persistUiStateIfNeeded();
		runMetricsAction();
	});

	PopupDom.includeCurrentDayToggle.addEventListener("change", () => {
		if (getActiveProfile() === PROFILES.TESTS) {
			PopupDom.includeCurrentDayToggle.checked = true;
			return;
		}
		persistUiStateIfNeeded();
		runMetricsAction();
	});

	PopupDom.includeCurrentDayHelperButton.addEventListener("click", () => {
		void requestConfirmation({
			title: "Como funciona o switch Dia atual",
			description:
				"Quando ativado, o cálculo considera os dias úteis da sprint até hoje, incluindo o dia atual.\n\n" +
				"Quando desativado, o cálculo considera apenas os dias úteis já concluídos, sem contar o dia de hoje.\n\n" +
				"Isso impacta principalmente a média diária mostrada nas métricas.",
			cancelText: "Fechar",
			showConfirmButton: false,
		});
	});

	PopupDom.result.addEventListener("click", (event) => {
		const analystChartRow = event.target?.closest?.("[data-analyst-full-name]");
		if (analystChartRow && getActiveProfile() === PROFILES.MANAGEMENT) {
			const analystName = sanitizeDisplayedUserName(String(analystChartRow.getAttribute("data-analyst-full-name") || "").trim());
			if (!analystName) return;

			const normalizedAnalystName = analystName.toLowerCase();
			const matchingUser = (PopupState.availableUsers || []).find((user) => {
				const candidates = [user?.label, user?.name, user?.uniqueName]
					.map((candidate) => sanitizeDisplayedUserName(candidate || "").toLowerCase())
					.filter(Boolean);
				return candidates.includes(normalizedAnalystName);
			});

			if (matchingUser?.value) {
				const selectedValue = String(matchingUser.value).trim();
				if (selectedValue && PopupDom.managementUserSelect.value !== selectedValue) {
					PopupDom.managementUserSelect.value = selectedValue;
					PopupDom.managementUserSelect.dispatchEvent(new Event("change", { bubbles: true }));
				}
			}
			return;
		}

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
			updateBottomPaginationVisibility();
		},
		{ passive: true },
	);

	window.addEventListener("resize", () => {
		updateBottomPaginationVisibility();
	});

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

	PopupDom.previousPageButtonBottom.addEventListener("click", () => {
		if (PopupState.currentListPage <= 1) return;
		PopupState.currentListPage -= 1;
		renderCurrentListPage({ mode: PopupState.currentListMode });
	});

	PopupDom.nextPageButtonBottom.addEventListener("click", () => {
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

	PopupDom.itemsPerPageSelectBottom.addEventListener("change", () => {
		PopupState.itemsPerPage = normalizeItemsPerPage(PopupDom.itemsPerPageSelectBottom.value);
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
		const canLeave = await confirmLeaveSettingsViewIfNeeded();
		if (!canLeave) return;
		PopupState.settingsDraftProfile = PopupState.activeProfile;

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
		void (async () => {
			if (getActiveProfile() !== PROFILES.MANAGEMENT) {
				openItemInAzure(PopupState.currentDetailItemUrl);
				return;
			}

			const detailItem = PopupState.currentListItems.find((item) => String(item?.id || "") === String(PopupState.currentDetailItemId || ""));
			if (!detailItem) {
				PopupRender.showResult("Não foi possível localizar os dados do item selecionado.");
				return;
			}

			const responsibleName =
				sanitizeDisplayedUserName(detailItem?.assignedTo?.displayName || detailItem?.assignedTo?.name) || "responsável";
			const confirmed = await requestConfirmation({
				title: "Requerir análise crítica",
				description: `Isso adicionará um comentário na discussion do item no Azure, mencionando ${responsibleName}. Deseja continuar?`,
				confirmText: "Confirmar",
				cancelText: "Cancelar",
			});
			if (!confirmed) return;

			await runSettingsAction(async () => {
				const response = await PopupApi.requireCriticalAnalysis(
					PopupState.currentDetailItemId,
					detailItem.assignedTo || null,
					getActiveProfile(),
				);
				if (!response?.ok) {
					throw new Error(response?.error || "Falha ao solicitar análise crítica.");
				}
				PopupRender.showSettingsStatus("Solicitação de análise crítica enviada com sucesso.");
			}, "Falha ao solicitar análise crítica.");
		})();
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

		const buckets = getStatusBucketsFromDraft();
		const hasMissingBucket =
			getSettingsDraftProfile() === PROFILES.TESTS
				? !buckets.pending.length || !buckets.validating.length
				: !buckets.pending.length || !buckets.validating.length || !buckets.finished.length;
		if (hasMissingBucket) {
			const labels = getStatusRegionLabelsByProfile(getSettingsDraftProfile());
			const confirmed = await requestConfirmation({
				title: "Mapeamento de status incompleto",
				description:
					`Nem todas as regiões (${labels.pending}, ${labels.validating} e ${labels.finished}) possuem status. Deseja salvar mesmo assim?`,
				confirmText: "Salvar mesmo assim",
				cancelText: "Voltar",
			});

			if (!confirmed) {
				showSettingsView();
				PopupDom.statusMappingStatus.classList.remove("hidden");
				PopupDom.statusMappingStatus.textContent =
					"Revise o mapeamento de status antes de salvar as configurações.";
				return;
			}
		}

		PopupDom.saveSettingsButton.disabled = true;
		PopupRender.showSettingsStatus("Salvando configuracoes...");

		await runSettingsAction(async () => {
			await saveCurrentSettings();
			await commitActiveProfile(getSettingsDraftProfile());
			PopupState.hasCompleteSettings = true;
			if (!PopupState.availableProjectStates.length) {
				await loadProjectStatusDiscoveryAndMapping();
			}

			await saveCurrentProjectStatusMapping();
			markSettingsAsSaved();
			PopupDom.statusMappingStatus.classList.remove("hidden");
			PopupDom.statusMappingStatus.textContent = "Mapeamento de status salvo com sucesso.";

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
		const savedProfile = await getSavedProfile();
		PopupState.activeProfile = String(savedUiState?.profile || savedProfile || PROFILES.ANALYST).trim().toLowerCase();
		PopupState.settingsDraftProfile = PopupState.activeProfile;
		updateProfileSwitcherUi();
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
		await withBlockingUi(() => loadProjectStatusDiscoveryAndMapping());
		if (!isStatusMappingConfigured(PopupState.currentProjectStatusMapping)) {
			showSettingsView();
			PopupDom.statusMappingStatus.classList.remove("hidden");
			PopupDom.statusMappingStatus.textContent =
				"Mapeamento obrigatório: configure os status do projeto antes de usar métricas e listagens.";
			return;
		}

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
		applyProfileUiRules();
		persistUiStateIfNeeded();
		updatePaginationControls();
		updateBottomPaginationVisibility();
		updateTokenFormState();
		updateSettingsFormState();
	}
}

window.PopupApp = {
	init,
};

bindEvents();
