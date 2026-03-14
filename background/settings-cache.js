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

	return {
		...base,
		tokens,
		selectedTokenId: selectedToken?.id || "",
		tokenName: selectedToken?.name || "",
		tokenValue: selectedToken?.value || "",
	};
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
	const merged = {
		...current,
		...settings,
		tokens: current.tokens,
		selectedTokenId,
	};
	merged.organization = normalizeOrganization(merged.organization);
	const tokenChanged = selectedTokenId !== current.selectedTokenId;
	await persistSettings(tokenChanged ? clearScopedSelections(merged) : merged);
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
	const nextSettings = clearScopedSelections({
		...current,
		tokens: [...current.tokens, nextToken],
		selectedTokenId: nextToken.id,
	});
	await persistSettings(nextSettings);
	return { tokenId: nextToken.id };
}

async function deleteToken(tokenId) {
	const current = normalizeStoredSettings(await getStoredSettingsValue());
	const nextTokens = current.tokens.filter((token) => token.id !== tokenId);
	const nextSelectedToken = nextTokens[0] || null;
	const nextSettings = clearScopedSelections({
		...current,
		tokens: nextTokens,
		selectedTokenId: nextSelectedToken?.id || "",
	});
	await persistSettings(nextSettings);
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
