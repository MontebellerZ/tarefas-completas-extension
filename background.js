let cachedEnv;
let cachedWorkItems = null;
let cachedWorkItemsAt = 0;
const WORK_ITEMS_CACHE_TTL_MS = 60000;

async function loadEnvVars() {
  if (cachedEnv) {
    return cachedEnv;
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

  cachedEnv = env;
  return env;
}

async function loadQueryUrlFromEnv(key) {
  const env = await loadEnvVars();
  const url = String(env[key] || "").trim();
  if (!url) {
    throw new Error(`Defina ${key} no arquivo .env.`);
  }
  return url;
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

function formatIterationPath(iterationPath, fallbackProject = "") {
  const path = String(iterationPath || "").trim();
  if (!path) {
    return fallbackProject || "Sem sprint";
  }

  const sprintMatch = path.match(/Sprint\s*(\d+)/i);
  if (sprintMatch) {
    return `Sprint ${sprintMatch[1]}`;
  }

  const parts = path.split("\\").filter(Boolean);
  if (!parts.length) {
    return fallbackProject || "Sem sprint";
  }

  return parts[0];
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

async function fetchWorkItemsBatch(ctx, ids, fields) {
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
      fields,
      errorPolicy: "Omit",
    };

    const result = await azureFetchJson(batchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    values.push(...(result.value || []));
  }

  return values;
}

function getSprintNumber(label) {
  const match = String(label || "").match(/Sprint\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function sortSprintOptions(options) {
  return [...options].sort((a, b) => {
    const aNum = getSprintNumber(a.label);
    const bNum = getSprintNumber(b.label);

    if (aNum != null && bNum != null) {
      return bNum - aNum;
    }

    if (aNum != null) {
      return -1;
    }

    if (bNum != null) {
      return 1;
    }

    return a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" });
  });
}

async function loadWorkItemsFromApi(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedWorkItems && now - cachedWorkItemsAt < WORK_ITEMS_CACHE_TTL_MS) {
    return cachedWorkItems;
  }

  const azureUrl = await loadQueryUrlFromEnv("AZURE_QUERY_URL");
  const ctx = parseAzureQueryUrl(azureUrl);

  const queryDefinition = await loadQueryDefinition(ctx);
  const wiql = queryDefinition.wiql;

  if (!wiql) {
    throw new Error("A query nao retornou WIQL.");
  }

  const ids = await runWiqlQuery(ctx, wiql);
  const batchItems = await fetchWorkItemsBatch(ctx, ids, [
    "Microsoft.VSTS.Scheduling.CompletedWork",
    "System.IterationPath",
  ]);

  const workItems = batchItems
    .map((item) => {
      const completedWork = Number(item.fields?.["Microsoft.VSTS.Scheduling.CompletedWork"]);
      if (!Number.isFinite(completedWork)) {
        return null;
      }

      const iterationPath = String(item.fields?.["System.IterationPath"] || "").trim();
      return {
        completedWork,
        iterationPath,
        iterationLabel: formatIterationPath(iterationPath, ctx.project),
      };
    })
    .filter(Boolean);

  cachedWorkItems = workItems;
  cachedWorkItemsAt = now;

  return workItems;
}

function buildSprintOptions(workItems) {
  const unique = new Map();
  for (const item of workItems) {
    if (item.iterationPath) {
      unique.set(item.iterationPath, item.iterationLabel);
    }
  }

  const options = Array.from(unique.entries()).map(([value, label]) => ({ value, label }));
  return sortSprintOptions(options);
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
    selectedSprintLabel:
      filteredItems[0]?.iterationLabel || (sprint ? formatIterationPath(sprint) : "Todas as sprints"),
  };
}

function splitTags(tags) {
  if (!tags) {
    return [];
  }

  return String(tags)
    .split(";")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function loadRecentChangesFromApi() {
  const queryUrl = await loadQueryUrlFromEnv("AZURE_CHANGED_QUERY_URL");
  const ctx = parseAzureQueryUrl(queryUrl);
  const queryDefinition = await loadQueryDefinition(ctx);
  const wiql = queryDefinition.wiql;

  if (!wiql) {
    throw new Error("A query de alterados nao retornou WIQL.");
  }

  const ids = await runWiqlQuery(ctx, wiql);
  const batchItems = await fetchWorkItemsBatch(ctx, ids, [
    "System.Title",
    "System.WorkItemType",
    "Microsoft.VSTS.Scheduling.OriginalEstimate",
    "Microsoft.VSTS.Scheduling.CompletedWork",
    "System.State",
    "System.Tags",
    "System.IterationPath",
    "System.Description",
    "System.ChangedDate",
  ]);

  const items = batchItems.map((item) => {
    const title = String(item.fields?.["System.Title"] || "").trim();
    const type = String(item.fields?.["System.WorkItemType"] || "").trim();
    const estimated = Number(item.fields?.["Microsoft.VSTS.Scheduling.OriginalEstimate"]);
    const completed = Number(item.fields?.["Microsoft.VSTS.Scheduling.CompletedWork"]);
    const state = String(item.fields?.["System.State"] || "").trim();
    const tags = splitTags(item.fields?.["System.Tags"]);
    const iterationPath = String(item.fields?.["System.IterationPath"] || "").trim();
    const description = String(item.fields?.["System.Description"] || "").trim();
    const changedDate = String(item.fields?.["System.ChangedDate"] || "");

    return {
      id: item.id,
      title,
      type,
      estimated: Number.isFinite(estimated) ? Number(estimated.toFixed(4)) : 0,
      completed: Number.isFinite(completed) ? Number(completed.toFixed(4)) : 0,
      state,
      tags,
      sprint: formatIterationPath(iterationPath, ctx.project),
      description,
      changedDate,
      itemUrl:
        `${ctx.origin}/${encodeURIComponent(ctx.organization)}/` +
        `${encodeURIComponent(ctx.project)}/_workitems/edit/${item.id}`,
    };
  });

  items.sort((a, b) => String(b.changedDate).localeCompare(String(a.changedDate)));
  return items;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message?.action !== "openAzureAndCollect" &&
    message?.action !== "listSprints" &&
    message?.action !== "listRecentChanges"
  ) {
    return;
  }

  (async () => {
    try {
      if (message.action === "listSprints") {
        const workItems = await loadWorkItemsFromApi(true);
        const sprints = buildSprintOptions(workItems);
        sendResponse({ ok: true, sprints, defaultSprint: sprints[0]?.value || "" });
        return;
      }

      if (message.action === "listRecentChanges") {
        const items = await loadRecentChangesFromApi();
        sendResponse({ ok: true, items });
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
