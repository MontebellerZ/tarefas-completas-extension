// background.js — Azure DevOps Metrics Extension
// Data fetched via PAT with dynamic WIQL and tiered per-entity caching.

const SETTINGS_STORAGE_KEY = "azureSettings";
const API_VERSION = "7.1";
const CAPACITY_API_VERSION = "6.0";
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// Cache TTLs (ms) — "hot" = current/previous sprint (<14 days old), "cold" = older
const TTL = {
	user: 30 * 60 * 1000,
	teamSettings: 15 * 60 * 1000,
	iterations: 10 * 60 * 1000,
	capacityHot: 2 * 60 * 1000,
	capacityCold: 20 * 60 * 1000,
	daysOffHot: 3 * 60 * 1000,
	daysOffCold: 20 * 60 * 1000,
	itemsHot: 2 * 60 * 1000,
	itemsCold: 15 * 60 * 1000,
	recentChanges: 60 * 1000,
};

const DEFAULT_SETTINGS = {
	tokenName: "",
	tokenValue: "",
	organization: "",
	projectId: "",
	projectName: "",
	teamId: "",
	teamName: "",
};

// Per-entity cache: each entry is { data, at } or { data, at, key }
// Maps use iterationId as key.
const cache = {
	user: null,
	teamSettings: null,
	iterations: null,
	capacity: new Map(),
	teamDaysOff: new Map(),
	sprintItems: new Map(),
	recentChanges: null,
};
let cacheContextKey = "";

function isFresh(entry, ttl) {
	return !!entry && Date.now() - entry.at < ttl;
}

function invalidateCaches() {
	cache.user = null;
	cache.teamSettings = null;
	cache.iterations = null;
	cache.capacity.clear();
	cache.teamDaysOff.clear();
	cache.sprintItems.clear();
	cache.recentChanges = null;
	cacheContextKey = "";
}

async function getSettings() {
	const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
	return { ...DEFAULT_SETTINGS, ...(stored?.[SETTINGS_STORAGE_KEY] || {}) };
}

async function saveSettings(settings) {
	const merged = { ...DEFAULT_SETTINGS, ...(await getSettings()), ...settings };
	merged.organization = normalizeOrganization(merged.organization);
	await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: merged });
	invalidateCaches();
}

async function clearUserData() {
	await chrome.storage.local.clear();
	invalidateCaches();
}

function normalizeOrganization(value) {
	const raw = String(value || "").trim();
	if (!raw) return "";
	try {
		const url = new URL(raw);
		if (url.hostname.endsWith("dev.azure.com")) {
			return decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "").trim();
		}
	} catch {
		return raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "").trim();
	}
	return raw;
}

function ensureRequiredSettings(settings) {
	if (!settings.tokenValue || !settings.organization || !settings.projectId || !settings.projectName || !settings.teamId || !settings.teamName) {
		throw new Error("Configuracao incompleta. Salve token, organizacao, projeto e time.");
	}
}

function contextCacheKey(settings) {
	return `${settings.organization}|${settings.projectId}|${settings.teamId}`;
}

function encodePathPart(value) {
	return encodeURIComponent(String(value || ""));
}

function createAuthHeader(tokenValue) {
	return `Basic ${btoa(`:${tokenValue}`)}`;
}

async function azureFetchJson(url, options = {}) {
	const saved = await getSettings();
	const tokenValue = String(options.tokenValue ?? saved.tokenValue ?? "").trim();
	if (!tokenValue) throw new Error("PAT nao configurado.");

	const response = await fetch(url, {
		...options,
		credentials: "omit",
		headers: {
			Accept: "application/json",
			Authorization: createAuthHeader(tokenValue),
			...(options.headers || {}),
		},
	});

	if (response.status === 401 || response.status === 403) {
		throw new Error("PAT invalido ou sem permissao suficiente no Azure DevOps.");
	}

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Falha na API do Azure (${response.status}): ${text.slice(0, 200)}`);
	}

	return response.json();
}

async function azureFetchJsonWithContinuation(url, options = {}) {
	const saved = await getSettings();
	const tokenValue = String(options.tokenValue ?? saved.tokenValue ?? "").trim();
	if (!tokenValue) throw new Error("PAT nao configurado.");

	const response = await fetch(url, {
		...options,
		credentials: "omit",
		headers: {
			Accept: "application/json",
			Authorization: createAuthHeader(tokenValue),
			...(options.headers || {}),
		},
	});

	if (response.status === 401 || response.status === 403) {
		throw new Error("PAT invalido ou sem permissao suficiente no Azure DevOps.");
	}

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Falha na API do Azure (${response.status}): ${text.slice(0, 200)}`);
	}

	return {
		data: await response.json(),
		continuationToken:
			response.headers.get("x-ms-continuationtoken") ||
			response.headers.get("X-MS-ContinuationToken") ||
			"",
	};
}

// ---- Projects & Teams ----

async function listProjects(organization, tokenValue) {
	const org = normalizeOrganization(organization);
	if (!org) throw new Error("Informe a organizacao do Azure DevOps.");
	const response = await azureFetchJson(
		`https://dev.azure.com/${encodePathPart(org)}/_apis/projects?stateFilter=WellFormed&$top=100&api-version=${API_VERSION}`,
		{ tokenValue },
	);
	return {
		organization: org,
		projects: (response.value || []).map((p) => ({ value: p.id, label: p.name, id: p.id, name: p.name })),
	};
}

async function listTeams(organization, projectId, tokenValue) {
	const org = normalizeOrganization(organization);
	if (!org || !projectId) throw new Error("Selecione organizacao e projeto para carregar os times.");
	const response = await azureFetchJson(
		`https://dev.azure.com/${encodePathPart(org)}/_apis/projects/${encodePathPart(projectId)}/teams?$mine=true&$top=100&$skip=0&api-version=${API_VERSION}`,
		{ tokenValue },
	);
	return {
		teams: (response.value || []).map((t) => ({ value: t.id, label: t.name, id: t.id, name: t.name })),
	};
}

// ---- WIQL ----

async function runWiql(settings, wiqlQuery) {
	const response = await azureFetchJson(
		`https://dev.azure.com/${encodePathPart(settings.organization)}/${encodePathPart(settings.projectName)}/_apis/wit/wiql?api-version=${API_VERSION}`,
		{
			tokenValue: settings.tokenValue,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query: wiqlQuery }),
		},
	);
	return (response.workItems || []).map((item) => item.id).filter(Number.isInteger);
}

function buildSprintItemsWiql(projectName, iterationPath) {
	const p = projectName.replace(/'/g, "''");
	const ip = iterationPath.replace(/'/g, "''");
	return (
		`SELECT [System.Id] FROM WorkItems` +
		` WHERE [System.TeamProject] = '${p}'` +
		` AND [System.AssignedTo] = @Me` +
		` AND [System.WorkItemType] IN ('Task', 'Bug')` +
		` AND [System.IterationPath] = '${ip}'` +
		` AND [Microsoft.VSTS.Scheduling.CompletedWork] > 0` +
		` ORDER BY [System.Id]`
	);
}

function buildRecentChangesWiql(projectName, sinceDateKey) {
	const p = projectName.replace(/'/g, "''");
	return (
		`SELECT [System.Id] FROM WorkItems` +
		` WHERE [System.TeamProject] = '${p}'` +
		` AND [System.AssignedTo] = @Me` +
		` AND [System.WorkItemType] IN ('Task', 'Bug')` +
		` AND [Microsoft.VSTS.Scheduling.CompletedWork] > 0` +
		` AND [System.ChangedDate] >= '${sinceDateKey}'` +
		` ORDER BY [System.ChangedDate] DESC`
	);
}

function addIdentityCandidate(set, value) {
	const normalized = String(value || "").trim().toLowerCase();
	if (!normalized) return;
	set.add(normalized);
	const m = normalized.match(/<([^>]+)>/);
	if (m?.[1]) set.add(m[1].trim().toLowerCase());
}

function extractIdentityCandidates(identity) {
	const values = new Set();
	if (!identity) return values;
	if (typeof identity === "string") { addIdentityCandidate(values, identity); return values; }
	for (const key of ["id", "descriptor", "uniqueName", "displayName", "providerDisplayName", "customDisplayName", "emailAddress", "mailAddress"]) {
		addIdentityCandidate(values, identity[key]);
	}
	if (identity.properties && typeof identity.properties === "object") {
		for (const v of Object.values(identity.properties)) {
			addIdentityCandidate(values, (v && typeof v === "object") ? (v.$value ?? v.value) : v);
		}
	}
	return values;
}

function matchesIdentity(left, right) {
	const ls = extractIdentityCandidates(left);
	const rs = extractIdentityCandidates(right);
	for (const v of ls) { if (rs.has(v)) return true; }
	return false;
}

function toLocalDayStart(value) {
	const date = new Date(value);
	date.setHours(0, 0, 0, 0);
	return date;
}

function toDateKey(value) {
	const date = toLocalDayStart(value);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(date, amount) {
	const result = new Date(date);
	result.setDate(result.getDate() + amount);
	return result;
}

function normalizeDateRanges(source) {
	const ranges = Array.isArray(source)
		? source
		: Array.isArray(source?.daysOff)
			? source.daysOff
			: [];

	return ranges
		.map((range) => ({
			start: range.start || range.startDate,
			end: range.end || range.endDate,
		}))
		.filter((range) => range.start && range.end);
}

function buildExcludedDateSet(teamDaysOff, userDaysOff) {
	const excluded = new Set();

	for (const range of [...normalizeDateRanges(teamDaysOff), ...normalizeDateRanges(userDaysOff)]) {
		let cursor = toLocalDayStart(range.start);
		const end = toLocalDayStart(range.end);

		while (cursor <= end) {
			excluded.add(toDateKey(cursor));
			cursor = addDays(cursor, 1);
		}
	}

	return excluded;
}

function computeWorkingDateKeys(iterationAttributes, teamSettings, teamDaysOff, userDaysOff) {
	if (!iterationAttributes?.startDate || !iterationAttributes?.finishDate) {
		return [];
	}

	const allowedDays = new Set((teamSettings?.workingDays || []).map((day) => String(day).trim().toLowerCase()));
	const excluded = buildExcludedDateSet(teamDaysOff, userDaysOff);
	const keys = [];

	let cursor = toLocalDayStart(iterationAttributes.startDate);
	const end = toLocalDayStart(iterationAttributes.finishDate);

	while (cursor <= end) {
		const dateKey = toDateKey(cursor);
		const weekday = WEEKDAY_NAMES[cursor.getDay()];
		if (allowedDays.has(weekday) && !excluded.has(dateKey)) {
			keys.push(dateKey);
		}
		cursor = addDays(cursor, 1);
	}

	return keys;
}

function countElapsedWorkingDays(sprint, includeCurrentDay) {
	const todayKey = toDateKey(new Date());
	const finishKey = toDateKey(sprint.finishDate);
	const sprintIsPast = finishKey < todayKey;

	return sprint.workingDateKeys.filter((key) => {
		if (sprintIsPast) {
			return true;
		}
		return includeCurrentDay ? key <= todayKey : key < todayKey;
	}).length;
}

function isSprintHot(finishDate) {
	if (!finishDate) return false;
	return toLocalDayStart(finishDate) >= addDays(toLocalDayStart(new Date()), -14);
}

function getRelevantDateKeys(allSprints) {
	const todayKey = toDateKey(new Date());
	const allKeys = [...new Set(allSprints.flatMap((s) => s.workingDateKeys))].sort();
	const eligible = allKeys.filter((k) => k <= todayKey);
	if (!eligible.length) return fallbackRelevantDateKeys();
	const last = eligible[eligible.length - 1];
	const prev = eligible.length > 1 ? eligible[eligible.length - 2] : null;
	if (last === todayKey) return prev ? [prev, last] : [last];
	return [last];
}

function fallbackRelevantDateKeys() {
	const todayKey = toDateKey(new Date());
	const today = new Date();
	let cursor = addDays(today, -1);
	while (cursor.getDay() === 0 || cursor.getDay() === 6) cursor = addDays(cursor, -1);
	const prevKey = toDateKey(cursor);
	const d = today.getDay();
	return d !== 0 && d !== 6 ? [prevKey, todayKey] : [prevKey];
}

function buildDateWindowFromKeys(dateKeys) {
	if (!dateKeys.length) {
		return null;
	}

	const sorted = [...dateKeys].sort();
	const start = new Date(`${sorted[0]}T00:00:00`);
	const end = new Date(`${sorted[sorted.length - 1]}T23:59:59.999`);
	return { start, end };
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

function splitTags(tags) {
	if (!tags) {
		return [];
	}

	return String(tags)
		.split(";")
		.map((tag) => tag.trim())
		.filter(Boolean);
}

function formatIterationPath(iterationPath, fallbackProject = "") {
	const path = String(iterationPath || "").trim();
	if (!path) {
		return fallbackProject || "Sem sprint";
	}

	const sprintMatch = path.match(/Sprint\s*(\d+)/i);
	if (sprintMatch) {
		return `Sprint ${sprintMatch[1]}`;
	}

	const parts = path.split("\\").filter(Boolean);
	return parts[0] || fallbackProject || "Sem sprint";
}

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

function sortSprintResults(results) {
	return [...results].sort((left, right) => {
		const leftMatch = String(left.label || "").match(/Sprint\s*(\d+)/i);
		const rightMatch = String(right.label || "").match(/Sprint\s*(\d+)/i);
		const leftNumber = leftMatch ? Number(leftMatch[1]) : null;
		const rightNumber = rightMatch ? Number(rightMatch[1]) : null;

		if (leftNumber != null && rightNumber != null) {
			return rightNumber - leftNumber;
		}

		return String(left.label || "").localeCompare(String(right.label || ""), "pt-BR", {
			sensitivity: "base",
			numeric: true,
		});
	});
}

// ---- Cached per-entity fetchers ----

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
	const ttl = isSprintHot(iteration.attributes?.finishDate) ? TTL.itemsHot : TTL.itemsCold;
	const entry = cache.sprintItems.get(iteration.id);
	if (isFresh(entry, ttl)) return entry.data;
	const wiql = buildSprintItemsWiql(settings.projectName, iteration.path || iteration.name);
	const ids = await runWiql(settings, wiql);
	if (!ids.length) {
		cache.sprintItems.set(iteration.id, { data: [], at: Date.now() });
		return [];
	}
	const rawItems = await fetchWorkItemsBatch(settings, ids);
	const data = rawItems.map((item) => normalizeWorkItem(item, settings));
	cache.sprintItems.set(iteration.id, { data, at: Date.now() });
	return data;
}

// ---- Sprint dataset ----

async function loadSprintDataset() {
	const settings = await getSettings();
	ensureRequiredSettings(settings);

	const ctxKey = contextCacheKey(settings);
	if (ctxKey !== cacheContextKey) {
		invalidateCaches();
		cacheContextKey = ctxKey;
	}

	// Phase 1: user + team settings + iterations list (parallel, independently cached)
	const [currentUser, teamSettings, iterations] = await Promise.all([
		getCachedUser(settings),
		getCachedTeamSettings(settings),
		getCachedIterations(settings),
	]);

	// Phase 2: capacity for all iterations in parallel (independently cached per sprint)
	const withCapacity = await Promise.all(
		iterations.map((iter) => getCachedCapacity(settings, iter).then((cap) => ({ iter, cap }))),
	);

	// Phase 3: keep only iterations where the current user is in capacity
	const userIterations = withCapacity.filter(({ cap }) =>
		cap.some((entry) => matchesIdentity(entry.teamMember, currentUser)),
	);

	if (!userIterations.length) {
		return { settings, currentUser, sprints: [] };
	}

	// Phase 4: for each user iteration, fetch teamDaysOff + sprint items (WIQL + hydration) in parallel
	const sprintData = await Promise.all(
		userIterations.map(async ({ iter, cap }) => {
			const currentCapacity = cap.find((entry) => matchesIdentity(entry.teamMember, currentUser));
			const [teamDaysOff, items] = await Promise.all([
				getCachedTeamDaysOff(settings, iter),
				getCachedSprintItems(settings, iter),
			]);
			return { iter, currentCapacity, teamDaysOff, items };
		}),
	);

	// Phase 5: build sprint results
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

	return { settings, currentUser, sprints: sortSprintResults(sprintResults) };
}

function getDefaultSprintId(sprints) {
	const today = toLocalDayStart(new Date());
	const currentSprint = sprints.find((sprint) => {
		if (!sprint.startDate || !sprint.finishDate) {
			return false;
		}

		const start = toLocalDayStart(sprint.startDate);
		const finish = toLocalDayStart(sprint.finishDate);
		return start <= today && finish >= today;
	});

	return currentSprint?.id || sprints[0]?.id || "";
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

	return {
		startedTasks: sprint.workedItems.length,
		sumHours: Number(sumHours.toFixed(4)),
		completedDays: consideredDays,
		dailyAverage: Number(dailyAverage.toFixed(4)),
		selectedSprint: sprint.id,
		selectedSprintLabel: sprint.label,
	};
}

// ---- Recent changes ----

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
	// Keep currentRev alongside each normalized item so reverse paging can start at the right offset.
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

	// Scans revisions from newest → oldest in pages of PAGE_SIZE.
	// Fetches one extra revision before each block as the "previous" for cross-block comparisons.
	// Stops as soon as a qualifying CompletedWork change is found, or as soon as a revision
	// falls entirely before the date window (all older revisions will also be out of range).
	async function findCompletedWorkChangeReverse(workItemId, currentRev) {
		if (currentRev < 1) return null;
		const PAGE_SIZE = 10;
		let blockEnd = currentRev;

		while (blockEnd >= 1) {
			const blockStart = Math.max(1, blockEnd - PAGE_SIZE + 1);
			// 0-based skip: fetch one revision before blockStart for comparison, when available.
			const fetchSkip = Math.max(0, blockStart - 2);
			const fetchTop = blockEnd - fetchSkip; // covers indices fetchSkip..blockEnd-1 (0-based)

			const url =
				`https://dev.azure.com/${encodePathPart(dataset.settings.organization)}/` +
				`${encodePathPart(dataset.settings.projectName)}/_apis/wit/workItems/` +
				`${encodePathPart(workItemId)}/revisions?$top=${fetchTop}&$skip=${fetchSkip}&api-version=${API_VERSION}`;

			const response = await azureFetchJson(url, { tokenValue: dataset.settings.tokenValue });
			const revisions = response.value || [];
			if (!revisions.length) break;

			// Iterate newest → oldest within the fetched block.
			for (let i = revisions.length - 1; i >= 0; i -= 1) {
				const current = revisions[i];
				const revNum = Number(current.rev || 0);

				// Revisions below blockStart are padding used only as "previous" — skip matching.
				if (revNum < blockStart) break;

				const changedAt = getRevisionChangedDate(current);
				if (!changedAt) continue;

				// Revision is entirely before the window → no need to scan any older revisions.
				if (changedAt < dateWindow.start) return null;

				// Revision is within the window → check if CompletedWork changed vs the previous revision.
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

			// Advance to the block that ends just before this one started.
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

// ---- Message handler ----

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	const allowed = new Set([
		"getSettings",
		"saveSettings",
		"clearUserData",
		"listProjects",
		"listTeams",
		"listSprints",
		"openAzureAndCollect",
		"listRecentChanges",
	]);

	if (!allowed.has(message?.action)) return;

	(async () => {
		try {
			switch (message.action) {
				case "getSettings":
					sendResponse({ ok: true, ...(await getSettings()) });
					break;
				case "saveSettings":
					await saveSettings(message.settings || {});
					sendResponse({ ok: true });
					break;
				case "clearUserData":
					await clearUserData();
					sendResponse({ ok: true });
					break;
				case "listProjects":
					sendResponse({ ok: true, ...(await listProjects(message.organization, message.tokenValue)) });
					break;
				case "listTeams":
					sendResponse({ ok: true, ...(await listTeams(message.organization, message.projectId, message.tokenValue)) });
					break;
				case "listSprints":
					sendResponse({ ok: true, ...(await listSprints()) });
					break;
				case "openAzureAndCollect":
					sendResponse({ ok: true, metrics: await collectMetrics(message.sprintId, Boolean(message.includeCurrentDay)) });
					break;
				case "listRecentChanges":
					sendResponse({ ok: true, items: await listRecentChanges() });
					break;
			}
		} catch (error) {
			sendResponse({
				ok: false,
				error: error instanceof Error ? error.message : "Erro ao consultar API do Azure.",
			});
		}
	})();

	return true;
});
