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
	listSprints: () => sendRuntimeMessage({ action: "listSprints" }),
	listProjectWorkItemStates: (organization, projectId, projectName, tokenValue) =>
		sendRuntimeMessage({ action: "listProjectWorkItemStates", organization, projectId, projectName, tokenValue }),
	getProjectStatusMapping: (organization, projectId) =>
		sendRuntimeMessage({ action: "getProjectStatusMapping", organization, projectId }),
	saveProjectStatusMapping: (organization, projectId, mapping) =>
		sendRuntimeMessage({ action: "saveProjectStatusMapping", organization, projectId, mapping }),
	collectMetrics: (sprintId, includeCurrentDay) =>
		sendRuntimeMessage({ action: "openAzureAndCollect", sprintId, includeCurrentDay }),
	listSprintItemsByMetricBucket: (sprintId, metricBucket) =>
		sendRuntimeMessage({ action: "listSprintItemsByMetricBucket", sprintId, metricBucket }),
	listRecentChanges: () => sendRuntimeMessage({ action: "listRecentChanges" }),
	listCriticalPendingAnalyses: () => sendRuntimeMessage({ action: "listCriticalPendingAnalyses" }),
};
