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
	const candidateIds = await runWiql(dataset.settings, buildRecentChangesWiql(dataset.settings.projectName, sinceDateKey));
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
