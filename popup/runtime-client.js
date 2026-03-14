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
	collectMetrics: (sprintId, includeCurrentDay) =>
		sendRuntimeMessage({ action: "openAzureAndCollect", sprintId, includeCurrentDay }),
	listRecentChanges: () => sendRuntimeMessage({ action: "listRecentChanges" }),
	listCriticalPendingAnalyses: () => sendRuntimeMessage({ action: "listCriticalPendingAnalyses" }),
};
