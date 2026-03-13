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
	if (typeof identity === "string") {
		addIdentityCandidate(values, identity);
		return values;
	}
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
	for (const v of ls) {
		if (rs.has(v)) return true;
	}
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
	if (!iterationAttributes?.startDate || !iterationAttributes?.finishDate) return [];

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
		if (sprintIsPast) return true;
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
	if (!dateKeys.length) return null;
	const sorted = [...dateKeys].sort();
	const start = new Date(`${sorted[0]}T00:00:00`);
	const end = new Date(`${sorted[sorted.length - 1]}T23:59:59.999`);
	return { start, end };
}

function splitTags(tags) {
	if (!tags) return [];
	return String(tags)
		.split(";")
		.map((tag) => tag.trim())
		.filter(Boolean);
}

function formatIterationPath(iterationPath, fallbackProject = "") {
	const path = String(iterationPath || "").trim();
	if (!path) return fallbackProject || "Sem sprint";
	const sprintMatch = path.match(/Sprint\s*(\d+)/i);
	if (sprintMatch) return `Sprint ${sprintMatch[1]}`;
	const parts = path.split("\\").filter(Boolean);
	return parts[0] || fallbackProject || "Sem sprint";
}

function sortSprintResults(results) {
	return [...results].sort((left, right) => {
		const leftMatch = String(left.label || "").match(/Sprint\s*(\d+)/i);
		const rightMatch = String(right.label || "").match(/Sprint\s*(\d+)/i);
		const leftNumber = leftMatch ? Number(leftMatch[1]) : null;
		const rightNumber = rightMatch ? Number(rightMatch[1]) : null;

		if (leftNumber != null && rightNumber != null) return rightNumber - leftNumber;

		return String(left.label || "").localeCompare(String(right.label || ""), "pt-BR", {
			sensitivity: "base",
			numeric: true,
		});
	});
}

function getDefaultSprintId(sprints) {
	const today = toLocalDayStart(new Date());
	const currentSprint = sprints.find((sprint) => {
		if (!sprint.startDate || !sprint.finishDate) return false;
		const start = toLocalDayStart(sprint.startDate);
		const finish = toLocalDayStart(sprint.finishDate);
		return start <= today && finish >= today;
	});

	return currentSprint?.id || sprints[0]?.id || "";
}
