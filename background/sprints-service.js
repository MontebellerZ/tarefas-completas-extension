function normalizeWorkItem(rawItem, settings) {
	const fields = rawItem.fields || {};
	const estimated = Number(fields["Microsoft.VSTS.Scheduling.OriginalEstimate"]);
	const completed = Number(fields["Microsoft.VSTS.Scheduling.CompletedWork"]);
	const iterationPath = String(fields["System.IterationPath"] || "").trim();

	return {
		id: rawItem.id,
		title: String(fields["System.Title"] || "").trim(),
		type: String(fields["System.WorkItemType"] || "").trim(),
		estimated: Number.isFinite(estimated) ? Number(estimated.toFixed(4)) : 0,
		completed: Number.isFinite(completed) ? Number(completed.toFixed(4)) : 0,
		state: String(fields["System.State"] || "").trim(),
		tags: splitTags(fields["System.Tags"]),
		sprint: formatIterationPath(iterationPath, settings.projectName),
		iterationPath,
		description: String(fields["System.Description"] || "").trim(),
		assignedTo: fields["System.AssignedTo"],
		itemUrl:
			`https://dev.azure.com/${encodePathPart(settings.organization)}/` +
			`${encodePathPart(settings.projectName)}/_workitems/edit/${rawItem.id}`,
	};
}

async function fetchWorkItemsBatch(settings, ids) {
	if (!ids.length) return [];
	const fields = [
		"System.Id",
		"System.Title",
		"System.WorkItemType",
		"System.AssignedTo",
		"System.State",
		"System.Tags",
		"System.IterationPath",
		"System.Description",
		"Microsoft.VSTS.Scheduling.OriginalEstimate",
		"Microsoft.VSTS.Scheduling.CompletedWork",
	];
	const items = [];
	for (let i = 0; i < ids.length; i += 200) {
		const chunk = ids.slice(i, i + 200);
		const response = await azureFetchJson(
			`https://dev.azure.com/${encodePathPart(settings.organization)}/${encodePathPart(settings.projectName)}/_apis/wit/workitemsbatch?api-version=${API_VERSION}`,
			{
				tokenValue: settings.tokenValue,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ids: chunk, fields, errorPolicy: "Omit" }),
			},
		);
		items.push(...(response.value || []));
	}
	return items;
}

async function getCachedUser(settings) {
	const key = `${settings.organization}:${settings.tokenValue}`;
	if (isFresh(cache.user, TTL.user) && cache.user.key === key) return cache.user.data;
	const response = await azureFetchJson(
		`https://dev.azure.com/${encodePathPart(settings.organization)}/_apis/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1&api-version=7.1-preview.1`,
		{ tokenValue: settings.tokenValue },
	);
	const data = response.authenticatedUser || {};
	cache.user = { data, at: Date.now(), key };
	return data;
}

async function getCachedTeamSettings(settings) {
	const key = contextCacheKey(settings);
	if (isFresh(cache.teamSettings, TTL.teamSettings) && cache.teamSettings?.key === key) return cache.teamSettings.data;
	const data = await azureFetchJson(
		`https://dev.azure.com/${encodePathPart(settings.organization)}/${encodePathPart(settings.projectName)}/${encodePathPart(settings.teamName)}/_apis/work/teamsettings?api-version=${API_VERSION}`,
		{ tokenValue: settings.tokenValue },
	);
	cache.teamSettings = { data, at: Date.now(), key };
	return data;
}

async function getCachedIterations(settings) {
	const key = contextCacheKey(settings);
	if (isFresh(cache.iterations, TTL.iterations) && cache.iterations?.key === key) return cache.iterations.data;
	const response = await azureFetchJson(
		`https://dev.azure.com/${encodePathPart(settings.organization)}/${encodePathPart(settings.projectName)}/${encodePathPart(settings.teamName)}/_apis/work/teamsettings/iterations?api-version=${API_VERSION}`,
		{ tokenValue: settings.tokenValue },
	);
	const data = response.value || [];
	cache.iterations = { data, at: Date.now(), key };
	return data;
}

async function getCachedCapacity(settings, iteration) {
	const ttl = isSprintHot(iteration.attributes?.finishDate) ? TTL.capacityHot : TTL.capacityCold;
	const entry = cache.capacity.get(iteration.id);
	if (isFresh(entry, ttl)) return entry.data;
	const response = await azureFetchJson(
		`https://dev.azure.com/${encodePathPart(settings.organization)}/${encodePathPart(settings.projectName)}/${encodePathPart(settings.teamName)}/_apis/work/teamsettings/iterations/${encodePathPart(iteration.id)}/capacities?api-version=${CAPACITY_API_VERSION}`,
		{ tokenValue: settings.tokenValue },
	);
	const data = Array.isArray(response?.value) ? response.value : Array.isArray(response) ? response : [];
	cache.capacity.set(iteration.id, { data, at: Date.now() });
	return data;
}

async function getCachedTeamDaysOff(settings, iteration) {
	const ttl = isSprintHot(iteration.attributes?.finishDate) ? TTL.daysOffHot : TTL.daysOffCold;
	const entry = cache.teamDaysOff.get(iteration.id);
	if (isFresh(entry, ttl)) return entry.data;
	const data = await azureFetchJson(
		`https://dev.azure.com/${encodePathPart(settings.organization)}/${encodePathPart(settings.projectName)}/${encodePathPart(settings.teamName)}/_apis/work/teamsettings/iterations/${encodePathPart(iteration.id)}/teamdaysoff?api-version=${API_VERSION}`,
		{ tokenValue: settings.tokenValue },
	);
	cache.teamDaysOff.set(iteration.id, { data, at: Date.now() });
	return data;
}

async function getCachedSprintItems(settings, iteration) {
	const currentUser = await getCachedUser(settings);
	const targetUser = resolveTargetUser(settings, currentUser);
	const ttl = isSprintHot(iteration.attributes?.finishDate) ? TTL.itemsHot : TTL.itemsCold;
	const cacheKey = `${iteration.id}|${getTargetUserCacheKey(targetUser)}`;
	const entry = cache.sprintItems.get(cacheKey);
	if (isFresh(entry, ttl)) return entry.data;
	const wiql = buildSprintItemsWiql(settings.projectName, iteration.path || iteration.name, targetUser);
	const ids = await runWiql(settings, wiql);
	if (!ids.length) {
		cache.sprintItems.set(cacheKey, { data: [], at: Date.now() });
		return [];
	}
	const rawItems = await fetchWorkItemsBatch(settings, ids);
	const data = rawItems.map((item) => normalizeWorkItem(item, settings));
	cache.sprintItems.set(cacheKey, { data, at: Date.now() });
	return data;
}

async function loadSprintDataset() {
	const settings = await getSettings();
	ensureRequiredSettings(settings);

	const ctxKey = contextCacheKey(settings);
	if (ctxKey !== cacheContextKey) {
		invalidateCaches();
		cacheContextKey = ctxKey;
	}

	const [currentUser, teamSettings, iterations] = await Promise.all([
		getCachedUser(settings),
		getCachedTeamSettings(settings),
		getCachedIterations(settings),
	]);
	const targetUser = resolveTargetUser(settings, currentUser);

	const withCapacity = await Promise.all(
		iterations.map((iter) => getCachedCapacity(settings, iter).then((cap) => ({ iter, cap }))),
	);

	const userIterations = withCapacity.filter(({ cap }) =>
		cap.some((entry) => matchesIdentity(entry.teamMember, targetUser)),
	);

	if (!userIterations.length) {
		return { settings, currentUser, sprints: [] };
	}

	const sprintData = await Promise.all(
		userIterations.map(async ({ iter, cap }) => {
			const currentCapacity = cap.find((entry) => matchesIdentity(entry.teamMember, targetUser));
			const [teamDaysOff, items] = await Promise.all([
				getCachedTeamDaysOff(settings, iter),
				getCachedSprintItems(settings, iter),
			]);
			return { iter, currentCapacity, teamDaysOff, items };
		}),
	);

	const sprintResults = [];
	for (const { iter, currentCapacity, teamDaysOff, items } of sprintData) {
		if (!items.length) continue;
		const attributes = iter.attributes || {};
		sprintResults.push({
			id: iter.id,
			name: iter.name,
			path: iter.path || "",
			label: formatIterationPath(iter.path || iter.name, settings.projectName),
			startDate: attributes.startDate,
			finishDate: attributes.finishDate,
			workingDateKeys: computeWorkingDateKeys(attributes, teamSettings, teamDaysOff, currentCapacity.daysOff),
			workedItems: items,
		});
	}

	return { settings, currentUser, targetUser, sprints: sortSprintResults(sprintResults) };
}

async function listSprints() {
	const dataset = await loadSprintDataset();
	return {
		sprints: dataset.sprints.map((s) => ({ value: s.id, label: s.label })),
		defaultSprint: getDefaultSprintId(dataset.sprints),
	};
}

async function collectMetrics(sprintId, includeCurrentDay) {
	const dataset = await loadSprintDataset();
	const sprint = dataset.sprints.find((item) => String(item.id) === String(sprintId));

	if (!sprint) {
		throw new Error("Sprint selecionada nao encontrada.");
	}

	const sumHours = sprint.workedItems.reduce((total, item) => total + item.completed, 0);
	const consideredDays = countElapsedWorkingDays(sprint, includeCurrentDay);
	const dailyAverage = consideredDays > 0 ? sumHours / consideredDays : 0;

	const pendingStates = new Set(["to do", "approved", "to refactor", "in progress", "pause"]);
	const validatingStates = new Set(["to test"]);
	const finishedStates = new Set(["to release", "to review", "done"]);

	let pendingTasks = 0;
	let validatingTasks = 0;
	let finishedTasks = 0;

	for (const item of sprint.workedItems) {
		const normalizedState = String(item?.state || "").trim().toLowerCase();
		if (pendingStates.has(normalizedState)) {
			pendingTasks += 1;
			continue;
		}
		if (validatingStates.has(normalizedState)) {
			validatingTasks += 1;
			continue;
		}
		if (finishedStates.has(normalizedState)) {
			finishedTasks += 1;
		}
	}

	return {
		startedTasks: sprint.workedItems.length,
		pendingTasks,
		validatingTasks,
		finishedTasks,
		sumHours: Number(sumHours.toFixed(4)),
		completedDays: consideredDays,
		dailyAverage: Number(dailyAverage.toFixed(4)),
		selectedSprint: sprint.id,
		selectedSprintLabel: sprint.label,
	};
}

async function listSprintItemsByMetricBucket(sprintId, metricBucket) {
	const dataset = await loadSprintDataset();
	const sprint = dataset.sprints.find((item) => String(item.id) === String(sprintId));

	if (!sprint) {
		throw new Error("Sprint selecionada nao encontrada.");
	}

	const bucket = String(metricBucket || "").trim().toLowerCase();
	const pendingStates = new Set(["to do", "approved", "to refactor", "in progress", "pause"]);
	const validatingStates = new Set(["to test"]);
	const finishedStates = new Set(["to release", "to review", "done"]);

	let filtered = [];
	if (bucket === "started") {
		filtered = [...sprint.workedItems];
	} else if (bucket === "pending") {
		filtered = sprint.workedItems.filter((item) => pendingStates.has(String(item?.state || "").trim().toLowerCase()));
	} else if (bucket === "validating") {
		filtered = sprint.workedItems.filter((item) => validatingStates.has(String(item?.state || "").trim().toLowerCase()));
	} else if (bucket === "finished") {
		filtered = sprint.workedItems.filter((item) => finishedStates.has(String(item?.state || "").trim().toLowerCase()));
	} else {
		throw new Error("Tipo de métrica inválido para listagem de itens.");
	}

	return filtered.sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0));
}
