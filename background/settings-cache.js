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
	return `${settings.organization}|${settings.projectId}|${settings.teamId}|${settings.selectedUserId || settings.selectedUserUniqueName || "me"}`;
}
