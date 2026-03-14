function showResult(text) {
	PopupDom.result.classList.remove("metrics-result");
	PopupDom.result.textContent = text;
	PopupDom.result.classList.remove("hidden");
}

function formatHoursAndMinutes(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return "0h 00min";
	const totalMinutes = Math.round(numeric * 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h ${String(minutes).padStart(2, "0")}min`;
}

function getAverageFeedback(dailyAverage) {
	const avg = Number(dailyAverage);
	if (avg >= 8) {
		return {
			icon: "🎆",
			text: "Tu é inacreditável! Que incrível!",
			variantClass: "feedback-lilac",
		};
	}

	if (avg >= 7) {
		return {
			icon: "📈",
			text: "Suas métricas estão ótimas!",
			variantClass: "feedback-green",
		};
	}

	if (avg >= 5) {
		return {
			icon: "📉",
			text: "Atenção às horas registradas!",
			variantClass: "feedback-yellow",
		};
	}

	return {
		icon: "❗",
		text: "Suas métricas não estão boas. Verifique com seu gestor.",
		variantClass: "feedback-red",
	};
}

function createMetricTile(title, value, valueClass) {
	return `
		<div class="metric-tile">
			<div class="metric-title">${title}</div>
			<div class="metric-value ${valueClass}">${value}</div>
		</div>
	`;
}

function createSkeletonTile(extraClass = "") {
	return `
		<div class="metric-tile metric-tile-skeleton ${extraClass}">
			<div class="skeleton-line skeleton-title shimmer"></div>
			<div class="skeleton-line skeleton-value shimmer"></div>
		</div>
	`;
}

function renderMetricsSkeleton() {
	return `
		<div class="metrics-wrap metrics-wrap-skeleton">
			<div class="metrics-sprint-title-skeleton shimmer"></div>
			<div class="metrics-grid metrics-grid-primary">
				${createSkeletonTile()}
				${createSkeletonTile()}
				${createSkeletonTile()}
				${createSkeletonTile()}
			</div>
			<div class="metrics-grid metrics-grid-secondary">
				${createSkeletonTile()}
				${createSkeletonTile()}
				${createSkeletonTile()}
			</div>
			<div class="metrics-feedback-skeleton shimmer"></div>
		</div>
	`;
}

function renderMetrics(metrics) {
	const feedback = getAverageFeedback(metrics.dailyAverage);
	const sprintLabel = String(metrics.selectedSprintLabel || "-");
	const startedTasks = Number.isFinite(Number(metrics.startedTasks)) ? Number(metrics.startedTasks) : 0;
	const pendingTasks = Number.isFinite(Number(metrics.pendingTasks)) ? Number(metrics.pendingTasks) : 0;
	const validatingTasks = Number.isFinite(Number(metrics.validatingTasks)) ? Number(metrics.validatingTasks) : 0;
	const finishedTasks = Number.isFinite(Number(metrics.finishedTasks)) ? Number(metrics.finishedTasks) : 0;
	const consideredDays = Number.isFinite(Number(metrics.completedDays)) ? Number(metrics.completedDays) : 0;
	const hoursLabel = formatHoursAndMinutes(metrics.sumHours);
	const averageLabel = formatHoursAndMinutes(metrics.dailyAverage);

	return `
		<div class="metrics-wrap">
			<div class="metrics-sprint-title">Tarefas - ${sprintLabel}</div>
			<div class="metrics-grid metrics-grid-primary">
				${createMetricTile("Iniciadas", String(startedTasks), "metric-value-lilac")}
				${createMetricTile("Andamento", String(pendingTasks), "metric-value-blue")}
				${createMetricTile("Validando", String(validatingTasks), "metric-value-yellow")}
				${createMetricTile("Finalizadas", String(finishedTasks), "metric-value-green")}
			</div>
			<div class="metrics-grid metrics-grid-secondary">
				${createMetricTile("Dias", String(consideredDays), "metric-value-gray-secondary")}
				${createMetricTile("Horas", hoursLabel, "metric-value-gray-secondary metric-value-medium")}
				${createMetricTile("Média", averageLabel, "metric-value-gray-secondary metric-value-medium")}
			</div>
			<div class="metrics-feedback ${feedback.variantClass}">
				<span class="metrics-feedback-icon">${feedback.icon}</span>
				<span class="metrics-feedback-text">${feedback.text}</span>
			</div>
		</div>
	`;
}

function showMetrics(metrics) {
	PopupDom.result.classList.add("metrics-result");
	PopupDom.result.innerHTML = renderMetrics(metrics);
	PopupDom.result.classList.remove("hidden");
}

function showMetricsSkeleton() {
	PopupDom.result.classList.add("metrics-result");
	PopupDom.result.innerHTML = renderMetricsSkeleton();
	PopupDom.result.classList.remove("hidden");
}

function renderRecentChangesSkeleton(itemCount = 3) {
	const total = Math.max(1, Number(itemCount) || 5);
	return Array.from({ length: total })
		.map(
			() => `
				<div class="recent-item recent-item-skeleton">
					<div class="recent-item-header">
						<span class="item-id-chip skeleton-chip shimmer"></span>
						<div class="recent-item-title skeleton-line skeleton-row-title shimmer"></div>
					</div>
					<div class="recent-item-row">
						<span class="skeleton-line skeleton-row-left shimmer"></span>
						<span class="skeleton-line skeleton-row-right shimmer"></span>
					</div>
					<div class="recent-item-row">
						<span class="skeleton-line skeleton-row-left shimmer"></span>
						<span class="skeleton-line skeleton-row-right shimmer"></span>
					</div>
				</div>
			`,
		)
		.join("");
}

function showRecentChangesSkeleton(itemCount = 3) {
	PopupDom.recentList.innerHTML = renderRecentChangesSkeleton(itemCount);
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
	showMetrics,
	showMetricsSkeleton,
	showRecentChangesSkeleton,
	showSettingsStatus,
	showTokenStatus,
	populateSelect,
	populateSprintSelect,
	isCompleteSettings,
	applySettingsToInputs,
	buildItemCard,
	renderMetrics,
	formatMetrics,
};
