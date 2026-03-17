function sendRuntimeMessage(message) {
	return new Promise((resolve, reject) => {
		chrome.runtime.sendMessage(message, (response) => {
			const runtimeError = chrome.runtime.lastError;
			if (runtimeError) {
				reject(new Error(runtimeError.message));
				return;
			}
			resolve(response);
		});
	});
}

window.PopupApi = {
	sendRuntimeMessage,
	getSettings: () => sendRuntimeMessage({ action: "getSettings" }),
	listTokens: () => sendRuntimeMessage({ action: "listTokens" }),
	saveToken: (token) => sendRuntimeMessage({ action: "saveToken", token }),
	deleteToken: (tokenId) => sendRuntimeMessage({ action: "deleteToken", tokenId }),
	listOrganizations: (tokenValue) => sendRuntimeMessage({ action: "listOrganizations", tokenValue }),
	saveSettings: (settings) => sendRuntimeMessage({ action: "saveSettings", settings }),
	clearUserData: () => sendRuntimeMessage({ action: "clearUserData" }),
	listProjects: (organization, tokenValue) =>
		sendRuntimeMessage({ action: "listProjects", organization, tokenValue }),
	listTeams: (organization, projectId, tokenValue) =>
		sendRuntimeMessage({ action: "listTeams", organization, projectId, tokenValue }),
	listUsers: (organization, projectId, teamId, tokenValue) =>
		sendRuntimeMessage({ action: "listUsers", organization, projectId, teamId, tokenValue }),
	listSprints: (profile) => sendRuntimeMessage({ action: "listSprints", profile }),
	listProjectWorkItemStates: (organization, projectId, projectName, tokenValue, profile) =>
		sendRuntimeMessage({ action: "listProjectWorkItemStates", organization, projectId, projectName, tokenValue, profile }),
	getProjectStatusMapping: (organization, projectId, profile) =>
		sendRuntimeMessage({ action: "getProjectStatusMapping", organization, projectId, profile }),
	saveProjectStatusMapping: (organization, projectId, mapping, profile) =>
		sendRuntimeMessage({ action: "saveProjectStatusMapping", organization, projectId, mapping, profile }),
	collectMetrics: (sprintId, includeCurrentDay, profile, scope = "me", selectedUser = null) =>
		sendRuntimeMessage({ action: "openAzureAndCollect", sprintId, includeCurrentDay, profile, scope, selectedUser }),
	listSprintItemsByMetricBucket: (sprintId, metricBucket, profile, scope = "me", selectedUser = null) =>
		sendRuntimeMessage({ action: "listSprintItemsByMetricBucket", sprintId, metricBucket, profile, scope, selectedUser }),
	listRecentChanges: (profile, scope = "me", selectedUser = null) =>
		sendRuntimeMessage({ action: "listRecentChanges", profile, scope, selectedUser }),
	listCriticalPendingAnalyses: (profile, scope = "me", selectedUser = null) =>
		sendRuntimeMessage({ action: "listCriticalPendingAnalyses", profile, scope, selectedUser }),
	requireCriticalAnalysis: (workItemId, responsibleIdentity, profile) =>
		sendRuntimeMessage({ action: "requireCriticalAnalysis", workItemId, responsibleIdentity, profile }),
};
