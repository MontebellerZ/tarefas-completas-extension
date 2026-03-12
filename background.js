let cachedAzureUrl;
let cachedWorkItems = null;
let cachedWorkItemsAt = 0;
const WORK_ITEMS_CACHE_TTL_MS = 60000;

async function loadAzureUrlFromEnv() {
  if (cachedAzureUrl) {
    return cachedAzureUrl;
  }

  const envUrl = chrome.runtime.getURL(".env");
  const response = await fetch(envUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Nao foi possivel ler o arquivo .env da extensao.");
  }

  const text = await response.text();
  const lines = text.split(/\r?\n/);
  const env = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    env[key] = value;
  }

  const azureUrl = env.AZURE_QUERY_URL;
  if (!azureUrl) {
    throw new Error("Defina AZURE_QUERY_URL no arquivo .env.");
  }

  cachedAzureUrl = azureUrl;
  return azureUrl;
}

function parseAzureQueryUrl(azureUrl) {
  const url = new URL(azureUrl);
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));

  if (parts.length < 5 || parts[2] !== "_queries" || parts[3] !== "query") {
    throw new Error("AZURE_QUERY_URL invalida. Use o formato .../{projeto}/_queries/query/{id}.");
  }

  return {
    origin: url.origin,
    organization: parts[0],
    project: parts[1],
    queryId: parts[4],
  };
}

async function azureFetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Sessao do Azure DevOps nao autenticada no Chrome.");
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Falha na API do Azure (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}

async function loadQueryDefinition(ctx) {
  const queryUrl =
    `${ctx.origin}/${encodeURIComponent(ctx.organization)}/` +
    `${encodeURIComponent(ctx.project)}/_apis/wit/queries/${ctx.queryId}?$expand=2&api-version=7.1`;

  return azureFetchJson(queryUrl);
}

async function runWiqlQuery(ctx, wiql) {
  const wiqlUrl =
    `${ctx.origin}/${encodeURIComponent(ctx.organization)}/` +
    `${encodeURIComponent(ctx.project)}/_apis/wit/wiql?api-version=7.1`;

  const result = await azureFetchJson(wiqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: wiql }),
  });

  return (result.workItems || []).map((item) => item.id).filter((id) => Number.isInteger(id));
}

function chunkIds(ids, size) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

async function fetchCompletedWorkValues(ctx, ids) {
  if (!ids.length) {
    return [];
  }

  const batchUrl =
    `${ctx.origin}/${encodeURIComponent(ctx.organization)}/` +
    `${encodeURIComponent(ctx.project)}/_apis/wit/workitemsbatch?api-version=7.1`;

  const idChunks = chunkIds(ids, 200);
  const values = [];

  for (const chunk of idChunks) {
    const payload = {
      ids: chunk,
      fields: ["Microsoft.VSTS.Scheduling.CompletedWork", "System.IterationPath"],
      errorPolicy: "Omit",
    };

    const result = await azureFetchJson(batchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    for (const item of result.value || []) {
      const rawCompletedWork = item.fields?.["Microsoft.VSTS.Scheduling.CompletedWork"];
      const completedWork = Number(rawCompletedWork);
      if (!Number.isFinite(completedWork)) {
        continue;
      }

      const iterationPath = String(item.fields?.["System.IterationPath"] || "").trim();
      values.push({ completedWork, iterationPath });
    }
  }

  return values;
}

function sortIterationPaths(iterationPaths) {
  return [...iterationPaths].sort((a, b) =>
    b.localeCompare(a, "pt-BR", {
      numeric: true,
      sensitivity: "base",
    }),
  );
}

async function loadWorkItemsFromApi(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedWorkItems && now - cachedWorkItemsAt < WORK_ITEMS_CACHE_TTL_MS) {
    return cachedWorkItems;
  }

  const azureUrl = await loadAzureUrlFromEnv();
  const ctx = parseAzureQueryUrl(azureUrl);

  const queryDefinition = await loadQueryDefinition(ctx);
  const wiql = queryDefinition.wiql;

  if (!wiql) {
    throw new Error("A query nao retornou WIQL.");
  }

  const ids = await runWiqlQuery(ctx, wiql);
  const workItems = await fetchCompletedWorkValues(ctx, ids);

  cachedWorkItems = workItems;
  cachedWorkItemsAt = now;

  return workItems;
}

function buildSprintOptions(workItems) {
  const unique = new Set();
  for (const item of workItems) {
    if (item.iterationPath) {
      unique.add(item.iterationPath);
    }
  }

  return sortIterationPaths(unique);
}

async function collectMetricsFromApi(days, selectedSprint) {
  const workItems = await loadWorkItemsFromApi();
  const sprint = String(selectedSprint || "").trim();

  const filteredItems = sprint
    ? workItems.filter((item) => item.iterationPath === sprint)
    : workItems;

  const completedWorkValues = filteredItems.map((item) => item.completedWork);

  const sum = completedWorkValues.reduce((acc, value) => acc + value, 0);
  const dailyAverage = days > 0 ? sum / days : 0;

  return {
    startedTasks: completedWorkValues.length,
    sumHours: Number(sum.toFixed(4)),
    completedDays: days,
    dailyAverage: Number(dailyAverage.toFixed(4)),
    selectedSprint: sprint,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== "openAzureAndCollect" && message?.action !== "listSprints") {
    return;
  }

  (async () => {
    try {
      if (message.action === "listSprints") {
        const workItems = await loadWorkItemsFromApi(true);
        const sprints = buildSprintOptions(workItems);
        sendResponse({ ok: true, sprints, defaultSprint: sprints[0] || "" });
        return;
      }

      const days = Number.isFinite(Number(message.days)) ? Number(message.days) : 15;
      const sprint = String(message.sprint || "").trim();
      const metrics = await collectMetricsFromApi(days, sprint);

      sendResponse({ ok: true, metrics });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Erro ao consultar API do Azure.",
      });
    }
  })();

  return true;
});
