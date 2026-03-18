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

async function getCachedSprintItems(settings, iteration, targetUser) {
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

function getScopeCacheKey(options = {}) {
	const scope = String(options.scope || QUERY_SCOPES.ME).trim().toLowerCase();
	if (scope === QUERY_SCOPES.ALL_USERS) return QUERY_SCOPES.ALL_USERS;
	if (scope === QUERY_SCOPES.SPECIFIC_USER) {
		const selectedUser = options.selectedUser || {};
		return `${QUERY_SCOPES.SPECIFIC_USER}:${String(selectedUser.id || selectedUser.descriptor || selectedUser.uniqueName || selectedUser.name || "")}`;
	}
	return QUERY_SCOPES.ME;
}

async function loadSprintDataset(options = {}) {
	const settings = await getSettings();
	ensureRequiredSettings(settings);
	const profile = String(options.profile || settings.selectedProfile || VIEW_PROFILES.ANALYST).trim().toLowerCase();

	const ctxKey = `${contextCacheKey(settings)}|${profile}|${getScopeCacheKey(options)}`;
	if (ctxKey !== cacheContextKey) {
		invalidateCaches();
		cacheContextKey = ctxKey;
	}

	const [currentUser, teamSettings, iterations] = await Promise.all([
		getCachedUser(settings),
		getCachedTeamSettings(settings),
		getCachedIterations(settings),
	]);
	const targetUser = resolveTargetUser(settings, currentUser, options);

	const withCapacity = await Promise.all(
		iterations.map((iter) => getCachedCapacity(settings, iter).then((cap) => ({ iter, cap }))),
	);

	const userIterations = targetUser?.isAllUsers
		? withCapacity
		: withCapacity;

	if (!userIterations.length) {
		return { settings, currentUser, sprints: [] };
	}

	const sprintData = await Promise.all(
		userIterations.map(async ({ iter, cap }) => {
			const currentCapacity = targetUser?.isAllUsers ? { daysOff: [] } : cap.find((entry) => matchesIdentity(entry.teamMember, targetUser)) || null;
			const hasCapacity = targetUser?.isAllUsers ? true : Boolean(currentCapacity);
			const [teamDaysOff, items] = await Promise.all([
				getCachedTeamDaysOff(settings, iter),
				getCachedSprintItems(settings, iter, targetUser),
			]);
			return { iter, currentCapacity, hasCapacity, teamDaysOff, items };
		}),
	);

	const sprintResults = [];
	for (const { iter, currentCapacity, hasCapacity, teamDaysOff, items } of sprintData) {
		if (!items.length) continue;
		const attributes = iter.attributes || {};
		const shouldUseWorkingDays = targetUser?.isAllUsers || hasCapacity;
		sprintResults.push({
			id: iter.id,
			name: iter.name,
			path: iter.path || "",
			label: formatIterationPath(iter.path || iter.name, settings.projectName),
			startDate: attributes.startDate,
			finishDate: attributes.finishDate,
			workingDateKeys: shouldUseWorkingDays
				? computeWorkingDateKeys(attributes, teamSettings, teamDaysOff, currentCapacity?.daysOff || [])
				: [],
			hasCapacity,
			workedItems: items,
		});
	}

	return { settings, currentUser, targetUser, profile, sprints: sortSprintResults(sprintResults) };
}

async function listSprints(options = {}) {
	const dataset = await loadSprintDataset(options);
	return {
		sprints: dataset.sprints.map((s) => ({ value: s.id, label: s.label })),
		defaultSprint: getDefaultSprintId(dataset.sprints),
	};
}

function getConfiguredStatusSets(settings, profile = VIEW_PROFILES.ANALYST) {
	const mapping = getProjectStatusMappingEntry(settings, settings.organization, settings.projectId, profile);
	if (!mapping?.configured) {
		throw new Error("Mapeamento de status pendente para este projeto. Configure os buckets em Configurações.");
	}

	const toSet = (values) =>
		new Set(
			(values || [])
				.map((entry) => String(entry || "").trim().toLowerCase())
				.filter(Boolean),
		);

	return {
		pendingStates: toSet(mapping.buckets?.pending),
		validatingStates: toSet(mapping.buckets?.validating),
		finishedStates: toSet(mapping.buckets?.finished),
	};
}

function normalizeStateValue(value) {
	return String(value || "").trim().toLowerCase();
}

function itemMatchesStateSet(item, states) {
	return states.has(normalizeStateValue(item?.state));
}

function getMappedTotalStateSet(statusSets) {
	return new Set([
		...statusSets.pendingStates,
		...statusSets.validatingStates,
		...statusSets.finishedStates,
	]);
}

function getItemsForMetricBucket(items, metricBucket, statusSets) {
	const bucket = String(metricBucket || "").trim().toLowerCase();
	const source = Array.isArray(items) ? items : [];
	if (bucket === "started") {
		const totalStates = getMappedTotalStateSet(statusSets);
		return source.filter((item) => itemMatchesStateSet(item, totalStates));
	}
	if (bucket === "pending") {
		return source.filter((item) => itemMatchesStateSet(item, statusSets.pendingStates));
	}
	if (bucket === "validating") {
		return source.filter((item) => itemMatchesStateSet(item, statusSets.validatingStates));
	}
	if (bucket === "finished") {
		return source.filter((item) => itemMatchesStateSet(item, statusSets.finishedStates));
	}
	if (bucket === "not-started") {
		return source.filter((item) => Number(item?.completed || 0) <= 0);
	}
	if (bucket === "unassigned") {
		return source.filter((item) => !hasAssignedUser(item));
	}
	throw new Error("Tipo de métrica inválido para listagem de itens.");
}

function parseAzureDateOnly(value) {
	const raw = String(value || "").trim();
	const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (match) {
		return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return parsed;
	parsed.setHours(0, 0, 0, 0);
	return parsed;
}

function sortRevisionsByRevAscending(revisions) {
	const source = Array.isArray(revisions) ? revisions : [];
	return [...source].sort((left, right) => Number(left?.rev || 0) - Number(right?.rev || 0));
}

function getAssignedUserDisplayName(assignedTo) {
	if (typeof assignedTo === "string") {
		const text = String(assignedTo || "").trim();
		return text || "Nao atribuido";
	}

	const displayName = String(assignedTo?.displayName || assignedTo?.name || assignedTo?.uniqueName || "").trim();
	return displayName || "Nao atribuido";
}

function hasAssignedUser(item) {
	const assignedTo = item?.assignedTo;
	if (!assignedTo) return false;
	if (typeof assignedTo === "string") {
		return Boolean(String(assignedTo || "").trim());
	}
	return Boolean(
		String(assignedTo.displayName || assignedTo.name || assignedTo.uniqueName || assignedTo.id || "").trim(),
	);
}

function getRemainingWorkForItem(item) {
	const estimated = Number(item?.estimated || 0);
	const completed = Number(item?.completed || 0);
	if (!Number.isFinite(estimated) || estimated <= 0) return 0;
	if (!Number.isFinite(completed) || completed <= 0) return Number(estimated.toFixed(4));
	return Number(Math.max(estimated - completed, 0).toFixed(4));
}

function isWorkItemFromSprint(item, sprint) {
	const itemIterationPath = String(item?.iterationPath || "").trim().toLowerCase();
	const itemSprint = String(item?.sprint || "").trim().toLowerCase();
	const sprintPath = String(sprint?.path || "").trim().toLowerCase();
	const sprintLabel = String(sprint?.label || "").trim().toLowerCase();
	if (itemIterationPath && sprintPath && itemIterationPath === sprintPath) return true;
	if (itemSprint && sprintLabel && itemSprint === sprintLabel) return true;
	return false;
}

function countRemainingWorkingDaysIncludingToday(sprint) {
	const keys = Array.isArray(sprint?.workingDateKeys) ? sprint.workingDateKeys : [];
	if (!keys.length) return 0;
	const todayKey = toDateKey(new Date());
	return keys.filter((key) => String(key || "") >= todayKey).length;
}

function getElapsedWorkingDaysForTrend(sprint) {
	return Math.max(0, countElapsedWorkingDays(sprint, true));
}

function getForecastStatusByCapacityRatio(ratioPercent) {
	const ratio = Number(ratioPercent);
	if (!Number.isFinite(ratio)) {
		return {
			status: "off-track",
			arrowDirection: "down-right",
			feedbackText: "Com o ritmo atual, a equipe não deve alcançar o objetivo da sprint no prazo.",
		};
	}

	if (ratio <= 80) {
		return {
			status: "on-track",
			arrowDirection: "up-right",
			feedbackText: "Com o ritmo atual, a equipe deve alcançar o objetivo da sprint dentro do prazo.",
		};
	}

	if (ratio <= 100) {
		return {
			status: "at-risk",
			arrowDirection: "right",
			feedbackText: "Com o ritmo atual, a sprint está em risco e exige atenção para alcançar o objetivo.",
		};
	}

	return {
		status: "off-track",
		arrowDirection: "down-right",
		feedbackText: "Com o ritmo atual, a equipe não deve alcançar o objetivo da sprint no prazo.",
	};
}

function buildTrendSeries(sprint, baselineRemaining, currentRemaining, burnPerWorkingDay) {
	const keys = Array.isArray(sprint?.workingDateKeys) ? [...sprint.workingDateKeys].sort((left, right) => left.localeCompare(right)) : [];
	if (!keys.length) {
		return {
			labels: [],
			ideal: [],
			remaining: [],
		};
	}

	const todayKey = toDateKey(new Date());
	let todayIndex = keys.findLastIndex((key) => key <= todayKey);
	if (todayIndex < 0) todayIndex = 0;
	if (todayIndex > keys.length - 1) todayIndex = keys.length - 1;

	const safeBaseline = Math.max(0, Number(baselineRemaining || 0));
	const safeCurrent = Math.max(0, Number(currentRemaining || 0));
	const safeBurn = Math.max(0, Number(burnPerWorkingDay || 0));

	const labels = [];
	const ideal = [];
	const remaining = [];
	const lastIndex = Math.max(1, keys.length - 1);

	for (let index = 0; index < keys.length; index += 1) {
		const key = keys[index];
		const [year, month, day] = String(key || "").split("-");
		labels.push(year && month && day ? `${day}/${month}` : "-");

		const idealValue = safeBaseline - (safeBaseline * index) / lastIndex;
		ideal.push(Number(Math.max(idealValue, 0).toFixed(4)));

		let remainingValue = safeCurrent;
		if (index <= todayIndex) {
			remainingValue = safeCurrent + safeBurn * (todayIndex - index);
		} else {
			remainingValue = safeCurrent - safeBurn * (index - todayIndex);
		}
		remaining.push(Number(Math.max(remainingValue, 0).toFixed(4)));
	}

	return {
		labels,
		ideal,
		remaining,
	};
}

async function fetchAllWorkItemRevisions(settings, workItemId, pageSize = 200) {
	const all = [];
	let skip = 0;
	let pageCount = 0;
	while (pageCount < 200) {
		const response = await azureFetchJson(
			`https://dev.azure.com/${encodePathPart(settings.organization)}/${encodePathPart(settings.projectName)}/_apis/wit/workItems/${encodePathPart(workItemId)}/revisions?$top=${pageSize}&$skip=${skip}&api-version=${API_VERSION}`,
			{ tokenValue: settings.tokenValue },
		);
		const page = Array.isArray(response?.value) ? response.value : [];
		if (!page.length) break;
		all.push(...page);
		skip += page.length;
		pageCount += 1;
		if (page.length < pageSize) break;
	}
	return all;
}

async function collectMetrics(sprintId, includeCurrentDay, options = {}) {
	const dataset = await loadSprintDataset(options);
	const sprint = dataset.sprints.find((item) => String(item.id) === String(sprintId));

	if (!sprint) {
		throw new Error("Sprint selecionada nao encontrada.");
	}

	const sumHours = sprint.workedItems.reduce((total, item) => total + item.completed, 0);
	const forceIncludeCurrentDay = dataset.profile === VIEW_PROFILES.TESTS ? true : includeCurrentDay;
	const consideredDays = countElapsedWorkingDays(sprint, forceIncludeCurrentDay);
	const dailyAverage = consideredDays > 0 ? sumHours / consideredDays : 0;

	const statusSets = getConfiguredStatusSets(dataset.settings, dataset.profile);
	const pendingTasks = getItemsForMetricBucket(sprint.workedItems, "pending", statusSets).length;
	const validatingTasks = getItemsForMetricBucket(sprint.workedItems, "validating", statusSets).length;
	const finishedTasks = getItemsForMetricBucket(sprint.workedItems, "finished", statusSets).length;
	const startedTasks = getItemsForMetricBucket(sprint.workedItems, "started", statusSets).length;
	const { validatingStates } = statusSets;
	const notStartedCount = sprint.workedItems.filter((item) => Number(item?.completed || 0) <= 0).length;
	const remainingWorkTotal = Number(
		sprint.workedItems.reduce((total, item) => total + getRemainingWorkForItem(item), 0).toFixed(4),
	);
	const unassignedCount = sprint.workedItems.filter((item) => !hasAssignedUser(item)).length;

	if (dataset.profile === VIEW_PROFILES.TESTS) {
		const releasedByDay = new Map();
		const sprintStart = parseAzureDateOnly(sprint.startDate);
		const sprintEnd = parseAzureDateOnly(sprint.finishDate);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const baseRangeEnd = sprintEnd < today ? sprintEnd : today;

		if (!Number.isNaN(sprintStart.getTime()) && !Number.isNaN(baseRangeEnd.getTime()) && sprintStart <= baseRangeEnd) {
			const cursor = new Date(sprintStart);
			while (cursor <= baseRangeEnd) {
				const month = String(cursor.getMonth() + 1).padStart(2, "0");
				const day = String(cursor.getDate()).padStart(2, "0");
				const dateKey = `${cursor.getFullYear()}-${month}-${day}`;
				const weekDay = cursor.getDay();
				const nonBusinessDay = weekDay === 0 || weekDay === 6;
				releasedByDay.set(dateKey, { count: 0, outsideSprintRange: false, nonBusinessDay });
				cursor.setDate(cursor.getDate() + 1);
			}
		}

		await Promise.all(
			sprint.workedItems.map(async (item) => {
				try {
					const revisions = await fetchAllWorkItemRevisions(dataset.settings, item.id, 200);
					const values = sortRevisionsByRevAscending(revisions);
					for (let index = 1; index < values.length; index += 1) {
						const previous = values[index - 1];
						const current = values[index];
						const previousState = String(previous?.fields?.["System.State"] || "").trim().toLowerCase();
						const currentState = String(current?.fields?.["System.State"] || "").trim().toLowerCase();
						if (!currentState || currentState === previousState || !validatingStates.has(currentState)) continue;
						if (validatingStates.has(previousState)) continue;
						const changedDateValue = current?.fields?.["System.ChangedDate"] || current?.revisedDate;
						const changedDate = new Date(changedDateValue);
						if (Number.isNaN(changedDate.getTime())) continue;
						const month = String(changedDate.getMonth() + 1).padStart(2, "0");
						const day = String(changedDate.getDate()).padStart(2, "0");
						const dateKey = `${changedDate.getFullYear()}-${month}-${day}`;
						if (!releasedByDay.has(dateKey)) {
							const weekDay = changedDate.getDay();
							const nonBusinessDay = weekDay === 0 || weekDay === 6;
							releasedByDay.set(dateKey, { count: 0, outsideSprintRange: true, nonBusinessDay });
						}
						const currentBucket = releasedByDay.get(dateKey) || {
							count: 0,
							outsideSprintRange: true,
							nonBusinessDay: changedDate.getDay() === 0 || changedDate.getDay() === 6,
						};
						releasedByDay.set(dateKey, {
							count: Number(currentBucket.count || 0) + 1,
							outsideSprintRange: Boolean(currentBucket.outsideSprintRange),
							nonBusinessDay: Boolean(currentBucket.nonBusinessDay),
						});
					}
				} catch {
					// Ignore chart enrichment failures for individual items.
				}
			}),
		);

		const releaseTasks = validatingTasks;
		const totalTasks = startedTasks;
		const releasedPerDay = [...releasedByDay.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([dateKey, info]) => ({
				dateKey,
				count: Number(info?.count || 0),
				outsideSprintRange: Boolean(info?.outsideSprintRange),
				nonBusinessDay: Boolean(info?.nonBusinessDay),
			}));
		return {
			startedTasks,
			pendingTasks,
			validatingTasks: releaseTasks,
			finishedTasks,
			totalTasks,
			sumHours: Number(sumHours.toFixed(4)),
			completedDays: consideredDays,
			dailyAverage: Number((releaseTasks / Math.max(1, consideredDays)).toFixed(4)),
			hasCapacity: Boolean(sprint.hasCapacity !== false),
			releasedPerDay,
			finishedPerDay: releasedPerDay,
			notStartedCount,
			remainingWorkTotal,
			unassignedCount,
			selectedSprint: sprint.id,
			selectedSprintLabel: sprint.label,
			profile: dataset.profile,
		};
	}

	const [recentItemsAll, criticalItemsAll] = await Promise.all([
		listRecentChanges(options),
		listCriticalPendingAnalyses(options),
	]);
	const recentChangesCount = (Array.isArray(recentItemsAll) ? recentItemsAll : []).filter((item) => isWorkItemFromSprint(item, sprint)).length;
	const criticalPendingCount = (Array.isArray(criticalItemsAll) ? criticalItemsAll : []).filter((item) => isWorkItemFromSprint(item, sprint)).length;

	const elapsedDaysForTrend = getElapsedWorkingDaysForTrend(sprint);
	const avgDailyAllAnalysts = elapsedDaysForTrend > 0 ? Number((sumHours / elapsedDaysForTrend).toFixed(4)) : 0;
	const remainingWorkingDays = countRemainingWorkingDaysIncludingToday(sprint);
	const forecastCapacityTotal = Number((remainingWorkingDays * avgDailyAllAnalysts).toFixed(4));
	const remainingCapacityRatioPct =
		forecastCapacityTotal > 0
			? Number(((remainingWorkTotal / forecastCapacityTotal) * 100).toFixed(4))
			: remainingWorkTotal > 0
				? Number.POSITIVE_INFINITY
				: 0;
	const trendStatus = getForecastStatusByCapacityRatio(remainingCapacityRatioPct);
	const trendBaseline = Number(Math.max(remainingWorkTotal + Math.max(sumHours, 0), remainingWorkTotal).toFixed(4));
	const trendSeries = buildTrendSeries(sprint, trendBaseline, remainingWorkTotal, avgDailyAllAnalysts);
	const trendSummary = {
		...trendStatus,
		remainingCapacityRatioPct,
		remainingWorkTotal,
		forecastCapacityTotal,
		remainingWorkingDays,
		avgDailyAllAnalysts,
		series: trendSeries,
	};

	const analystHours =
		dataset.profile === VIEW_PROFILES.MANAGEMENT && dataset.targetUser?.isAllUsers
			? (() => {
				const byAnalyst = new Map();
				for (const item of sprint.workedItems) {
					const analystName = getAssignedUserDisplayName(item?.assignedTo);
					const completedHours = Number(item?.completed || 0);
					if (!byAnalyst.has(analystName)) {
						byAnalyst.set(analystName, 0);
					}
					byAnalyst.set(analystName, Number(byAnalyst.get(analystName) || 0) + (Number.isFinite(completedHours) ? completedHours : 0));
				}

				return [...byAnalyst.entries()]
					.map(([name, hours]) => {
						const totalHours = Number(Number(hours || 0).toFixed(4));
						const dailyAverage = consideredDays > 0 ? Number((totalHours / consideredDays).toFixed(4)) : 0;
						return {
							name,
							totalHours,
							dailyAverage,
						};
					})
					.sort((left, right) => {
						const byHours = Number(right.totalHours || 0) - Number(left.totalHours || 0);
						if (byHours !== 0) return byHours;
						return String(left.name || "").localeCompare(String(right.name || ""));
					});
			})()
			: [];

	return {
		startedTasks,
		pendingTasks,
		validatingTasks,
		finishedTasks,
		notStartedCount,
		remainingWorkTotal,
		recentChangesCount,
		criticalPendingCount,
		unassignedCount,
		sumHours: Number(sumHours.toFixed(4)),
		completedDays: consideredDays,
		dailyAverage: Number(dailyAverage.toFixed(4)),
		hasCapacity: Boolean(sprint.hasCapacity !== false),
		analystHours,
		trendSummary,
		selectedSprint: sprint.id,
		selectedSprintLabel: sprint.label,
		profile: dataset.profile,
	};
}

async function listSprintItemsByMetricBucket(sprintId, metricBucket, options = {}) {
	const dataset = await loadSprintDataset(options);
	const sprint = dataset.sprints.find((item) => String(item.id) === String(sprintId));

	if (!sprint) {
		throw new Error("Sprint selecionada nao encontrada.");
	}

	const bucket = String(metricBucket || "").trim().toLowerCase();
	if (bucket === "recent") {
		const items = await listRecentChanges(options);
		return (Array.isArray(items) ? items : [])
			.filter((item) => isWorkItemFromSprint(item, sprint))
			.sort((left, right) => String(right.changedDate || "").localeCompare(String(left.changedDate || "")));
	}

	if (bucket === "critical") {
		const items = await listCriticalPendingAnalyses(options);
		return (Array.isArray(items) ? items : [])
			.filter((item) => isWorkItemFromSprint(item, sprint))
			.sort((left, right) => String(right.changedDate || "").localeCompare(String(left.changedDate || "")));
	}

	if (bucket === "trend") {
		return [];
	}

	const statusSets = getConfiguredStatusSets(dataset.settings, dataset.profile);
	const filtered = getItemsForMetricBucket(sprint.workedItems, bucket, statusSets);

	const sorted = filtered.sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0));
	if (dataset.profile !== VIEW_PROFILES.TESTS) {
		return sorted;
	}

	const enriched = await Promise.all(
		sorted.map(async (item) => {
			try {
				const revisions = await fetchAllWorkItemRevisions(dataset.settings, item.id, 200);
				const values = sortRevisionsByRevAscending(revisions);
				for (let index = values.length - 1; index > 0; index -= 1) {
					const current = values[index];
					const previous = values[index - 1];
					const currentState = String(current?.fields?.["System.State"] || "").trim();
					const previousState = String(previous?.fields?.["System.State"] || "").trim();
					if (!currentState || !previousState || currentState === previousState) continue;

					const changedBy = current?.fields?.["System.ChangedBy"] || null;
					const changedDate = String(current?.fields?.["System.ChangedDate"] || current?.revisedDate || "").trim();
					return {
						...item,
						lastStateChangedByName:
							String(changedBy?.displayName || changedBy?.name || changedBy?.uniqueName || "").trim() || "-",
						lastStateTransitionText: `${previousState} -> ${currentState}`,
						lastStateTransitionDate: changedDate,
					};
				}
			} catch {
				// Ignore revision enrichment failures and fallback to base item data.
			}

			return {
				...item,
				lastStateChangedByName:
					String(item?.assignedTo?.displayName || item?.assignedTo?.name || item?.assignedTo?.uniqueName || "").trim() || "-",
				lastStateTransitionText: "-",
				lastStateTransitionDate: String(item?.changedDate || "").trim(),
			};
		}),
	);

	return enriched;
}
