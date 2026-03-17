importScripts(
	"background/constants.js",
	"background/settings-cache.js",
	"background/api-client.js",
	"background/domain-utils.js",
	"background/sprints-service.js",
	"background/recent-changes-service.js",
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	const allowed = new Set([
		"getSettings",
		"saveSettings",
		"listTokens",
		"saveToken",
		"deleteToken",
		"clearUserData",
		"listOrganizations",
		"listProjects",
		"listTeams",
		"listUsers",
		"listSprints",
		"listProjectWorkItemStates",
		"getProjectStatusMapping",
		"saveProjectStatusMapping",
		"openAzureAndCollect",
		"listSprintItemsByMetricBucket",
		"listRecentChanges",
		"listCriticalPendingAnalyses",
		"requireCriticalAnalysis",
	]);

	if (!allowed.has(message?.action)) return;

	(async () => {
		try {
			switch (message.action) {
				case "getSettings":
					sendResponse({ ok: true, ...(await getSettings()) });
					break;
				case "listTokens":
					sendResponse({ ok: true, ...(await listTokens()) });
					break;
				case "saveToken":
					sendResponse({ ok: true, ...(await saveToken(message.token || {})) });
					break;
				case "deleteToken":
					sendResponse({ ok: true, ...(await deleteToken(message.tokenId)) });
					break;
				case "listOrganizations":
					sendResponse({ ok: true, ...(await listOrganizations(message.tokenValue)) });
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
				case "listUsers":
					sendResponse({ ok: true, ...(await listUsers(message.organization, message.projectId, message.teamId, message.tokenValue)) });
					break;
				case "listSprints":
					sendResponse({ ok: true, ...(await listSprints({ profile: message.profile })) });
					break;
				case "listProjectWorkItemStates": {
					const settings = await getSettings();
					const organization = normalizeOrganization(message.organization || settings.organization);
					const projectId = String(message.projectId || settings.projectId || "").trim();
					const projectName = String(message.projectName || settings.projectName || "").trim();
					const profile = String(message.profile || settings.selectedProfile || VIEW_PROFILES.ANALYST).trim().toLowerCase();
					const discovery = await listProjectWorkItemStates(organization, projectName, message.tokenValue || settings.tokenValue);

					let statusMapping = null;
					if (projectId) {
						statusMapping = await saveProjectStatusDiscovery({
							organization,
							projectId,
							profile,
							workItemTypes: discovery.workItemTypes,
							availableStates: discovery.availableStates,
						});
					}

					sendResponse({ ok: true, ...discovery, statusMapping });
					break;
				}
				case "getProjectStatusMapping": {
					const settings = await getSettings();
					const organization = normalizeOrganization(message.organization || settings.organization);
					const projectId = String(message.projectId || settings.projectId || "").trim();
					const profile = String(message.profile || settings.selectedProfile || VIEW_PROFILES.ANALYST).trim().toLowerCase();
					sendResponse({ ok: true, mapping: await getProjectStatusMapping(organization, projectId, profile) });
					break;
				}
				case "saveProjectStatusMapping": {
					const settings = await getSettings();
					const organization = normalizeOrganization(message.organization || settings.organization);
					const projectId = String(message.projectId || settings.projectId || "").trim();
					const profile = String(message.profile || settings.selectedProfile || VIEW_PROFILES.ANALYST).trim().toLowerCase();
					const mapping = await saveProjectStatusMapping({
						...(message.mapping || {}),
						organization,
						projectId,
						profile,
					});
					sendResponse({ ok: true, mapping });
					break;
				}
				case "openAzureAndCollect":
					sendResponse({
						ok: true,
						metrics: await collectMetrics(message.sprintId, Boolean(message.includeCurrentDay), {
							profile: message.profile,
							scope: message.scope,
							selectedUser: message.selectedUser,
						}),
					});
					break;
				case "listSprintItemsByMetricBucket":
					sendResponse({
						ok: true,
						items: await listSprintItemsByMetricBucket(message.sprintId, message.metricBucket, {
							profile: message.profile,
							scope: message.scope,
							selectedUser: message.selectedUser,
						}),
					});
					break;
				case "listRecentChanges":
					sendResponse({
						ok: true,
						items: await listRecentChanges({
							profile: message.profile,
							scope: message.scope,
							selectedUser: message.selectedUser,
						}),
					});
					break;
				case "listCriticalPendingAnalyses":
					sendResponse({
						ok: true,
						items: await listCriticalPendingAnalyses({
							profile: message.profile,
							scope: message.scope,
							selectedUser: message.selectedUser,
						}),
					});
					break;
				case "requireCriticalAnalysis":
					sendResponse({
						ok: true,
						...(await requireCriticalAnalysisComment(message.workItemId, message.responsibleIdentity)),
					});
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
