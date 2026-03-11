const ROW_SELECTOR = "tbody .bolt-tree-row.bolt-table-row.bolt-list-row";

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function findScrollableAncestor(element) {
	let current = element;
	while (current) {
		if (
			current.scrollHeight > current.clientHeight &&
			window.getComputedStyle(current).overflowY !== "visible"
		) {
			return current;
		}
		current = current.parentElement;
	}
	return null;
}

function findScrollTarget() {
	const firstRow = document.querySelector(ROW_SELECTOR);
	if (firstRow) {
		const ancestor = findScrollableAncestor(firstRow);
		if (ancestor) {
			return ancestor;
		}
	}

	return document.scrollingElement || document.documentElement;
}

function parseHours(text) {
	return Number(String(text || "").trim().replace(",", "."));
}

function collectVisibleRows(map) {
	const rows = document.querySelectorAll(ROW_SELECTOR);

	for (const row of rows) {
		const idText = (row.querySelector("td:nth-child(1)")?.innerText || "")
			.replace(/\s+/g, " ")
			.trim();
		const hourText = row.querySelector("td:nth-child(8) span span")?.innerText || "";
		const hours = parseHours(hourText);

		if (!Number.isFinite(hours)) {
			continue;
		}

		const fallbackKey = row.innerText.replace(/\s+/g, " ").trim();
		const key = idText || fallbackKey;
		if (key) {
			map.set(key, hours);
		}
	}
}

async function collectMetrics(days) {
	const rowsByTask = new Map();
	const scrollTarget = findScrollTarget();

	let lastSize = 0;
	let stablePasses = 0;

	for (let i = 0; i < 220; i += 1) {
		collectVisibleRows(rowsByTask);

		if (rowsByTask.size === lastSize) {
			stablePasses += 1;
		} else {
			stablePasses = 0;
			lastSize = rowsByTask.size;
		}

		const atBottom =
			scrollTarget.scrollTop + scrollTarget.clientHeight >= scrollTarget.scrollHeight - 4;

		if (atBottom && stablePasses >= 5) {
			break;
		}

		scrollTarget.scrollTop = Math.min(
			scrollTarget.scrollTop + Math.max(220, scrollTarget.clientHeight * 0.8),
			scrollTarget.scrollHeight,
		);

		await wait(120);
	}

	const values = Array.from(rowsByTask.values());
	const sum = values.reduce((acc, value) => acc + value, 0);
	const dailyAverage = days > 0 ? sum / days : 0;

	return {
		startedTasks: rowsByTask.size,
		sumHours: Number(sum.toFixed(4)),
		completedDays: days,
		dailyAverage: Number(dailyAverage.toFixed(4)),
	};
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.action !== "collectAzureMetrics") {
		return;
	}

	const days = Number.isFinite(Number(message.days)) ? Number(message.days) : 6;

	(async () => {
		try {
			const metrics = await collectMetrics(days);
			sendResponse({ ok: true, metrics });
		} catch (error) {
			sendResponse({
				ok: false,
				error: error instanceof Error ? error.message : "Erro ao coletar metricas.",
			});
		}
	})();

	return true;
});
