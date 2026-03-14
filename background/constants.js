// Shared constants and in-memory cache for background modules.

const SETTINGS_STORAGE_KEY = "azureSettings";
const API_VERSION = "7.1";
const CAPACITY_API_VERSION = "6.0";
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const TTL = {
	user: 30 * 60 * 1000,
	teamSettings: 15 * 60 * 1000,
	iterations: 10 * 60 * 1000,
	capacityHot: 2 * 60 * 1000,
	capacityCold: 20 * 60 * 1000,
	daysOffHot: 3 * 60 * 1000,
	daysOffCold: 20 * 60 * 1000,
	itemsHot: 2 * 60 * 1000,
	itemsCold: 15 * 60 * 1000,
	recentChanges: 60 * 1000,
};

const DEFAULT_SETTINGS = {
	tokens: [],
	selectedTokenId: "",
	tokenConfigurations: {},
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

const cache = {
	user: null,
	teamSettings: null,
	iterations: null,
	capacity: new Map(),
	teamDaysOff: new Map(),
	sprintItems: new Map(),
	recentChanges: null,
};

let cacheContextKey = "";
