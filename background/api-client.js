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

async function listOrganizations(tokenValue) {
	const normalizedToken = String(tokenValue || "").trim();
	if (!normalizedToken) {
		throw new Error("Informe o PAT para carregar as organizacoes.");
	}

	const profile = await azureFetchJson(
		"https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1-preview.3",
		{ tokenValue: normalizedToken },
	);

	const memberId = String(profile?.id || "").trim();
	if (!memberId) {
		throw new Error("Nao foi possivel identificar o perfil do PAT.");
	}

	const accounts = await azureFetchJson(
		`https://app.vssps.visualstudio.com/_apis/accounts?memberId=${encodePathPart(memberId)}&api-version=7.1-preview.1`,
		{ tokenValue: normalizedToken },
	);

	const byOrg = new Map();
	for (const account of accounts?.value || []) {
		const accountName = String(account?.accountName || "").trim();
		if (!accountName) continue;
		if (byOrg.has(accountName.toLowerCase())) continue;
		byOrg.set(accountName.toLowerCase(), {
			value: accountName,
			label: accountName,
			name: accountName,
		});
	}

	const organizations = [...byOrg.values()].sort((left, right) =>
		String(left.label || "").localeCompare(String(right.label || ""), "pt-BR", { sensitivity: "base" }),
	);

	return {
		organizations,
		defaultOrganization: organizations[0]?.value || "",
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

	function collectIdentityKeys(identity) {
		const keys = new Set();
		if (!identity) return keys;

		const values = [
			identity.id,
			identity.descriptor,
			identity.uniqueName,
			identity.mailAddress,
			identity.emailAddress,
			identity.displayName,
			identity.name,
			identity.providerDisplayName,
		];

		for (const value of values) {
			const normalized = String(value || "").trim().toLowerCase();
			if (!normalized) continue;
			keys.add(normalized);
			const emailMatch = normalized.match(/<([^>]+)>/);
			if (emailMatch?.[1]) {
				keys.add(emailMatch[1].trim().toLowerCase());
			}
		}

		return keys;
	}

	const activeIdentityKeys = new Set();
	const activeMembersByKey = new Map();
	try {
		const iterationsResponse = await azureFetchJson(
			`https://dev.azure.com/${encodePathPart(org)}/${encodePathPart(projectId)}/${encodePathPart(teamId)}/_apis/work/teamsettings/iterations?api-version=${API_VERSION}`,
			{ tokenValue },
		);

		const recentIterations = [...(iterationsResponse.value || [])]
			.sort((left, right) => {
				const leftDate = new Date(left?.attributes?.finishDate || left?.attributes?.startDate || 0).getTime();
				const rightDate = new Date(right?.attributes?.finishDate || right?.attributes?.startDate || 0).getTime();
				return rightDate - leftDate;
			})
			.slice(0, 5);

		const capacitiesPerIteration = await Promise.all(
			recentIterations.map(async (iteration) => {
				const capacityResponse = await azureFetchJson(
					`https://dev.azure.com/${encodePathPart(org)}/${encodePathPart(projectId)}/${encodePathPart(teamId)}/_apis/work/teamsettings/iterations/${encodePathPart(iteration.id)}/capacities?api-version=${CAPACITY_API_VERSION}`,
					{ tokenValue },
				);

				return Array.isArray(capacityResponse?.value)
					? capacityResponse.value
					: Array.isArray(capacityResponse)
						? capacityResponse
						: [];
			}),
		);

		for (const capacities of capacitiesPerIteration) {
			for (const entry of capacities) {
				const memberIdentity = entry?.teamMember;
				for (const key of collectIdentityKeys(memberIdentity)) {
					activeIdentityKeys.add(key);
					if (!activeMembersByKey.has(key)) {
						activeMembersByKey.set(key, memberIdentity);
					}
				}
			}
		}

		// Also consider assignees present in work items from recent sprints.
		const assigneeFields = ["System.AssignedTo"];
		for (const iteration of recentIterations) {
			const iterationPath = String(iteration?.path || iteration?.name || "").trim();
			if (!iterationPath) continue;

			const wiql =
				`SELECT [System.Id] FROM WorkItems` +
				` WHERE [System.IterationPath] = '${iterationPath.replace(/'/g, "''")}'` +
				` AND [System.WorkItemType] IN ('Task', 'Bug')` +
				` ORDER BY [System.Id]`;

			const wiqlResponse = await azureFetchJson(
				`https://dev.azure.com/${encodePathPart(org)}/${encodePathPart(projectId)}/_apis/wit/wiql?api-version=${API_VERSION}`,
				{
					tokenValue,
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ query: wiql }),
				},
			);

			const ids = (wiqlResponse.workItems || []).map((item) => item.id).filter(Number.isInteger);
			for (let index = 0; index < ids.length; index += 200) {
				const chunk = ids.slice(index, index + 200);
				const batchResponse = await azureFetchJson(
					`https://dev.azure.com/${encodePathPart(org)}/${encodePathPart(projectId)}/_apis/wit/workitemsbatch?api-version=${API_VERSION}`,
					{
						tokenValue,
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ ids: chunk, fields: assigneeFields, errorPolicy: "Omit" }),
					},
				);

				for (const workItem of batchResponse.value || []) {
					const assignedTo = workItem?.fields?.["System.AssignedTo"];
					for (const key of collectIdentityKeys(assignedTo)) {
						activeIdentityKeys.add(key);
						if (!activeMembersByKey.has(key)) {
							activeMembersByKey.set(key, assignedTo);
						}
					}
				}
			}
		}
	} catch {
		// If capacity lookup fails, gracefully fall back to full members list.
	}

	const source = [];
	let continuationToken = "";
	do {
		let url =
			`https://dev.azure.com/${encodePathPart(org)}/_apis/projects/` +
			`${encodePathPart(projectId)}/teams/${encodePathPart(teamId)}/members?$top=100&api-version=7.1-preview.1`;

		if (continuationToken) {
			url += `&continuationToken=${encodeURIComponent(continuationToken)}`;
		}

		const saved = await getSettings();
		const effectiveTokenValue = String(tokenValue ?? saved.tokenValue ?? "").trim();
		if (!effectiveTokenValue) {
			throw new Error("PAT nao configurado.");
		}

		const response = await fetch(url, {
			credentials: "omit",
			headers: {
				Accept: "application/json",
				Authorization: createAuthHeader(effectiveTokenValue),
			},
		});

		if (response.status === 401 || response.status === 403) {
			throw new Error("PAT invalido ou sem permissao suficiente no Azure DevOps.");
		}

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Falha na API do Azure (${response.status}): ${text.slice(0, 200)}`);
		}

		const body = await response.json();
		const pageMembers = Array.isArray(body?.value)
			? body.value
			: Array.isArray(body?.members)
				? body.members
				: [];
		source.push(...pageMembers);

		continuationToken =
			String(response.headers.get("x-ms-continuationtoken") || response.headers.get("X-MS-ContinuationToken") || "").trim();
	} while (continuationToken);

	// Ensure people active in recent sprint capacities are present even if members endpoint omitted them.
	for (const memberIdentity of activeMembersByKey.values()) {
		source.push({ identity: memberIdentity });
	}

	const byKey = new Map();
	for (const rawMember of source) {
		const identity = rawMember?.identity || rawMember?.member || rawMember;
		const identityKeys = collectIdentityKeys(identity);

		if (activeIdentityKeys.size > 0) {
			let isActive = false;
			for (const key of identityKeys) {
				if (activeIdentityKeys.has(key)) {
					isActive = true;
					break;
				}
			}
			if (!isActive) continue;
		}

		const id = String(identity?.id || "").trim();
		const descriptor = String(identity?.descriptor || "").trim();
		const uniqueName = String(identity?.uniqueName || identity?.mailAddress || identity?.emailAddress || "").trim();
		const displayName = String(identity?.displayName || identity?.name || identity?.providerDisplayName || uniqueName || "").trim();
		const normalizedDisplayName = displayName.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s{2,}/g, " ").trim() || displayName;
		const key = id || descriptor || uniqueName || displayName;
		if (!key || byKey.has(key)) continue;
		byKey.set(key, {
			value: id || descriptor || uniqueName,
			label: normalizedDisplayName,
			id,
			name: normalizedDisplayName,
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

async function listProjectWorkItemStates(organization, projectName, tokenValue) {
	const saved = await getSettings();
	const org = normalizeOrganization(organization || saved.organization);
	const project = String(projectName || saved.projectName || "").trim();
	const effectiveTokenValue = String(tokenValue || saved.tokenValue || "").trim();

	if (!org || !project) {
		throw new Error("Informe organização e projeto para descobrir os status do work item.");
	}

	const typesResponse = await azureFetchJson(
		`https://dev.azure.com/${encodePathPart(org)}/${encodePathPart(project)}/_apis/wit/workitemtypes?api-version=${API_VERSION}`,
		{ tokenValue: effectiveTokenValue },
	);

	const workItemTypes = (typesResponse.value || [])
		.map((type) => String(type?.name || "").trim())
		.filter(Boolean)
		.filter((typeName) => {
			const normalized = typeName.toLowerCase();
			return normalized === "task" || normalized === "bug";
		})
		.sort((left, right) => left.localeCompare(right, "pt-BR", { sensitivity: "base" }));

	if (!workItemTypes.length) {
		throw new Error("Não foi possível localizar os tipos Task/Bug para o projeto selecionado.");
	}

	const statesByType = await Promise.all(
		workItemTypes.map(async (typeName) => {
			const statesResponse = await azureFetchJson(
				`https://dev.azure.com/${encodePathPart(org)}/${encodePathPart(project)}/_apis/wit/workitemtypes/${encodePathPart(typeName)}/states?api-version=${API_VERSION}`,
				{ tokenValue: effectiveTokenValue },
			);

			return (statesResponse.value || []).map((state) => ({
				type: typeName,
				name: String(state?.name || "").trim(),
				category: String(state?.category || "").trim(),
				color: String(state?.color || "").trim(),
			}));
		}),
	);

	const flatStates = statesByType.flat().filter((state) => Boolean(state.name));
	const byStateName = new Map();
	for (const state of flatStates) {
		const key = state.name.toLowerCase();
		if (!byStateName.has(key)) {
			byStateName.set(key, state.name);
		}
	}

	const availableStates = [...byStateName.values()].sort((left, right) =>
		left.localeCompare(right, "pt-BR", { sensitivity: "base" }),
	);

	return {
		organization: org,
		projectName: project,
		workItemTypes,
		availableStates,
		states: flatStates,
		discoveredAt: Date.now(),
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
	if (targetUser?.isAllUsers) {
		return "";
	}

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
	const assignedToCondition = buildAssignedToCondition(targetUser);
	const assignedToClause = assignedToCondition ? ` AND ${assignedToCondition}` : "";
	return (
		`SELECT [System.Id] FROM WorkItems` +
		` WHERE [System.TeamProject] = '${p}'` +
		assignedToClause +
		` AND [System.WorkItemType] IN ('Task', 'Bug')` +
		` AND [System.IterationPath] = '${ip}'` +
		` AND [Microsoft.VSTS.Scheduling.CompletedWork] > 0` +
		` ORDER BY [System.Id]`
	);
}

function buildRecentChangesWiql(projectName, sinceDateKey, targetUser) {
	const p = projectName.replace(/'/g, "''");
	const assignedToCondition = buildAssignedToCondition(targetUser);
	const assignedToClause = assignedToCondition ? ` AND ${assignedToCondition}` : "";
	return (
		`SELECT [System.Id] FROM WorkItems` +
		` WHERE [System.TeamProject] = '${p}'` +
		assignedToClause +
		` AND [System.WorkItemType] IN ('Task', 'Bug')` +
		` AND [Microsoft.VSTS.Scheduling.CompletedWork] > 0` +
		` AND [System.ChangedDate] >= '${sinceDateKey}'` +
		` ORDER BY [System.ChangedDate] DESC`
	);
}

async function requireCriticalAnalysisComment(workItemId, responsibleIdentity) {
	const settings = await getSettings();
	ensureRequiredSettings(settings);

	const itemId = Number(workItemId);
	if (!Number.isInteger(itemId) || itemId <= 0) {
		throw new Error("ID do item inválido para solicitar análise crítica.");
	}

	const responsible = responsibleIdentity && typeof responsibleIdentity === "object" ? responsibleIdentity : {};
	const descriptor = String(responsible.descriptor || "").trim();
	const displayName = String(responsible.displayName || responsible.name || responsible.uniqueName || "").trim();
	if (!descriptor || !displayName) {
		throw new Error("Não foi possível identificar o responsável para menção rica no comentário.");
	}

	const mentionHtml = `<a href=\"#\" data-vss-mention=\"version:2.0,${descriptor}\">@${displayName}</a>`;
	const commentText = `${mentionHtml} lembrete para realizar a análise crítica deste item.`;

	await azureFetchJson(
		`https://dev.azure.com/${encodePathPart(settings.organization)}/${encodePathPart(settings.projectName)}/_apis/wit/workItems/${encodePathPart(itemId)}/comments?api-version=7.1-preview.4`,
		{
			tokenValue: settings.tokenValue,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				text: commentText,
				renderedText: commentText,
				mentions: [
					{
						descriptor,
						displayName,
					},
				],
			}),
		},
	);

	return { commented: true };
}
