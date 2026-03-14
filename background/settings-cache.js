function isFresh(entry, ttl) {
	return !!entry && Date.now() - entry.at < ttl;
}

function createTokenId() {
	return `token-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeTokens(tokens) {
	if (!Array.isArray(tokens)) return [];
	return tokens
		.map((token) => ({
			id: String(token?.id || "").trim() || createTokenId(),
			name: String(token?.name || "").trim(),
			value: String(token?.value || "").trim(),
		}))
		.filter((token) => token.name && token.value);
}

function clearScopedSelections(settings) {
	return {
		...settings,
		organization: "",
		projectId: "",
		projectName: "",
		teamId: "",
		teamName: "",
		selectedUserId: "",
		selectedUserName: "",
		selectedUserUniqueName: "",
		selectedUserDescriptor: "",
	};
}

const TOKEN_SCOPED_FIELDS = [
	"organization",
	"projectId",
	"projectName",
	"teamId",
	"teamName",
	"selectedUserId",
	"selectedUserName",
	"selectedUserUniqueName",
	"selectedUserDescriptor",
];

function getEmptyTokenScopedSettings() {
	return {
		organization: "",
		projectId: "",
		projectName: "",
		teamId: "",
		teamName: "",
		selectedUserId: "",
		selectedUserName: "",
		selectedUserUniqueName: "",
		selectedUserDescriptor: "",
	};
}

function normalizeTokenScopedSettings(rawScopedSettings = {}) {
	const normalized = getEmptyTokenScopedSettings();
	for (const field of TOKEN_SCOPED_FIELDS) {
		normalized[field] = String(rawScopedSettings?.[field] || "").trim();
	}
	normalized.organization = normalizeOrganization(normalized.organization);
	return normalized;
}

function selectTokenScopedSettings(settings, tokenId) {
	const selectedTokenId = String(tokenId || "").trim();
	if (!selectedTokenId) return getEmptyTokenScopedSettings();
	const scoped = settings?.tokenConfigurations?.[selectedTokenId] || {};
	return normalizeTokenScopedSettings(scoped);
}

function applyScopedToSettings(settings, scoped) {
	return {
		...settings,
		...normalizeTokenScopedSettings(scoped),
	};
}

function normalizeTokenConfigurations(rawConfigurations, tokens, fallbackScoped, selectedTokenId) {
	const normalized = {};
	const source = rawConfigurations && typeof rawConfigurations === "object" ? rawConfigurations : {};
	const allowedTokenIds = new Set(tokens.map((token) => token.id));

	for (const [tokenId, scoped] of Object.entries(source)) {
		if (!allowedTokenIds.has(tokenId)) continue;
		normalized[tokenId] = normalizeTokenScopedSettings(scoped);
	}

	if (selectedTokenId && allowedTokenIds.has(selectedTokenId) && !normalized[selectedTokenId]) {
		const fallback = normalizeTokenScopedSettings(fallbackScoped || {});
		const hasAnyValue = TOKEN_SCOPED_FIELDS.some((field) => Boolean(String(fallback[field] || "").trim()));
		if (hasAnyValue) {
			normalized[selectedTokenId] = fallback;
		}
	}

	return normalized;
}

function normalizeStoredSettings(rawSettings = {}) {
	const base = { ...DEFAULT_SETTINGS, ...(rawSettings || {}) };
	let tokens = sanitizeTokens(base.tokens);

	if (!tokens.length && String(rawSettings?.tokenValue || "").trim()) {
		tokens = [
			{
				id: String(rawSettings?.selectedTokenId || "legacy-token").trim() || "legacy-token",
				name: String(rawSettings?.tokenName || "Token principal").trim() || "Token principal",
				value: String(rawSettings?.tokenValue || "").trim(),
			},
		];
	}

	const selectedTokenId = String(base.selectedTokenId || tokens[0]?.id || "").trim();
	const selectedToken = tokens.find((token) => token.id === selectedTokenId) || tokens[0] || null;
	const tokenConfigurations = normalizeTokenConfigurations(base.tokenConfigurations, tokens, base, selectedToken?.id || "");
	const selectedScoped = selectTokenScopedSettings({ tokenConfigurations }, selectedToken?.id || "");

	return applyScopedToSettings({
		...base,
		tokens,
		selectedTokenId: selectedToken?.id || "",
		tokenName: selectedToken?.name || "",
		tokenValue: selectedToken?.value || "",
		tokenConfigurations,
	}, selectedScoped);
}

async function getStoredSettingsValue() {
	const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
	return stored?.[SETTINGS_STORAGE_KEY] || {};
}

async function persistSettings(settings) {
	await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
	invalidateCaches();
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
	return normalizeStoredSettings(await getStoredSettingsValue());
}

async function saveSettings(settings) {
	const current = normalizeStoredSettings(await getStoredSettingsValue());
	const selectedTokenId = String(settings?.selectedTokenId ?? current.selectedTokenId ?? "").trim();
	const merged = applyScopedToSettings({
		...current,
		...settings,
		tokens: current.tokens,
		selectedTokenId,
		tokenConfigurations: {
			...(current.tokenConfigurations || {}),
		},
	}, settings || {});

	if (selectedTokenId) {
		merged.tokenConfigurations[selectedTokenId] = normalizeTokenScopedSettings(merged);
	}

	const selectedScoped = selectTokenScopedSettings(merged, selectedTokenId);
	await persistSettings(applyScopedToSettings(merged, selectedScoped));
}

async function listTokens() {
	const settings = await getSettings();
	return {
		tokens: (settings.tokens || []).map((token) => ({
			value: token.id,
			label: token.name,
			id: token.id,
			name: token.name,
			tokenValue: token.value,
		})),
		selectedTokenId: settings.selectedTokenId || "",
	};
}

async function saveToken(token) {
	const current = normalizeStoredSettings(await getStoredSettingsValue());
	const name = String(token?.name || "").trim();
	const value = String(token?.value || "").trim();
	if (!name || !value) {
		throw new Error("Informe nome e PAT para salvar o token.");
	}

	const nextToken = { id: createTokenId(), name, value };
	const nextSettings = applyScopedToSettings({
		...current,
		tokens: [...current.tokens, nextToken],
		selectedTokenId: nextToken.id,
		tokenConfigurations: {
			...(current.tokenConfigurations || {}),
			[nextToken.id]: getEmptyTokenScopedSettings(),
		},
	}, getEmptyTokenScopedSettings());
	await persistSettings(nextSettings);
	return { tokenId: nextToken.id };
}

async function deleteToken(tokenId) {
	const current = normalizeStoredSettings(await getStoredSettingsValue());
	const nextTokens = current.tokens.filter((token) => token.id !== tokenId);
	const nextSelectedToken = nextTokens[0] || null;
	const nextConfigurations = { ...(current.tokenConfigurations || {}) };
	delete nextConfigurations[tokenId];
	const nextSettings = {
		...current,
		tokens: nextTokens,
		selectedTokenId: nextSelectedToken?.id || "",
		tokenConfigurations: nextConfigurations,
	};
	const selectedScoped = selectTokenScopedSettings(nextSettings, nextSelectedToken?.id || "");
	const normalizedSettings = applyScopedToSettings(nextSettings, selectedScoped);
	if (!nextSelectedToken) {
		Object.assign(normalizedSettings, getEmptyTokenScopedSettings());
	}
	await persistSettings(normalizedSettings);
	return { hasTokens: nextTokens.length > 0, selectedTokenId: nextSelectedToken?.id || "" };
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
	return `${settings.selectedTokenId || "no-token"}|${settings.organization}|${settings.projectId}|${settings.teamId}|${settings.selectedUserId || settings.selectedUserUniqueName || "me"}`;
}
