function showResult(text) {
	PopupDom.controlsSkeletonBar.classList.add("hidden");
	PopupDom.mainControlsRow.classList.remove("hidden");
	PopupDom.recentButton.classList.remove("loading-skeleton-button");
	PopupDom.criticalPendingButton.classList.remove("loading-skeleton-button");
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

function escapeHtmlAttribute(value) {
	return String(value || "")
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
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

function createMetricTile(title, value, valueClass, metricBucket = "") {
	const bucket = String(metricBucket || "").trim();
	const clickableClass = bucket ? " metric-tile-clickable" : "";
	const dataMetricBucket = bucket ? ` data-metric-bucket="${bucket}"` : "";
	return `
		<div class="metric-tile${clickableClass}"${dataMetricBucket}>
			<div class="metric-title">${title}</div>
			<div class="metric-value ${valueClass}">${value}</div>
		</div>
	`;
}

function getTrendArrowSymbol(direction) {
	if (direction === "up-right") return "↗";
	if (direction === "right") return "→";
	return "↘";
}

function createTrendTile(trendSummary) {
	const status = String(trendSummary?.status || "off-track").trim().toLowerCase();
	const direction = String(trendSummary?.arrowDirection || "down-right").trim().toLowerCase();
	const arrowClass =
		status === "on-track"
			? "trend-arrow-green"
			: status === "at-risk"
				? "trend-arrow-yellow"
				: "trend-arrow-red";
	const symbol = getTrendArrowSymbol(direction);

	return `
		<div class="metric-tile metric-tile-clickable trend-metric-tile" data-metric-bucket="trend">
			<div class="metric-title">Tendência</div>
			<div class="trend-arrow ${arrowClass}" aria-label="Tendência da sprint">${symbol}</div>
		</div>
	`;
}

function formatTrendPointValues(values = []) {
	return (Array.isArray(values) ? values : []).map((value) => {
		const numeric = Number(value || 0);
		if (!Number.isFinite(numeric) || numeric < 0) return 0;
		return Number(numeric.toFixed(4));
	});
}

function buildTrendPolyline(values, width, height, maxValue) {
	const points = formatTrendPointValues(values);
	if (!points.length) return "";
	if (points.length === 1) {
		const y = height - (maxValue > 0 ? (points[0] / maxValue) * height : 0);
		return `0,${y.toFixed(2)} ${width},${y.toFixed(2)}`;
	}

	const step = width / Math.max(1, points.length - 1);
	return points
		.map((value, index) => {
			const x = step * index;
			const y = height - (maxValue > 0 ? (value / maxValue) * height : 0);
			return `${x.toFixed(2)},${Math.max(0, Math.min(height, y)).toFixed(2)}`;
		})
		.join(" ");
}

function renderTrendInsight(summary = {}, sprintLabel = "") {
	const status = String(summary?.status || "off-track").trim().toLowerCase();
	const feedbackText = String(summary?.feedbackText || "Sem dados suficientes para analisar a tendência da sprint.").trim();
	const labels = Array.isArray(summary?.series?.labels) ? summary.series.labels : [];
	const idealValues = formatTrendPointValues(summary?.series?.ideal || []);
	const remainingValues = formatTrendPointValues(summary?.series?.remaining || []);
	const allValues = [...idealValues, ...remainingValues];
	const maxValue = Math.max(1, ...allValues);
	const chartWidth = 620;
	const chartHeight = 220;
	const idealPoints = buildTrendPolyline(idealValues, chartWidth, chartHeight, maxValue);
	const remainingPoints = buildTrendPolyline(remainingValues, chartWidth, chartHeight, maxValue);
	const firstLabel = labels[0] || "-";
	const middleLabel = labels.length > 2 ? labels[Math.floor(labels.length / 2)] : labels[1] || labels[0] || "-";
	const lastLabel = labels[labels.length - 1] || "-";
	const feedbackClass =
		status === "on-track"
			? "trend-feedback-ok"
			: status === "at-risk"
				? "trend-feedback-risk"
				: "trend-feedback-fail";

	if (!labels.length || !idealValues.length || !remainingValues.length) {
		return `
			<div class="trend-view-wrap">
				<div class="trend-view-title">Tendência - ${sprintLabel || "-"}</div>
				<div class="trend-view-empty">Não foi possível montar o gráfico de tendência para esta sprint.</div>
				<div class="trend-feedback ${feedbackClass}">${feedbackText}</div>
			</div>
		`;
	}

	return `
		<div class="trend-view-wrap">
			<div class="trend-view-title">Tendência - ${sprintLabel || "-"}</div>
			<div class="trend-chart-wrap">
				<svg class="trend-chart-svg" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="Grafico de tendencia da sprint">
					<line x1="0" y1="0" x2="0" y2="${chartHeight}" class="trend-axis" />
					<line x1="0" y1="${chartHeight}" x2="${chartWidth}" y2="${chartHeight}" class="trend-axis" />
					<polyline points="${idealPoints}" class="trend-line-ideal" />
					<polyline points="${remainingPoints}" class="trend-line-remaining" />
				</svg>
				<div class="trend-legend">
					<span class="trend-legend-item"><span class="trend-legend-dot trend-legend-dot-ideal"></span>Ideal</span>
					<span class="trend-legend-item"><span class="trend-legend-dot trend-legend-dot-remaining"></span>Remaining</span>
				</div>
				<div class="trend-x-labels">
					<span>${firstLabel}</span>
					<span>${middleLabel}</span>
					<span>${lastLabel}</span>
				</div>
			</div>
			<div class="trend-feedback ${feedbackClass}">${feedbackText}</div>
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
			<div class="metrics-unified-grid">
				${createSkeletonTile()}
				${createSkeletonTile()}
				${createSkeletonTile()}
				${createSkeletonTile()}
				${createSkeletonTile()}
				${createSkeletonTile()}
				${createSkeletonTile()}
				${createSkeletonTile()}
			</div>
			<div class="metrics-feedback-skeleton shimmer"></div>
		</div>
	`;
}

function renderMetrics(metrics) {
	const profile = String(metrics?.profile || PopupState?.activeProfile || "analyst").trim().toLowerCase();
	const hasCapacity = Boolean(metrics?.hasCapacity !== false);
	const sprintLabel = String(metrics.selectedSprintLabel || "-");
	const startedTasks = Number.isFinite(Number(metrics.startedTasks)) ? Number(metrics.startedTasks) : 0;
	const pendingTasks = Number.isFinite(Number(metrics.pendingTasks)) ? Number(metrics.pendingTasks) : 0;
	const validatingTasks = Number.isFinite(Number(metrics.validatingTasks)) ? Number(metrics.validatingTasks) : 0;
	const finishedTasks = Number.isFinite(Number(metrics.finishedTasks)) ? Number(metrics.finishedTasks) : 0;
	const consideredDays = Number.isFinite(Number(metrics.completedDays)) ? Number(metrics.completedDays) : 0;
	const hoursLabel = formatHoursAndMinutes(metrics.sumHours);
	const remainingWorkLabel = String(Math.max(0, Math.round(Number(metrics.remainingWorkTotal) || 0)));
	const averageLabel = hasCapacity ? formatHoursAndMinutes(metrics.dailyAverage) : "Sem capacity";
	const averageValueClass = hasCapacity
		? "metric-value-gray-secondary metric-value-medium"
		: "metric-value-gray-secondary metric-value-medium metric-value-small-text";
	const feedback = getAverageFeedback(metrics.dailyAverage);
	const shouldHideFeedbackForAllAnalysts =
		profile === "management" && !String(PopupState?.managementSelectedUserId || "").trim();
	const shouldHideFeedbackForNoCapacity = !hasCapacity;
	const shouldUseManagementAllAnalystsLayout =
		profile === "management" && !String(PopupState?.managementSelectedUserId || "").trim();
	const notStartedCount = Number.isFinite(Number(metrics.notStartedCount)) ? Number(metrics.notStartedCount) : 0;
	const recentChangesCount = Number.isFinite(Number(metrics.recentChangesCount)) ? Number(metrics.recentChangesCount) : 0;
	const criticalPendingCount = Number.isFinite(Number(metrics.criticalPendingCount)) ? Number(metrics.criticalPendingCount) : 0;
	const unassignedCount = Number.isFinite(Number(metrics.unassignedCount)) ? Number(metrics.unassignedCount) : 0;
	const trendSummary = metrics?.trendSummary || {};

	if (profile === "tests") {
		const pendingTasks = Number.isFinite(Number(metrics.pendingTasks)) ? Number(metrics.pendingTasks) : 0;
		const releaseTasks = Number.isFinite(Number(metrics.validatingTasks)) ? Number(metrics.validatingTasks) : 0;
		const totalTasks = Number.isFinite(Number(metrics.totalTasks))
			? Number(metrics.totalTasks)
			: pendingTasks + releaseTasks;
		const releasedPerDay = Array.isArray(metrics.releasedPerDay)
			? metrics.releasedPerDay
			: Array.isArray(metrics.finishedPerDay)
				? metrics.finishedPerDay
				: [];
		const releasedTotal = releasedPerDay.reduce((total, entry) => total + Number(entry?.count || 0), 0);
		const maxCount = Math.max(1, ...releasedPerDay.map((entry) => Number(entry?.count || 0)));
		const chartMarkup = releasedPerDay.length
			? releasedPerDay
					.map((entry) => {
						const dateKey = String(entry?.dateKey || "").trim();
						let label = "-";
						if (dateKey) {
							const parts = dateKey.split("-");
							if (parts.length === 3) {
								label = `${parts[2]}/${parts[1]}`;
							}
						}
						const count = Number(entry?.count || 0);
						const height = Math.max(6, Math.round((count / maxCount) * 64));
						const barClass = entry?.outsideSprintRange
							? "tests-chart-bar tests-chart-bar-outside"
							: entry?.nonBusinessDay
								? "tests-chart-bar tests-chart-bar-non-business"
								: "tests-chart-bar";
						return `
							<div class="tests-chart-column" title="${label}: ${count}">
								<div class="${barClass}" style="height:${height}px"></div>
								<div class="tests-chart-count">${count}</div>
								<div class="tests-chart-label">${label}</div>
							</div>
						`;
					})
					.join("")
			: '<div class="tests-chart-empty">Sem movimentações para liberados no período.</div>';

		return `
			<div class="metrics-wrap">
				<div class="metrics-sprint-title">Testes - ${sprintLabel}</div>
				<div class="metrics-unified-grid metrics-unified-grid-tests">
					${createMetricTile("Total", String(totalTasks), "metric-value-lilac", "started")}
					${createMetricTile("Pendentes", String(pendingTasks), "metric-value-yellow", "pending")}
					${createMetricTile("Liberados", String(releaseTasks), "metric-value-green", "validating")}
					${createMetricTile("Dias", String(consideredDays), "metric-value-gray-secondary")}
					<div class="tests-chart-wrap metrics-unified-span-4 metrics-tests-chart-span-two-rows">
						<div class="tests-chart-title-row">
							<div class="tests-chart-title">Testes liberados por dia</div>
							<div class="tests-chart-total">Total: ${releasedTotal}</div>
						</div>
						<div class="tests-chart-grid">${chartMarkup}</div>
					</div>
				</div>
			</div>
		`;
	}

	const analystHours = Array.isArray(metrics.analystHours)
		? metrics.analystHours
				.map((entry) => {
					const fullName = sanitizeDisplayedUserName(entry?.name || "") || "Nao atribuido";
					const name = shortenUserNameToTwoParts(fullName) || "Nao atribuido";
					const totalHours = Number(entry?.totalHours || 0);
					return {
						fullName,
						name,
						totalHours: Number.isFinite(totalHours) && totalHours > 0 ? totalHours : 0,
					};
				})
				.sort((left, right) => Number(right.totalHours || 0) - Number(left.totalHours || 0))
		: [];
	const maxAnalystHours = Math.max(1, ...analystHours.map((entry) => Number(entry.totalHours || 0)));
	const strongPalette = ["#005fb8", "#b42318", "#0f7a31", "#6a1b9a", "#b05e00", "#0b6e4f", "#8f1d4f", "#1d4ed8", "#7a2e0b", "#006e8a", "#9f1239", "#5b21b6"];
	const analystBarRowsMarkup = analystHours.length
		? analystHours
				.map((entry, index) => {
					const widthPercent = Math.max(0, Math.min(100, Math.round((Number(entry.totalHours || 0) / maxAnalystHours) * 100)));
					const color = strongPalette[index % strongPalette.length];
					const analystFullName = escapeHtmlAttribute(entry.fullName || entry.name || "");
					return `
						<div class="management-hours-row management-hours-row-clickable" data-analyst-full-name="${analystFullName}" title="Filtrar por ${analystFullName}">
							<div class="management-hours-row-header">
								<span class="management-hours-analyst-name">${entry.name}</span>
								<span class="management-hours-analyst-average">${formatHoursAndMinutes(entry.totalHours)}</span>
							</div>
							<div class="management-hours-bar-track">
								<div class="management-hours-bar-fill" style="width:${widthPercent}%; background:${color};"></div>
							</div>
						</div>
					`;
				})
				.join("")
		: '<div class="management-hours-empty">Sem horas registradas por analista nesta sprint.</div>';

	if (shouldUseManagementAllAnalystsLayout) {
		const roundedHours = Math.max(0, Math.round(Number(metrics.sumHours) || 0));
		return `
			<div class="metrics-wrap">
				<div class="metrics-sprint-title">Tarefas - ${sprintLabel}</div>
				<div class="metrics-management-all-grid">
					<div class="metrics-management-primary-tile">
						${createMetricTile("Iniciadas", String(startedTasks), "metric-value-lilac", "started")}
					</div>
					<div class="metrics-management-primary-tile">
						${createMetricTile("Andamento", String(pendingTasks), "metric-value-blue", "pending")}
					</div>
					<div class="metrics-management-primary-tile">
						${createMetricTile("Validando", String(validatingTasks), "metric-value-yellow", "validating")}
					</div>
					<div class="metrics-management-primary-tile">
						${createMetricTile("Finalizadas", String(finishedTasks), "metric-value-green", "finished")}
					</div>
					<div class="metrics-management-secondary-tile">
						${createMetricTile("Não iniciadas", String(notStartedCount), "metric-value-dark", "not-started")}
					</div>
					<div class="metrics-management-secondary-tile">
						${createMetricTile("Restante", remainingWorkLabel, "metric-value-gray-secondary")}
					</div>
					<div class="metrics-management-secondary-tile">
						${createMetricTile("Sem dono", String(unassignedCount), "metric-value-dark", "unassigned")}
					</div>
					<div class="metrics-management-secondary-tile">
						${createTrendTile(trendSummary)}
					</div>
					<div class="metrics-management-days-slot">
						${createMetricTile("Dias", String(consideredDays), "metric-value-gray-secondary")}
					</div>
					<div class="metrics-management-hours-slot">
						${createMetricTile("Horas", String(roundedHours), "metric-value-gray-secondary")}
					</div>
					<div class="management-hours-chart-wrap">
						<div class="management-hours-chart-scroll">
							${analystBarRowsMarkup}
						</div>
					</div>
				</div>
			</div>
		`;
	}

	return `
		<div class="metrics-wrap">
			<div class="metrics-sprint-title">Tarefas - ${sprintLabel}</div>
			<div class="metrics-unified-grid metrics-unified-grid-analyst">
				${createMetricTile("Iniciadas", String(startedTasks), "metric-value-lilac", "started")}
				${createMetricTile("Andamento", String(pendingTasks), "metric-value-blue", "pending")}
				${createMetricTile("Validando", String(validatingTasks), "metric-value-yellow", "validating")}
				${createMetricTile("Finalizadas", String(finishedTasks), "metric-value-green", "finished")}
				${createMetricTile("Não iniciadas", String(notStartedCount), "metric-value-dark", "not-started")}
				${createMetricTile("Restante", remainingWorkLabel, "metric-value-gray-secondary")}
				${createMetricTile("Recentes", String(recentChangesCount), "metric-value-pink", "recent")}
				${createMetricTile("Críticas", String(criticalPendingCount), "metric-value-red", "critical")}
				${createMetricTile("Dias", String(consideredDays), "metric-value-gray-secondary")}
				<div class="metrics-secondary-split-wrap">
					${createMetricTile("Horas", hoursLabel, "metric-value-gray-secondary metric-value-medium")}
					${createMetricTile("Média", averageLabel, averageValueClass)}
				</div>
			</div>
			${
				shouldHideFeedbackForAllAnalysts || shouldHideFeedbackForNoCapacity
					? ""
					: `
						<div class="metrics-feedback ${feedback.variantClass}">
							<span class="metrics-feedback-icon">${feedback.icon}</span>
							<span class="metrics-feedback-text">${feedback.text}</span>
						</div>
					`
			}
		</div>
	`;
}

function showMetrics(metrics) {
	PopupDom.controlsSkeletonBar.classList.add("hidden");
	PopupDom.mainControlsRow.classList.remove("hidden");
	PopupDom.recentButton.classList.remove("loading-skeleton-button");
	PopupDom.criticalPendingButton.classList.remove("loading-skeleton-button");
	PopupDom.result.classList.add("metrics-result");
	PopupDom.result.innerHTML = renderMetrics(metrics);
	PopupDom.result.classList.remove("hidden");

	if (String(metrics?.profile || "").trim().toLowerCase() === "tests") {
		const chartGrid = PopupDom.result.querySelector(".tests-chart-grid");
		if (chartGrid) {
			requestAnimationFrame(() => {
				chartGrid.scrollLeft = chartGrid.scrollWidth;
			});
		}
	}
}

function showMetricsSkeleton() {
	PopupDom.mainControlsRow.classList.add("hidden");
	PopupDom.controlsSkeletonBar.classList.remove("hidden");
	PopupDom.recentButton.classList.add("loading-skeleton-button");
	PopupDom.criticalPendingButton.classList.add("loading-skeleton-button");
	PopupDom.result.classList.add("metrics-result");
	PopupDom.result.innerHTML = renderMetricsSkeleton();
	PopupDom.result.classList.remove("hidden");
}

function renderRecentChangesSkeleton(itemCount = 3, { mode = "recent" } = {}) {
	const total = Math.max(1, Number(itemCount) || 5);
	const isCriticalMode = mode === "critical";
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
					${
						isCriticalMode
							? '<div class="critical-alert-text-skeleton shimmer"></div>'
							: ""
					}
				</div>
			`,
		)
		.join("");
}

function showRecentChangesSkeleton(itemCount = 3, options = {}) {
	PopupDom.recentList.innerHTML = renderRecentChangesSkeleton(itemCount, options);
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
	const mappedColor = String(PopupState?.currentProjectStatusMapping?.stateColors?.[value] || "").trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(mappedColor)) {
		return mappedColor;
	}
	if (value === "pause") return "var(--state-pause)";
	if (value === "in progress" || value === "doing") return "var(--state-inprogress)";
	if (value === "to refactor" || value === "approved" || value === "to do") return "var(--state-neutral)";
	if (value === "to test") return "var(--state-test)";
	if (value === "to release") return "var(--state-release)";
	if (value === "to merge") return "var(--state-review)";
	if (value === "done") return "var(--state-done)";
	return "#d0d0d4";
}

function formatNumber(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return "0";
	if (Number.isInteger(numeric)) return String(numeric);
	return numeric.toFixed(4).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
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

function createFieldIcon(symbol, title, variant = "") {
	const icon = document.createElement("span");
	icon.className = `item-field-icon ${variant}`.trim();
	icon.textContent = symbol;
	icon.title = title;
	icon.setAttribute("aria-label", title);
	return icon;
}

function getStatusTransitionParts(value) {
	const text = String(value || "").trim();
	if (!text) {
		return { from: "-", to: "-" };
	}
	const parts = text.split("->").map((part) => String(part || "").trim()).filter(Boolean);
	if (parts.length < 2) {
		return { from: text, to: "-" };
	}
	return { from: parts[0], to: parts[1] };
}

function formatDateDdMmYyyy(date) {
	const day = String(date.getDate()).padStart(2, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const year = String(date.getFullYear());
	return `${day}/${month}/${year}`;
}

function formatDateDdMmYyyyHhMm(date) {
	const baseDate = formatDateDdMmYyyy(date);
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `${baseDate} ${hours}:${minutes}`;
}

function formatRelativeTransitionDate(value) {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return { text: "", title: "" };
	}

	const now = new Date();
	const diffMs = Math.max(0, now.getTime() - parsed.getTime());
	const oneHourMs = 60 * 60 * 1000;
	const oneDayMs = 24 * oneHourMs;
	const totalHours = Math.floor(diffMs / oneHourMs);

	const nowDay = new Date(now);
	nowDay.setHours(0, 0, 0, 0);
	const parsedDay = new Date(parsed);
	parsedDay.setHours(0, 0, 0, 0);
	const totalDays = Math.max(0, Math.floor((nowDay.getTime() - parsedDay.getTime()) / oneDayMs));

	if (totalDays === 0) {
		const hours = Math.max(1, totalHours);
		return { text: `há ${hours}h`, title: formatDateDdMmYyyyHhMm(parsed) };
	}

	if (totalDays === 1) {
		return { text: "ontem", title: formatDateDdMmYyyyHhMm(parsed) };
	}

	if (totalDays < 7) {
		const weekDays = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
		return { text: weekDays[parsed.getDay()] || "", title: formatDateDdMmYyyyHhMm(parsed) };
	}

	if (totalDays < 30) {
		const weeks = Math.floor(totalDays / 7);
		return { text: weeks <= 1 ? "há 1 semana" : `há ${weeks} semanas`, title: formatDateDdMmYyyyHhMm(parsed) };
	}

	if (totalDays < 365) {
		const months = Math.floor(totalDays / 30);
		return { text: months <= 1 ? "há 1 mês" : `há ${months} meses`, title: formatDateDdMmYyyyHhMm(parsed) };
	}

	const years = Math.floor(totalDays / 365);
	return { text: years <= 1 ? "há 1 ano" : `há ${years} anos`, title: formatDateDdMmYyyyHhMm(parsed) };
}

function createTagChip(text) {
	const chip = document.createElement("span");
	chip.className = "tag-chip";
	chip.textContent = text;
	return chip;
}

function getIdentityDisplayName(identity) {
	if (!identity) return "-";
	if (typeof identity === "string") return shortenUserNameToTwoParts(identity) || "-";
	const displayName = String(identity.displayName || identity.name || identity.uniqueName || "").trim();
	const normalizedDisplayName = shortenUserNameToTwoParts(displayName);
	if (normalizedDisplayName) return normalizedDisplayName;
	return "-";
}

function buildItemCard(item, { clickable = true, criticalAlertText = "", profile = "analyst" } = {}) {
	const typeClass = `type-${normalizeType(item.type)}`;
	const card = document.createElement(clickable ? "button" : "div");
	if (clickable) card.type = "button";
	card.className = `recent-item ${typeClass}`;
	const normalizedProfile = String(profile || PopupState?.activeProfile || "analyst").trim().toLowerCase();

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
	if (normalizedProfile === "tests") {
		estimated.appendChild(createFieldIcon("🛠", "Responsável:", "item-field-icon-dev"));
		estimated.append(shortenUserNameToTwoParts(getIdentityDisplayName(item.assignedTo)) || "-");
	} else {
		estimated.textContent = `Estimated: ${formatNumber(item.estimated)}`;
	}

	const state = document.createElement("span");
	state.className = "item-state";
	state.textContent = item.state || "-";
	state.style.color = getStateColor(item.state);

	estimateStateRow.appendChild(estimated);
	estimateStateRow.appendChild(state);

	const completedSprintRow = document.createElement("div");
	completedSprintRow.className = "recent-item-row";

	const completed = document.createElement("span");
	if (normalizedProfile === "tests") {
		completed.appendChild(createFieldIcon("⇄", "Movimentado:", "item-field-icon-move"));
		completed.append(shortenUserNameToTwoParts(item.lastStateChangedByName) || "-");
	} else {
		completed.textContent = `Completed: ${formatNumber(item.completed)}`;
	}

	const sprint = document.createElement("span");
	sprint.className = "item-sprint";
	sprint.textContent = item.sprint || "Sem sprint";

	completedSprintRow.appendChild(completed);
	completedSprintRow.appendChild(sprint);

	card.appendChild(header);
	card.appendChild(estimateStateRow);
	card.appendChild(completedSprintRow);

	if (normalizedProfile === "management") {
		const responsibleRow = document.createElement("div");
		responsibleRow.className = "recent-item-row";
		const responsible = document.createElement("span");
		responsible.appendChild(createFieldIcon("🛠", "Responsável:", "item-field-icon-dev"));
		responsible.append(shortenUserNameToTwoParts(getIdentityDisplayName(item.assignedTo)) || "-");
		responsibleRow.appendChild(responsible);
		card.appendChild(responsibleRow);
	}

	if (item.tags?.length) {
		const tagRow = document.createElement("div");
		tagRow.className = "item-tags";
		item.tags.forEach((tag) => tagRow.appendChild(createTagChip(tag)));
		card.appendChild(tagRow);
	}

	if (normalizedProfile === "tests") {
		const transition = getStatusTransitionParts(item.lastStateTransitionText);
		const transitionDate = formatRelativeTransitionDate(item.lastStateTransitionDate);
		const transitionRow = document.createElement("div");
		transitionRow.className = "recent-item-row tests-transition-row";

		const fromStatus = document.createElement("span");
		fromStatus.className = "tests-transition-status tests-transition-status-from";
		fromStatus.textContent = transition.from;

		const arrow = document.createElement("span");
		arrow.className = "tests-transition-arrow";
		arrow.title = "Movimentação de status";
		arrow.setAttribute("aria-label", "Movimentação de status");
		arrow.textContent = "➜";

		const toStatus = document.createElement("span");
		toStatus.className = "tests-transition-status tests-transition-status-to";
		toStatus.textContent = transition.to;

		transitionRow.appendChild(fromStatus);
		transitionRow.appendChild(arrow);
		transitionRow.appendChild(toStatus);
		card.appendChild(transitionRow);

		if (transitionDate.text) {
			const transitionDateRow = document.createElement("div");
			transitionDateRow.className = "tests-transition-date";
			transitionDateRow.textContent = transitionDate.text;
			if (transitionDate.title) {
				transitionDateRow.title = transitionDate.title;
			}
			card.appendChild(transitionDateRow);
		}
	} else {
		const normalizedAlert = String(criticalAlertText || "").trim();
		if (normalizedAlert) {
			const alertText = document.createElement("div");
			alertText.className = "critical-alert-text";
			alertText.textContent = normalizedAlert;
			card.appendChild(alertText);
		}
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
	renderTrendInsight,
	formatMetrics,
};
