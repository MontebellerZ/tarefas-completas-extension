async function listRecentChanges() {
	const dataset = await loadSprintDataset();
	const ctxKey = contextCacheKey(dataset.settings);

	if (isFresh(cache.recentChanges, TTL.recentChanges) && cache.recentChanges?.key === ctxKey) {
		return cache.recentChanges.data;
	}

	const relevantDateKeys = getRelevantDateKeys(dataset.sprints);
	if (!relevantDateKeys.length) {
		cache.recentChanges = { data: [], at: Date.now(), key: ctxKey };
		return [];
	}

	const dateWindow = buildDateWindowFromKeys(relevantDateKeys);
	if (!dateWindow) {
		cache.recentChanges = { data: [], at: Date.now(), key: ctxKey };
		return [];
	}

	const sinceDateKey = relevantDateKeys[0];
	const candidateIds = await runWiql(
		dataset.settings,
		buildRecentChangesWiql(dataset.settings.projectName, sinceDateKey, dataset.targetUser),
	);
	if (!candidateIds.length) {
		cache.recentChanges = { data: [], at: Date.now(), key: ctxKey };
		return [];
	}

	const rawItems = await fetchWorkItemsBatch(dataset.settings, candidateIds);
	const candidates = rawItems.map((rawItem) => ({
		item: normalizeWorkItem(rawItem, dataset.settings),
		currentRev: Number(rawItem.rev || 0),
	}));

	function normalizeCompletedWorkValue(value) {
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : null;
	}

	function getRevisionChangedDate(revision) {
		const changedDate = revision?.fields?.["System.ChangedDate"] || revision?.revisedDate;
		const parsed = new Date(changedDate);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	async function findCompletedWorkChangeReverse(workItemId, currentRev) {
		if (currentRev < 1) return null;
		const PAGE_SIZE = 10;
		let blockEnd = currentRev;

		while (blockEnd >= 1) {
			const blockStart = Math.max(1, blockEnd - PAGE_SIZE + 1);
			const fetchSkip = Math.max(0, blockStart - 2);
			const fetchTop = blockEnd - fetchSkip;

			const url =
				`https://dev.azure.com/${encodePathPart(dataset.settings.organization)}/` +
				`${encodePathPart(dataset.settings.projectName)}/_apis/wit/workItems/` +
				`${encodePathPart(workItemId)}/revisions?$top=${fetchTop}&$skip=${fetchSkip}&api-version=${API_VERSION}`;

			const response = await azureFetchJson(url, { tokenValue: dataset.settings.tokenValue });
			const revisions = response.value || [];
			if (!revisions.length) break;

			for (let i = revisions.length - 1; i >= 0; i -= 1) {
				const current = revisions[i];
				const revNum = Number(current.rev || 0);
				if (revNum < blockStart) break;

				const changedAt = getRevisionChangedDate(current);
				if (!changedAt) continue;
				if (changedAt < dateWindow.start) return null;

				if (changedAt <= dateWindow.end) {
					const previous = i > 0 ? revisions[i - 1] : null;
					if (previous) {
						const prevCW = normalizeCompletedWorkValue(
							previous.fields?.["Microsoft.VSTS.Scheduling.CompletedWork"],
						);
						const curCW = normalizeCompletedWorkValue(
							current.fields?.["Microsoft.VSTS.Scheduling.CompletedWork"],
						);
						if (prevCW !== curCW) return changedAt;
					}
				}
			}

			blockEnd = blockStart - 1;
		}

		return null;
	}

	const results = await Promise.all(
		candidates.map(async ({ item, currentRev }) => {
			const changedAt = await findCompletedWorkChangeReverse(item.id, currentRev);
			if (!changedAt) return null;
			return { ...item, changedDate: changedAt.toISOString() };
		}),
	);

	const items = results
		.filter(Boolean)
		.sort((a, b) => String(b.changedDate).localeCompare(String(a.changedDate)));

	cache.recentChanges = { data: items, at: Date.now(), key: ctxKey };
	return items;
}

function hasPendingCriticalAnalysisReport(fields = {}) {
	const entries = Object.entries(fields).filter(([key]) =>
		String(key || "").toLowerCase().includes("relatoanalisecritica"),
	);

	if (!entries.length) return true;

	return entries.every(([, value]) => {
		if (value == null) return true;
		return String(value).trim() === "";
	});
}

function formatHoursDifferenceLabel(value) {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return "0h e 0min";
	const totalMinutes = Math.round(numeric * 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h e ${minutes}min`;
}

function buildCriticalPendingAnalysesWiql(projectName, iterationPaths, targetUser) {
	const escapedProject = String(projectName || "").replace(/'/g, "''");
	const iterationsClause = iterationPaths
		.map((path) => `'${String(path || "").replace(/'/g, "''")}'`)
		.join(", ");

	return (
		`SELECT [System.Id] FROM WorkItems` +
		` WHERE [System.TeamProject] = '${escapedProject}'` +
		` AND ${buildAssignedToCondition(targetUser)}` +
		` AND [System.IterationPath] IN (${iterationsClause})` +
		` AND (` +
		` [System.WorkItemType] = 'Bug'` +
		` OR (` +
		` [System.WorkItemType] = 'Task'` +
		` AND [Microsoft.VSTS.Scheduling.CompletedWork] > [Microsoft.VSTS.Scheduling.OriginalEstimate]` +
		` )` +
		`)` +
		` ORDER BY [System.ChangedDate] DESC`
	);
}

async function fetchCriticalPendingWorkItemsBatch(settings, ids) {
	if (!ids.length) return [];

	const items = [];
	for (let index = 0; index < ids.length; index += 200) {
		const chunk = ids.slice(index, index + 200);
		const response = await azureFetchJson(
			`https://dev.azure.com/${encodePathPart(settings.organization)}/${encodePathPart(settings.projectName)}/_apis/wit/workitemsbatch?api-version=${API_VERSION}`,
			{
				tokenValue: settings.tokenValue,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: chunk, errorPolicy: "Omit" }),
			},
		);
		items.push(...(response.value || []));
	}

	return items;
}

async function listCriticalPendingAnalyses() {
	const dataset = await loadSprintDataset();
	const scopedSprints = (dataset.sprints || []).slice(0, 3);
	if (!scopedSprints.length) return [];

	const iterationPaths = [...new Set(scopedSprints.map((sprint) => String(sprint.path || sprint.name || "").trim()).filter(Boolean))];
	if (!iterationPaths.length) return [];

	const candidateIds = await runWiql(
		dataset.settings,
		buildCriticalPendingAnalysesWiql(dataset.settings.projectName, iterationPaths, dataset.targetUser),
	);
	if (!candidateIds.length) return [];

	const rawItems = await fetchCriticalPendingWorkItemsBatch(dataset.settings, candidateIds);
	const items = [];

	for (const rawItem of rawItems) {
		const fields = rawItem?.fields || {};
		if (!hasPendingCriticalAnalysisReport(fields)) continue;

		const normalized = normalizeWorkItem(rawItem, dataset.settings);
		const itemType = String(normalized.type || "").trim().toLowerCase();
		const isBug = itemType === "bug";
		const hoursDifference = Number(normalized.completed) - Number(normalized.estimated);
		const hasHoursOverrun = Number.isFinite(hoursDifference) && hoursDifference > 0;

		if (!isBug && !hasHoursOverrun) continue;

		const labels = [];
		if (hasHoursOverrun) {
			labels.push(`Ultrapassou ${formatHoursDifferenceLabel(hoursDifference)}`);
		}
		if (isBug) {
			labels.push("Bug reportado");
		}

		items.push({
			...normalized,
			criticalAlertText: labels.join(" + "),
			changedDate: String(fields["System.ChangedDate"] || rawItem.revisedDate || ""),
		});
	}

	return items.sort((left, right) => String(right.changedDate || "").localeCompare(String(left.changedDate || "")));
}
