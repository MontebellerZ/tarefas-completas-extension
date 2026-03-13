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

async function listUsers(organization, projectId, teamId, tokenValue) {
	const org = normalizeOrganization(organization);
	if (!org || !projectId || !teamId) {
		throw new Error("Selecione organizacao, projeto e time para carregar os usuarios.");
	}

	const response = await azureFetchJson(
		`https://dev.azure.com/${encodePathPart(org)}/_apis/projects/${encodePathPart(projectId)}/teams/${encodePathPart(teamId)}/members?api-version=7.1-preview.1`,
		{ tokenValue },
	);

	const source = Array.isArray(response?.value)
		? response.value
		: Array.isArray(response?.members)
			? response.members
			: [];

	const byKey = new Map();
	for (const rawMember of source) {
		const identity = rawMember?.identity || rawMember?.member || rawMember;
		const id = String(identity?.id || "").trim();
		const descriptor = String(identity?.descriptor || "").trim();
		const uniqueName = String(identity?.uniqueName || identity?.mailAddress || identity?.emailAddress || "").trim();
		const displayName = String(identity?.displayName || identity?.name || identity?.providerDisplayName || uniqueName || "").trim();
		const key = id || descriptor || uniqueName || displayName;
		if (!key || byKey.has(key)) continue;
		byKey.set(key, {
			value: id || descriptor || uniqueName,
			label: uniqueName && uniqueName !== displayName ? `${displayName} (${uniqueName})` : displayName,
			id,
			name: displayName,
			uniqueName,
			descriptor,
		});
	}

	return {
		users: [...byKey.values()].sort((left, right) =>
			String(left.label || "").localeCompare(String(right.label || ""), "pt-BR", { sensitivity: "base" }),
		),
	};
}

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

function buildAssignedToCondition(targetUser) {
	if (!targetUser || targetUser.isMe) {
		return `[System.AssignedTo] = @Me`;
	}

	const identityValue = String(targetUser.uniqueName || targetUser.displayName || targetUser.name || "").trim();
	if (!identityValue) {
		return `[System.AssignedTo] = @Me`;
	}

	return `[System.AssignedTo] = '${identityValue.replace(/'/g, "''")}'`;
}

function buildSprintItemsWiql(projectName, iterationPath, targetUser) {
	const p = projectName.replace(/'/g, "''");
	const ip = iterationPath.replace(/'/g, "''");
	return (
		`SELECT [System.Id] FROM WorkItems` +
		` WHERE [System.TeamProject] = '${p}'` +
		` AND ${buildAssignedToCondition(targetUser)}` +
		` AND [System.WorkItemType] IN ('Task', 'Bug')` +
		` AND [System.IterationPath] = '${ip}'` +
		` AND [Microsoft.VSTS.Scheduling.CompletedWork] > 0` +
		` ORDER BY [System.Id]`
	);
}

function buildRecentChangesWiql(projectName, sinceDateKey, targetUser) {
	const p = projectName.replace(/'/g, "''");
	return (
		`SELECT [System.Id] FROM WorkItems` +
		` WHERE [System.TeamProject] = '${p}'` +
		` AND ${buildAssignedToCondition(targetUser)}` +
		` AND [System.WorkItemType] IN ('Task', 'Bug')` +
		` AND [Microsoft.VSTS.Scheduling.CompletedWork] > 0` +
		` AND [System.ChangedDate] >= '${sinceDateKey}'` +
		` ORDER BY [System.ChangedDate] DESC`
	);
}
