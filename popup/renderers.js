function showResult(text) {
	PopupDom.result.textContent = text;
	PopupDom.result.classList.remove("hidden");
}

function showSettingsStatus(text, isError = false) {
	PopupDom.settingsStatus.textContent = text;
	PopupDom.settingsStatus.classList.remove("hidden");
	PopupDom.settingsStatus.style.borderLeftColor = isError ? "#d13438" : "#107c10";
}

function showTokenStatus(text, isError = false) {
	PopupDom.tokenStatus.textContent = text;
	PopupDom.tokenStatus.classList.remove("hidden");
	PopupDom.tokenStatus.style.borderLeftColor = isError ? "#d13438" : "#107c10";
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

function isCompleteSettings(settings) {
	return Boolean(
		settings.selectedTokenId &&
			settings.organization &&
			settings.projectId &&
			settings.projectName &&
			settings.teamId &&
			settings.teamName,
	);
}

function applySettingsToInputs(settings) {
	if (PopupDom.organizationSelect) {
		PopupDom.organizationSelect.value = settings.organization || "";
	}
	if (PopupDom.tokenSelect) {
		PopupDom.tokenSelect.value = settings.selectedTokenId || "";
	}
	PopupState.hasCompleteSettings = isCompleteSettings(settings);
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
	if (!Number.isFinite(numeric)) return "0";
	if (Number.isInteger(numeric)) return String(numeric);
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
	if (clickable) card.type = "button";
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

function populateSprintSelect(sprints, defaultSprint) {
	PopupDom.sprintSelect.innerHTML = "";
	for (const sprint of sprints || []) {
		const option = document.createElement("option");
		option.value = sprint.value;
		option.textContent = sprint.label;
		PopupDom.sprintSelect.appendChild(option);
	}
	PopupDom.sprintSelect.value = defaultSprint || "";
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

window.PopupRender = {
	showResult,
	showSettingsStatus,
	showTokenStatus,
	populateSelect,
	populateSprintSelect,
	isCompleteSettings,
	applySettingsToInputs,
	buildItemCard,
	formatMetrics,
};
