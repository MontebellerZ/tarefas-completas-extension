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
		"clearUserData",
		"listProjects",
		"listTeams",
		"listSprints",
		"openAzureAndCollect",
		"listRecentChanges",
	]);

	if (!allowed.has(message?.action)) return;

	(async () => {
		try {
			switch (message.action) {
				case "getSettings":
					sendResponse({ ok: true, ...(await getSettings()) });
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
				case "listSprints":
					sendResponse({ ok: true, ...(await listSprints()) });
					break;
				case "openAzureAndCollect":
					sendResponse({
						ok: true,
						metrics: await collectMetrics(message.sprintId, Boolean(message.includeCurrentDay)),
					});
					break;
				case "listRecentChanges":
					sendResponse({ ok: true, items: await listRecentChanges() });
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
