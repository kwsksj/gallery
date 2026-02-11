import { debounce, el, formatIso, normalizeSearch, qs, qsa, showToast } from "../shared/gallery-core.js";

const ADMIN_API_TOKEN_STORAGE_KEY = "gallery.adminApiToken.v1";
const COMPACT_HEADER_MEDIA_QUERY = "(max-width: 760px)";
const JST_TIME_ZONE = "Asia/Tokyo";

const state = {
	config: null,
	schema: null,
	participantsIndex: null,
	studentsIndex: null,
	studentsByNotionId: new Map(),
	studentsByStudentId: new Map(),
	tagsIndex: null,
	tagsById: new Map(),
	tagsByNormalizedName: new Map(),
	tagsSearch: [],
	tagsIndexLoaded: false,
	upload: {
		files: [],
		coverIndex: 0,
		explicitTagIds: [],
		readyTouched: false,
		authorCandidates: [],
		resetTagState: null,
		setTagState: null,
		drafts: [],
		activeDraftId: "",
		selectedDraftIds: [],
		selectedFileIds: [],
		nextDraftSeq: 1,
	},
	curation: {
		works: [],
		filtered: [],
		currentIndex: -1,
	},
};

function readStoredAdminToken() {
	try {
		return trimText(window.localStorage.getItem(ADMIN_API_TOKEN_STORAGE_KEY));
	} catch {
		return "";
	}
}

function storeAdminToken(token) {
	const value = trimText(token);
	if (!value) return;
	try {
		window.localStorage.setItem(ADMIN_API_TOKEN_STORAGE_KEY, value);
	} catch {}
}

function clearStoredAdminToken() {
	try {
		window.localStorage.removeItem(ADMIN_API_TOKEN_STORAGE_KEY);
	} catch {}
}

function getPersistedAdminToken() {
	const tokenFromWindow = trimText(window.ADMIN_API_TOKEN);
	if (tokenFromWindow) {
		storeAdminToken(tokenFromWindow);
		return tokenFromWindow;
	}
	const tokenFromConfig = trimText(state.config?.adminApiToken);
	if (tokenFromConfig) {
		storeAdminToken(tokenFromConfig);
		return tokenFromConfig;
	}
	return readStoredAdminToken();
}

function getConfiguredAdminToken() {
	const tokenFromInput = trimText(qs("#admin-api-token")?.value);
	if (tokenFromInput) return tokenFromInput;
	return getPersistedAdminToken();
}

function ensureAdminToken() {
	const existing = getConfiguredAdminToken();
	if (existing) return existing;
	throw new Error("管理APIトークンを設定してください（ヘッダーの操作メニュー）");
}

function isAdminPath(path) {
	return String(path || "").startsWith("/admin/");
}

function isCompactHeaderViewport() {
	return window.matchMedia(COMPACT_HEADER_MEDIA_QUERY).matches;
}

function setHeaderToolsOpen(open) {
	const header = qs(".app-header");
	const toggleBtn = qs("#app-header-tools-toggle");
	if (!header || !toggleBtn) return;
	const next = Boolean(open);
	header.classList.toggle("is-tools-open", next);
	toggleBtn.setAttribute("aria-expanded", next ? "true" : "false");
	toggleBtn.textContent = next ? "閉じる" : "操作";
}

function ensureHeaderToolsVisibleOnMobile() {
	if (!isCompactHeaderViewport()) return;
	setHeaderToolsOpen(true);
}

function initHeaderToolsToggle() {
	const toggleBtn = qs("#app-header-tools-toggle");
	if (!toggleBtn) return;

	const sync = () => {
		if (isCompactHeaderViewport()) {
			if (!qs(".app-header")?.classList.contains("is-tools-open")) {
				setHeaderToolsOpen(false);
			}
			return;
		}
		setHeaderToolsOpen(false);
	};

	toggleBtn.addEventListener("click", () => {
		if (!isCompactHeaderViewport()) return;
		const isOpen = qs(".app-header")?.classList.contains("is-tools-open");
		setHeaderToolsOpen(!isOpen);
	});
	window.addEventListener("resize", debounce(sync, 60));
	sync();
}

function reflectAdminTokenToInput() {
	const input = qs("#admin-api-token");
	if (!input) return;
	input.value = getPersistedAdminToken() || "";
}

function syncAdminAuthControls({ editing = false, focusInput = false } = {}) {
	const controls = qs("#admin-auth-controls");
	const input = qs("#admin-api-token");
	const stateEl = qs("#admin-auth-state");
	if (!controls || !input) return;

	const hasToken = Boolean(getPersistedAdminToken());
	controls.classList.toggle("is-authenticated", hasToken);
	controls.classList.toggle("is-editing", hasToken && Boolean(editing));
	if (stateEl) stateEl.textContent = hasToken ? "管理API: 認証済み" : "管理API: 未認証";

	if (focusInput) {
		ensureHeaderToolsVisibleOnMobile();
		window.requestAnimationFrame(() => {
			input.focus();
			input.select();
		});
	}
}

function initAdminAuthControls() {
	const input = qs("#admin-api-token");
	const saveBtn = qs("#admin-api-token-save");
	const editBtn = qs("#admin-api-token-edit");
	const clearBtn = qs("#admin-api-token-clear");
	if (!input || !saveBtn || !editBtn || !clearBtn) return;

	reflectAdminTokenToInput();
	syncAdminAuthControls();
	if (!getPersistedAdminToken()) ensureHeaderToolsVisibleOnMobile();

	const saveToken = () => {
		const token = trimText(input.value);
		if (!token) {
			showToast("管理APIトークンを入力してください");
			return;
		}
		storeAdminToken(token);
		syncAdminAuthControls();
		showToast("管理APIトークンを保存しました");
	};

	saveBtn.addEventListener("click", saveToken);
	editBtn.addEventListener("click", () => {
		reflectAdminTokenToInput();
		syncAdminAuthControls({ editing: true, focusInput: true });
	});
	input.addEventListener("keydown", (e) => {
		if (e.key !== "Enter") return;
		e.preventDefault();
		saveToken();
	});
	clearBtn.addEventListener("click", () => {
		clearStoredAdminToken();
		input.value = "";
		syncAdminAuthControls({ focusInput: true });
		showToast("管理APIトークンを削除しました");
	});
}

function getConfig() {
	const app = qs("#app");
	const apiBaseFromData = app?.dataset.apiBase || "";
	const apiBase = String(window.ADMIN_API_BASE || apiBaseFromData || "").trim();
	const galleryJsonUrl = String(window.GALLERY_JSON_URL || app?.dataset.galleryJson || "./gallery.json").trim();
	const adminApiToken = String(window.ADMIN_API_TOKEN || app?.dataset.adminApiToken || "").trim();
	return {
		apiBase,
		galleryJsonUrl,
		adminApiToken,
	};
}

async function apiFetch(path, init = {}) {
	const base = state.config.apiBase;
	const url = base ? new URL(path, base).toString() : path;
	const requestOrigin = new URL(url, window.location.href).origin;
	const credentials = requestOrigin === window.location.origin ? "include" : "omit";
	const headers = new Headers(init.headers || {});
	const needsAdminAuth = isAdminPath(path);
	if (needsAdminAuth) {
		const token = ensureAdminToken();
		headers.set("Authorization", `Bearer ${token}`);
	}
	const res = await fetch(url, { credentials, ...init, headers });
	const data = await res.json().catch(() => null);
	if (!res.ok) {
		if (needsAdminAuth && res.status === 401) {
			clearStoredAdminToken();
			const input = qs("#admin-api-token");
			if (input) {
				input.value = "";
			}
			syncAdminAuthControls({ focusInput: true });
			throw new Error("認証に失敗しました。ヘッダーの操作メニューから管理APIトークンを再入力してください。");
		}
		const message = data?.error || data?.message || `HTTP ${res.status}`;
		throw new Error(message);
	}
	return data;
}

function setBanner(text, { type = "warn" } = {}) {
	const banner = qs("#banner");
	if (!banner) return;
	if (!text) {
		banner.hidden = true;
		banner.textContent = "";
		return;
	}
	banner.hidden = false;
	banner.textContent = text;
	banner.dataset.type = type;
}

function normalizeClassroom(raw) {
	const value = String(raw || "").trim();
	if (!value) return "";
	const base = value.replace(/教室$/, "");

	const options = state.schema?.classroomOptions || [];
	for (const opt of options) {
		const optBase = String(opt || "").trim().replace(/教室$/, "");
		if (!optBase) continue;
		if (base === optBase) return String(opt);
		if (base.includes(optBase) || optBase.includes(base)) return String(opt);
	}

	if (base.includes("東京")) return "東京教室";
	if (base.includes("つくば")) return "つくば教室";
	if (base.includes("沼津")) return "沼津教室";
	return value;
}

function isSameDayOrAfter(a, b) {
	if (!a || !b) return true;
	return a >= b;
}

function isSameDayOrBefore(a, b) {
	if (!a || !b) return true;
	return a <= b;
}

function isNotionIdLike(value) {
	const s = String(value || "").replaceAll("-", "");
	return /^[0-9a-f]{32}$/i.test(s);
}

function trimText(value) {
	return String(value || "").trim();
}

function toOptionalText(value) {
	if (typeof value === "string") return trimText(value);
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		return value
			.map((item) => toOptionalText(item))
			.filter(Boolean)
			.join(" / ");
	}
	return "";
}

function extractFirstText(source, keys) {
	if (!source || typeof source !== "object") return "";
	for (const key of keys) {
		const value = toOptionalText(source[key]);
		if (value) return value;
	}
	return "";
}

const SESSION_NOTE_PROP_KEYS = [
	"session_note",
	"sessionNote",
	"セッションノート",
];
const RESERVATION_CONTAINER_KEYS = [
	"reservation",
	"reservation_record",
	"reservation_records",
	"reservationRecord",
	"reservationRecords",
	"予約記録",
];
const GROUP_SESSION_NOTE_MAP_KEYS = [
	"session_notes_by_student_id",
	"sessionNotesByStudentId",
	"session_notes",
	"sessionNotes",
	"セッションノート",
];
const GROUP_RESERVATION_RECORDS_KEYS = [
	"reservation_records",
	"reservationRecords",
	"予約記録",
];

function extractParticipantSessionNote(participant) {
	const direct = extractFirstText(participant, SESSION_NOTE_PROP_KEYS);
	if (direct) return direct;

	for (const key of RESERVATION_CONTAINER_KEYS) {
		const container = participant?.[key];
		if (Array.isArray(container)) {
			const merged = container
				.map((item) => extractFirstText(item, SESSION_NOTE_PROP_KEYS))
				.filter(Boolean)
				.join(" / ");
			if (merged) return merged;
			continue;
		}
		const nested = extractFirstText(container, SESSION_NOTE_PROP_KEYS);
		if (nested) return nested;
	}
	return "";
}

function findSessionNoteInRecords(records, participant) {
	if (!Array.isArray(records)) return "";
	const studentId = trimText(participant?.student_id);
	const displayName = trimText(participant?.display_name);
	const matched = records.find((record) => {
		const recordStudentId = trimText(record?.student_id || record?.studentId || record?.id);
		if (studentId && recordStudentId && studentId === recordStudentId) return true;
		const recordName = trimText(record?.display_name || record?.displayName || record?.name || record?.student_name || record?.studentName);
		return Boolean(displayName && recordName && displayName === recordName);
	});
	if (!matched) return "";
	return extractFirstText(matched, SESSION_NOTE_PROP_KEYS);
}

function extractGroupSessionNote(group, participant) {
	const studentId = trimText(participant?.student_id);
	const displayName = trimText(participant?.display_name);
	const lookupKeys = Array.from(new Set([studentId, displayName].filter(Boolean)));
	for (const mapKey of GROUP_SESSION_NOTE_MAP_KEYS) {
		const map = group?.[mapKey];
		if (!map || typeof map !== "object" || Array.isArray(map)) continue;
		for (const key of lookupKeys) {
			if (map[key] === undefined) continue;
			const direct = toOptionalText(map[key]);
			if (direct) return direct;
			const nested = extractFirstText(map[key], SESSION_NOTE_PROP_KEYS);
			if (nested) return nested;
		}
	}
	for (const recordsKey of GROUP_RESERVATION_RECORDS_KEYS) {
		const note = findSessionNoteInRecords(group?.[recordsKey], participant);
		if (note) return note;
	}
	return "";
}

function resolveParticipantSessionNote(participant, group) {
	return extractParticipantSessionNote(participant) || extractGroupSessionNote(group, participant);
}

function firstNChars(value, n) {
	return Array.from(trimText(value)).slice(0, n).join("");
}

function splitStudentNameFromLabel(label) {
	const raw = trimText(label);
	if (!raw) return { nickname: "", realName: "" };
	const m = raw.match(/^(.+?)\s*[|｜]\s*(.+)$/u);
	if (!m) return { nickname: raw, realName: "" };
	return { nickname: trimText(m[1]), realName: trimText(m[2]) };
}

function normalizeNickname(nickname, realName) {
	const nick = trimText(nickname);
	const real = trimText(realName);
	if (!nick) return "";
	if (!real) return nick;
	if (nick !== real) return nick;
	const shortened = firstNChars(real, 2);
	return shortened || nick;
}

function buildStudentRecord(raw) {
	const notionIdRaw = trimText(raw?.notion_id || raw?.notionId || raw?.id);
	const studentId = trimText(raw?.student_id || raw?.studentId);
	const displayRaw = trimText(raw?.display_name || raw?.displayName);
	const nicknameRaw = trimText(raw?.nickname);
	const realNameRaw = trimText(raw?.real_name || raw?.realName);
	const parsed = splitStudentNameFromLabel(displayRaw);
	const realName = realNameRaw || parsed.realName;
	const nickname = normalizeNickname(
		nicknameRaw || parsed.nickname || displayRaw,
		realName,
	);
	const displayName = nickname || trimText(parsed.nickname) || realName || displayRaw || studentId || notionIdRaw;
	const choiceLabel = realName ? `${displayName}｜${realName}` : displayName;
	const notionId = isNotionIdLike(notionIdRaw)
		? notionIdRaw
		: isNotionIdLike(studentId)
			? studentId
			: "";
	return {
		notionId,
		studentId,
		displayName,
		nickname,
		realName,
		choiceLabel,
	};
}

function getStudentRecordByAnyId(id) {
	const key = trimText(id);
	if (!key) return null;
	return state.studentsByNotionId.get(key) || state.studentsByStudentId.get(key) || null;
}

function getSelectedAuthorIds(selectEl) {
	if (!selectEl) return [];
	return Array.from(selectEl.selectedOptions || [])
		.map((opt) => trimText(opt.value))
		.filter(Boolean);
}

function setSelectedAuthorIds(selectEl, ids) {
	const selected = new Set((Array.isArray(ids) ? ids : []).map((id) => trimText(id)).filter(Boolean));
	Array.from(selectEl.options || []).forEach((opt) => {
		opt.selected = selected.has(trimText(opt.value));
	});
}

function ensureAuthorOption(selectEl, record) {
	if (!record?.notionId) return false;
	const value = trimText(record.notionId);
	if (!value) return false;
	const existing = Array.from(selectEl.options || []).find((opt) => trimText(opt.value) === value);
	if (existing) {
		if (record.choiceLabel) existing.textContent = record.choiceLabel;
		return true;
	}
	selectEl.appendChild(el("option", { value, text: record.choiceLabel || record.displayName || value }));
	return true;
}

function tagsFreshnessWarning() {
	const generatedAt = state.tagsIndex?.generated_at;
	if (!generatedAt) return "";
	const t = new Date(generatedAt).getTime();
	if (Number.isNaN(t)) return "";
	const ageMs = Date.now() - t;
	if (ageMs > 24 * 60 * 60 * 1000) {
		return `タグインデックスが古い可能性があります（generated_at: ${formatIso(generatedAt)}）`;
	}
	return "";
}

function resolveMergedTagId(tagId) {
	let current = tagId;
	const visited = new Set();
	while (current && !visited.has(current)) {
		visited.add(current);
		const tag = state.tagsById.get(current);
		if (!tag) return current;
		if (tag.status !== "merged") return current;
		const next = tag.merge_to;
		if (!next) return current;
		current = next;
	}
	return current;
}

function computeDerivedParentTagIds(explicitIds) {
	const derived = new Set();
	const visited = new Set();

	const walk = (id) => {
		const tag = state.tagsById.get(id);
		if (!tag) return;
		const parents = Array.isArray(tag.parents) ? tag.parents : [];
		for (const p of parents) {
			const pid = resolveMergedTagId(p);
			if (!pid || visited.has(pid)) continue;
			visited.add(pid);
			derived.add(pid);
			walk(pid);
		}
	};

	for (const id of explicitIds) {
		const resolved = resolveMergedTagId(id);
		if (!resolved) continue;
		visited.add(resolved);
		walk(resolved);
	}

	for (const id of explicitIds) derived.delete(resolveMergedTagId(id));
	return Array.from(derived);
}

function renderChips(root, { explicitIds, derivedIds, onRemove }) {
	root.innerHTML = "";

	const mkChip = (id, { derived }) => {
		const tag = state.tagsById.get(id);
		const name = tag?.name || id;
		const chip = el("span", { class: `chip${derived ? " is-derived" : ""}` });
		chip.appendChild(el("span", { text: name }));
		if (!derived) {
			const remove = el("button", { type: "button", "aria-label": "削除", text: "×" });
			remove.addEventListener("click", (e) => {
				e.stopPropagation();
				onRemove?.(id);
			});
			chip.appendChild(remove);
		}
		return chip;
	};

	explicitIds.forEach((id) => root.appendChild(mkChip(id, { derived: false })));
	derivedIds.forEach((id) => root.appendChild(mkChip(id, { derived: true })));
}

function normalizeTagNameKey(name) {
	return normalizeSearch(name);
}

function indexTagName(tag) {
	const key = normalizeTagNameKey(tag?.name);
	if (!key || !tag?.id) return;
	state.tagsByNormalizedName.set(key, trimText(tag.id));
}

function buildTagSearchList(tagsIndex) {
	const tags = Array.isArray(tagsIndex?.tags) ? tagsIndex.tags : [];
	const list = [];
	state.tagsById.clear();
	state.tagsByNormalizedName.clear();
	for (const t of tags) {
		if (!t || !t.id) continue;
		const tag = {
			id: String(t.id),
			name: String(t.name || ""),
			aliases: Array.isArray(t.aliases) ? t.aliases.map(String) : [],
			status: String(t.status || "active"),
			merge_to: t.merge_to ? String(t.merge_to) : "",
			parents: Array.isArray(t.parents) ? t.parents.map(String) : [],
			children: Array.isArray(t.children) ? t.children.map(String) : [],
			usage_count: Number.isFinite(Number(t.usage_count)) ? Number(t.usage_count) : 0,
		};
		state.tagsById.set(tag.id, tag);
		indexTagName(tag);
		const tokens = [tag.name, ...tag.aliases].filter(Boolean).map(normalizeSearch);
		list.push({ tag, tokens });
	}
	return list;
}

function upsertTagSearchEntry(rawTag) {
	if (!rawTag || !rawTag.id) return null;
	const id = trimText(rawTag.id);
	if (!id) return null;

	const prev = state.tagsById.get(id) || {};
	const aliases = Array.isArray(rawTag.aliases)
		? rawTag.aliases.map(String)
		: Array.isArray(prev.aliases)
			? prev.aliases
			: [];
	const parents = Array.isArray(rawTag.parents)
		? rawTag.parents.map(String)
		: Array.isArray(prev.parents)
			? prev.parents
			: [];
	const children = Array.isArray(rawTag.children)
		? rawTag.children.map(String)
		: Array.isArray(prev.children)
			? prev.children
			: [];

	const tag = {
		id,
		name: trimText(rawTag.name || prev.name || id),
		aliases,
		status: trimText(rawTag.status || prev.status || "active"),
		merge_to: trimText(rawTag.merge_to || prev.merge_to),
		parents,
		children,
		usage_count: Number.isFinite(Number(rawTag.usage_count))
			? Number(rawTag.usage_count)
			: Number(prev.usage_count || 0),
	};
	state.tagsById.set(tag.id, tag);
	const prevNameKey = normalizeTagNameKey(prev?.name);
	if (prevNameKey && state.tagsByNormalizedName.get(prevNameKey) === tag.id) {
		state.tagsByNormalizedName.delete(prevNameKey);
	}
	indexTagName(tag);

	const tokens = [tag.name, ...tag.aliases].filter(Boolean).map(normalizeSearch);
	const existingIdx = state.tagsSearch.findIndex((entry) => entry.tag?.id === tag.id);
	if (existingIdx >= 0) {
		state.tagsSearch[existingIdx] = { tag, tokens };
	} else {
		state.tagsSearch.push({ tag, tokens });
	}
	return tag;
}

function findExistingTagIdByName(name) {
	const q = normalizeTagNameKey(name);
	if (!q) return "";
	return trimText(state.tagsByNormalizedName.get(q));
}

function normalizeTagIdList(ids) {
	if (!Array.isArray(ids)) return [];
	const out = [];
	const seen = new Set();
	for (const rawId of ids) {
		const id = resolveMergedTagId(trimText(rawId));
		if (!id || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

function normalizeTagForState(rawTag, fallback = {}) {
	const base = fallback && typeof fallback === "object" ? fallback : {};
	return {
		id: trimText(rawTag?.id || base.id),
		name: trimText(rawTag?.name || base.name),
		aliases: Array.isArray(rawTag?.aliases)
			? rawTag.aliases.map(String)
			: Array.isArray(base.aliases)
				? base.aliases
				: [],
		status: trimText(rawTag?.status || base.status || "active"),
		merge_to: trimText(rawTag?.merge_to || base.merge_to),
		parents: normalizeTagIdList(rawTag?.parents ?? base.parents ?? []),
		children: normalizeTagIdList(rawTag?.children ?? base.children ?? []),
		usage_count: Number.isFinite(Number(rawTag?.usage_count))
			? Number(rawTag.usage_count)
			: Number.isFinite(Number(base.usage_count))
				? Number(base.usage_count)
				: 0,
	};
}

async function createTagFromUi(rawName, { parentIds = [], childIds = [] } = {}) {
	const name = trimText(rawName);
	if (!name) throw new Error("タグ名を入力してください");
	if (!state.tagsIndexLoaded) {
		throw new Error("タグインデックス未取得のため新規作成できません。再読み込み後にお試しください。");
	}

	const normalizedParentIds = normalizeTagIdList(parentIds);
	const normalizedChildIds = normalizeTagIdList(childIds);
	const existingId = findExistingTagIdByName(name);
	if (existingId) {
		const id = resolveMergedTagId(existingId);
		if (normalizedParentIds.length > 0 || normalizedChildIds.length > 0) {
			const updated = await apiFetch("/admin/notion/tag", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id,
					addParentIds: normalizedParentIds,
					addChildIds: normalizedChildIds,
				}),
			});
			const nextTag = normalizeTagForState(updated, state.tagsById.get(id) || { id });
			upsertTagSearchEntry(nextTag);
		}
		return {
			id,
			created: false,
			parentIds: normalizeTagIdList(state.tagsById.get(id)?.parents || []),
			childIds: normalizeTagIdList(state.tagsById.get(id)?.children || []),
		};
	}

	const created = await apiFetch("/admin/notion/tag", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			name,
			parentIds: normalizedParentIds,
			childIds: normalizedChildIds,
		}),
	});
	const id = trimText(created?.id);
	if (!id) throw new Error("タグ作成結果が不正です（idなし）");

	const createdTag = normalizeTagForState(created, {
		id,
		name,
		aliases: [],
		status: "active",
		merge_to: "",
		parents: normalizedParentIds,
		children: normalizedChildIds,
		usage_count: 0,
	});
	upsertTagSearchEntry(createdTag);
	return { id: createdTag.id || id, created: true, parentIds: createdTag.parents, childIds: createdTag.children };
}

async function addTagParentChildRelation(parentIdRaw, childIdRaw) {
	const parentId = resolveMergedTagId(trimText(parentIdRaw));
	const childId = resolveMergedTagId(trimText(childIdRaw));
	if (!parentId || !childId) throw new Error("親タグ・子タグを選択してください");
	if (parentId === childId) throw new Error("親タグと子タグに同じタグは設定できません");

	const updated = await apiFetch("/admin/notion/tag", {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			parentId,
			childId,
		}),
	});

	const childTag = normalizeTagForState(updated?.child, state.tagsById.get(childId) || { id: childId });
	if (childTag.id) upsertTagSearchEntry(childTag);

	const parentChildren = normalizeTagIdList(updated?.parent?.children);
	if (parentChildren.includes(childId)) {
		const parentTag = normalizeTagForState(
			{ id: parentId, children: parentChildren },
			state.tagsById.get(parentId) || { id: parentId },
		);
		if (parentTag.id) upsertTagSearchEntry(parentTag);
	}

	return { parentId, childId };
}

function appendCreateTagSuggest(suggestRoot, query, onCreated, { relatedTagIds = [] } = {}) {
	const q = trimText(query);
	if (!q) return;
	if (!state.tagsIndexLoaded) {
		suggestRoot.appendChild(
			el("div", { class: "suggest-item" }, [
				el("span", { text: "タグインデックス未取得" }),
				el("span", { class: "suggest-item__hint", text: "新規作成はできません" }),
			]),
		);
		return;
	}
	if (findExistingTagIdByName(q)) return;
	const normalizedRelatedTagIds = normalizeTagIdList(relatedTagIds);
	let creating = false;

	const appendCreateAction = ({ label, hint, parentIds = [], childIds = [] }) => {
		const create = el("div", { class: "suggest-item" }, [
			el("span", { text: label }),
			el("span", { class: "suggest-item__hint", text: hint }),
		]);
		create.addEventListener("click", async () => {
			if (creating) return;
			creating = true;
			try {
				const result = await createTagFromUi(q, { parentIds, childIds });
				const id = resolveMergedTagId(result.id);
				showToast(result.created ? "タグを作成しました" : "既存タグを追加しました");
				onCreated(id);
			} catch (err) {
				showToast(`タグ作成に失敗: ${err.message}`);
			} finally {
				creating = false;
			}
		});
		suggestRoot.appendChild(create);
	};

	appendCreateAction({
		label: `「${q}」を新規作成`,
		hint: "関係なし",
	});

	if (normalizedRelatedTagIds.length > 0) {
		appendCreateAction({
			label: `「${q}」を新規作成（選択中を親にする）`,
			hint: `${normalizedRelatedTagIds.length}件を親タグとして関連付け`,
			parentIds: normalizedRelatedTagIds,
		});
		appendCreateAction({
			label: `「${q}」を新規作成（選択中を子にする）`,
			hint: `${normalizedRelatedTagIds.length}件を子タグとして関連付け`,
			childIds: normalizedRelatedTagIds,
		});
	}
}

function renderPickedTagChip(root, { id, roleLabel, onClear }) {
	root.innerHTML = "";
	if (!id) {
		root.appendChild(el("div", { class: "subnote", text: `${roleLabel}: 未選択` }));
		return;
	}
	const name = state.tagsById.get(id)?.name || id;
	const chip = el("span", { class: "chip" }, [el("span", { text: `${roleLabel}: ${name}` })]);
	const remove = el("button", { type: "button", text: "×" });
	remove.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		onClear?.();
	});
	chip.appendChild(remove);
	root.appendChild(chip);
}

function bindTagPickerInput({ inputEl, suggestRoot, onPick, getRelatedTagIds = () => [], onCreated = null }) {
	const renderSuggest = () => {
		const q = trimText(inputEl.value);
		suggestRoot.innerHTML = "";
		if (!q) return;
		const list = searchTags(q);
		list.forEach((tag) => {
			const hint = tag.status === "merged" ? "統合タグ" : tag.usage_count ? `作品数 ${tag.usage_count}` : "";
			const item = el("div", { class: "suggest-item" }, [
				el("span", { text: tag.name }),
				el("span", { class: "suggest-item__hint", text: hint }),
			]);
			item.addEventListener("click", () => {
				const resolvedId = resolveMergedTagId(tag.id);
				if (!resolvedId) return;
				onPick(resolvedId);
				inputEl.value = state.tagsById.get(resolvedId)?.name || tag.name;
				suggestRoot.innerHTML = "";
			});
			suggestRoot.appendChild(item);
		});

		if (list.length < 6) {
			appendCreateTagSuggest(
				suggestRoot,
				q,
				(createdId) => {
					const resolvedId = resolveMergedTagId(createdId);
					if (!resolvedId) return;
					onCreated?.(resolvedId);
					onPick(resolvedId);
					inputEl.value = state.tagsById.get(resolvedId)?.name || q;
					suggestRoot.innerHTML = "";
				},
				{ relatedTagIds: getRelatedTagIds() },
			);
		}
	};

	inputEl.addEventListener("input", debounce(renderSuggest, 120));
	inputEl.addEventListener("blur", () => {
		window.setTimeout(() => {
			suggestRoot.innerHTML = "";
		}, 120);
	});
}

function createTagRelationEditor({ onTagAdded }) {
	const root = el("div", { class: "tag-relation-editor" });
	root.appendChild(el("div", { class: "subnote", text: "タグ親子設定（タグDB）" }));

	let parentTagId = "";
	let childTagId = "";

	const parentInput = el("input", { class: "input input--sm", type: "text", placeholder: "親タグを検索" });
	const parentSuggest = el("div", { class: "suggest" });
	const parentPicker = el("div", { class: "tag-input" }, [parentInput, parentSuggest]);
	const parentPicked = el("div", { class: "chips" });

	const childInput = el("input", { class: "input input--sm", type: "text", placeholder: "子タグを検索" });
	const childSuggest = el("div", { class: "suggest" });
	const childPicker = el("div", { class: "tag-input" }, [childInput, childSuggest]);
	const childPicked = el("div", { class: "chips" });

	const refreshPicked = () => {
		renderPickedTagChip(parentPicked, {
			id: parentTagId,
			roleLabel: "親",
			onClear: () => {
				parentTagId = "";
				parentInput.value = "";
				refreshPicked();
			},
		});
		renderPickedTagChip(childPicked, {
			id: childTagId,
			roleLabel: "子",
			onClear: () => {
				childTagId = "";
				childInput.value = "";
				refreshPicked();
			},
		});
	};
	refreshPicked();

	bindTagPickerInput({
		inputEl: parentInput,
		suggestRoot: parentSuggest,
		onPick: (id) => {
			parentTagId = id;
			refreshPicked();
		},
		onCreated: (id) => onTagAdded?.(id),
	});
	bindTagPickerInput({
		inputEl: childInput,
		suggestRoot: childSuggest,
		onPick: (id) => {
			childTagId = id;
			refreshPicked();
		},
		onCreated: (id) => onTagAdded?.(id),
	});

	const addRelationBtn = el("button", { type: "button", class: "btn", text: "既存タグに親子関係を追加" });
	addRelationBtn.addEventListener("click", async () => {
		addRelationBtn.disabled = true;
		try {
			await addTagParentChildRelation(parentTagId, childTagId);
			showToast("タグの親子関係を追加しました");
		} catch (err) {
			showToast(`親子関係の追加に失敗: ${err.message}`);
		} finally {
			addRelationBtn.disabled = false;
		}
	});

	root.appendChild(
		el("div", { class: "tag-relation-editor__grid" }, [
			el("div", { class: "form-row" }, [el("label", { class: "label", text: "親タグ" }), parentPicker, parentPicked]),
			el("div", { class: "form-row" }, [el("label", { class: "label", text: "子タグ" }), childPicker, childPicked]),
		]),
	);
	root.appendChild(el("div", { class: "tag-relation-editor__actions" }, [addRelationBtn]));
	root.appendChild(
		el("div", {
			class: "subnote",
			text: "親/子の検索候補から新規タグを作成できます。作成後に「既存タグに親子関係を追加」で反映してください。",
		}),
	);
	return root;
}

function renderTitleTagSuggest(root, { getTitle, getExplicitTagIds, onTagAdded }) {
	root.innerHTML = "";
	const title = trimText(getTitle());
	if (!title || !state.tagsIndexLoaded) return;

	const existingId = findExistingTagIdByName(title);
	const resolvedId = existingId ? resolveMergedTagId(existingId) : "";
	if (resolvedId && getExplicitTagIds().includes(resolvedId)) return;

	root.appendChild(el("span", { class: "subnote", text: "作品名→タグ：" }));
	const chip = el("span", { class: "chip" });
	chip.appendChild(el("span", { text: title }));
	let adding = false;
	chip.addEventListener("click", async () => {
		if (adding) return;
		adding = true;
		try {
			const result = await createTagFromUi(title);
			const id = resolveMergedTagId(result.id);
			showToast(result.created ? "タグを作成しました" : "既存タグを追加しました");
			onTagAdded(id);
		} catch (err) {
			showToast(`タグ追加に失敗: ${err.message}`);
		} finally {
			adding = false;
		}
	});
	root.appendChild(chip);
}

function searchTags(query) {
	const q = normalizeSearch(query);
	if (!q) return [];

	const scored = [];
	for (const entry of state.tagsSearch) {
		const tag = entry.tag;
		if (tag.status === "hidden") continue;

		let best = 0;
		for (const token of entry.tokens) {
			if (!token) continue;
			if (token === q) best = Math.max(best, 3);
			else if (token.startsWith(q)) best = Math.max(best, 2);
			else if (token.includes(q)) best = Math.max(best, 1);
		}
		if (best === 0) continue;
		scored.push({ tag, score: best });
	}

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		if ((b.tag.usage_count || 0) !== (a.tag.usage_count || 0)) return (b.tag.usage_count || 0) - (a.tag.usage_count || 0);
		return String(a.tag.name).localeCompare(String(b.tag.name), "ja");
	});

	return scored.slice(0, 20).map((s) => s.tag);
}

async function loadGalleryUpdatedAt() {
	const elUpdated = qs("#gallery-updated-at");
	if (!elUpdated) return;

	try {
		const res = await fetch(state.config.galleryJsonUrl, { cache: "no-store" });
		if (!res.ok) throw new Error("fetch failed");
		const data = await res.json();
		elUpdated.textContent = data?.updated_at ? formatIso(data.updated_at) : "-";
	} catch {
		elUpdated.textContent = "-";
	}
}

async function loadSchemaAndIndexes() {
	state.tagsIndexLoaded = false;
	const tasks = [
		apiFetch("/admin/notion/schema").then((d) => (state.schema = d)),
		apiFetch("/participants-index").then((d) => (state.participantsIndex = d.data)),
		apiFetch("/students-index").then((d) => (state.studentsIndex = d.data)),
		apiFetch("/tags-index").then((d) => {
			state.tagsIndex = d.data;
			state.tagsIndexLoaded = true;
		}),
	];

	const results = await Promise.allSettled(tasks);
	const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason?.message).filter(Boolean);
	if (errors.length > 0) {
		setBanner(`一部データの取得に失敗しました：${errors.join(" / ")}`);
	}

	if (state.studentsIndex?.students) {
		for (const s of state.studentsIndex.students) {
			const record = buildStudentRecord(s);
			if (!record.displayName) continue;
			if (record.notionId) state.studentsByNotionId.set(record.notionId, record);
			if (record.studentId) state.studentsByStudentId.set(record.studentId, record);
		}
	}

	if (state.tagsIndex) {
		state.tagsSearch = buildTagSearchList(state.tagsIndex);
		const warn = tagsFreshnessWarning();
		if (warn) setBanner(warn);
	}
}

function populateSelect(select, { items, placeholder = "" }) {
	select.innerHTML = "";
	if (placeholder) {
		select.appendChild(el("option", { value: "", text: placeholder }));
	}
	for (const item of items) {
		select.appendChild(el("option", { value: item.value, text: item.label || item.value }));
	}
}

function initTabs() {
	const tabs = qsa(".tab");
	const views = qsa(".view");
	const byId = new Map(views.map((v) => [v.dataset.view, v]));

	const activate = (key) => {
		tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.tab === key));
		views.forEach((v) => v.classList.toggle("is-active", v.dataset.view === key));
	};

	tabs.forEach((tab) => {
		tab.addEventListener("click", () => {
			activate(tab.dataset.tab);
			if (isCompactHeaderViewport()) setHeaderToolsOpen(false);
		});
	});

	const initial = tabs.find((t) => t.classList.contains("is-active"))?.dataset.tab || "upload";
	if (!byId.has(initial)) activate("upload");
}

function getParticipantsGroups(ymd) {
	const idx = state.participantsIndex;
	if (!idx || !idx.dates) return [];
	const groups = idx.dates[ymd];
	return Array.isArray(groups) ? groups : [];
}

function buildAuthorCandidateFromParticipant(participant, { group = null } = {}) {
	const studentId = trimText(participant?.student_id);
	const mapped = studentId ? state.studentsByStudentId.get(studentId) : null;
	const fallback = buildStudentRecord({
		student_id: studentId,
		display_name: trimText(participant?.display_name),
	});
	const notionId = mapped?.notionId || fallback.notionId || "";
	const label = mapped?.choiceLabel || fallback.choiceLabel || studentId;
	if (!notionId || !label) return null;
	return {
		id: notionId,
		label,
		sessionNote: resolveParticipantSessionNote(participant, group),
	};
}

function formatCandidateNoteText(value) {
	const note = trimText(value);
	return note || "（セッションノート未記入）";
}

function dispatchAuthorSelectionChange(selectEl) {
	if (!selectEl) return;
	selectEl.dispatchEvent(new Event("change", { bubbles: true }));
}

function getAuthorOptionLabel(selectEl, authorId) {
	const id = trimText(authorId);
	if (!id) return "";
	const option = Array.from(selectEl?.options || []).find((opt) => trimText(opt.value) === id);
	const optionLabel = trimText(option?.textContent);
	if (optionLabel) return optionLabel;
	const record = getStudentRecordByAnyId(id);
	return trimText(record?.choiceLabel || record?.displayName || id);
}

function renderAuthorSelectedChips(root, selectEl) {
	const authorSelect = selectEl;
	if (!root || !authorSelect) return;
	root.innerHTML = "";
	const selectedIds = getSelectedAuthorIds(authorSelect);
	if (selectedIds.length === 0) {
		root.hidden = true;
		return;
	}
	root.hidden = false;
	selectedIds.forEach((authorId) => {
		const chip = el("span", { class: "chip chip--author-selected" });
		chip.appendChild(el("span", { text: getAuthorOptionLabel(authorSelect, authorId) || authorId }));
		const remove = el("button", { type: "button", text: "×", "aria-label": "作者選択を解除" });
		remove.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const selected = new Set(getSelectedAuthorIds(authorSelect));
			selected.delete(authorId);
			setSelectedAuthorIds(authorSelect, Array.from(selected));
			dispatchAuthorSelectionChange(authorSelect);
		});
		chip.appendChild(remove);
		root.appendChild(chip);
	});
}

function renderAuthorCandidateButtons(root, selectEl, candidates, { emptyText = "" } = {}) {
	const authorSelect = selectEl;
	if (!root || !authorSelect) return;
	root.innerHTML = "";
	const list = Array.isArray(candidates) ? candidates : [];
	if (list.length === 0) {
		if (emptyText) {
			root.hidden = false;
			root.appendChild(el("div", { class: "subnote", text: emptyText }));
		} else {
			root.hidden = true;
		}
		return;
	}
	root.hidden = false;
	root.appendChild(el("div", { class: "subnote", text: "候補ボタン（作者名 + セッションノート）" }));

	const selectedIds = new Set(getSelectedAuthorIds(authorSelect));
	list.forEach((candidate) => {
		const candidateId = trimText(candidate?.id);
		const label = trimText(candidate?.label);
		if (!candidateId || !label) return;
		const button = el("button", {
			type: "button",
			class: `candidate-note candidate-note--button${selectedIds.has(candidateId) ? " is-selected" : ""}`,
		});
		button.appendChild(el("div", { class: "candidate-note__name", text: label }));
		button.appendChild(el("div", { class: "candidate-note__text", text: formatCandidateNoteText(candidate?.sessionNote) }));
		button.addEventListener("click", () => {
			const selected = new Set(getSelectedAuthorIds(authorSelect));
			if (selected.has(candidateId)) {
				selected.delete(candidateId);
			} else {
				ensureAuthorOption(authorSelect, buildStudentRecord({ id: candidateId, display_name: label }));
				selected.add(candidateId);
			}
			setSelectedAuthorIds(authorSelect, Array.from(selected));
			dispatchAuthorSelectionChange(authorSelect);
		});
		root.appendChild(button);
	});

}

function syncAuthorPickerUi({
	selectEl,
	selectedRoot,
	candidatesRoot,
	candidates,
	emptyCandidatesText = "当日参加者候補なし（名簿検索をご利用ください）",
} = {}) {
	renderAuthorSelectedChips(selectedRoot, selectEl);
	renderAuthorCandidateButtons(candidatesRoot, selectEl, candidates, { emptyText: emptyCandidatesText });
}

function syncUploadAuthorUi() {
	syncAuthorPickerUi({
		selectEl: qs("#upload-author"),
		selectedRoot: qs("#upload-author-selected"),
		candidatesRoot: qs("#upload-author-candidate-notes"),
		candidates: state.upload.authorCandidates,
	});
}

function bindAuthorSearchInput({ inputEl, resultsRoot, selectEl, onPicked = null } = {}) {
	if (!inputEl || !resultsRoot || !selectEl) return;

	const render = (items) => {
		resultsRoot.innerHTML = "";
		items.slice(0, 12).forEach((student) => {
			const item = el("div", { class: "suggest-item" }, [
				el("span", { text: student.choiceLabel || student.displayName }),
				el("span", { class: "suggest-item__hint", text: student.studentId ? `(${student.studentId})` : "" }),
			]);
			item.addEventListener("click", () => {
				if (!student.notionId) return;
				ensureAuthorOption(selectEl, student);
				const selected = new Set(getSelectedAuthorIds(selectEl));
				selected.add(student.notionId);
				setSelectedAuthorIds(selectEl, Array.from(selected));
				dispatchAuthorSelectionChange(selectEl);
				onPicked?.();
				resultsRoot.innerHTML = "";
				inputEl.value = "";
			});
			resultsRoot.appendChild(item);
		});
	};

	const run = debounce(() => {
		(async () => {
			const raw = inputEl.value.trim();
			const q = normalizeSearch(raw);
			if (!q) return render([]);

			const hits = [];
			const seen = new Set();
			for (const student of [...state.studentsByNotionId.values(), ...state.studentsByStudentId.values()]) {
				const keyId = student.notionId || student.studentId;
				if (!keyId || seen.has(keyId)) continue;
				seen.add(keyId);
				const key = normalizeSearch([student.displayName, student.choiceLabel, student.studentId].filter(Boolean).join(" "));
				if (key.includes(q)) hits.push(student);
			}

			if (hits.length < 8 && raw.length >= 2) {
				try {
					const remote = await apiFetch(`/admin/notion/search-students?q=${encodeURIComponent(raw)}`);
					for (const r of remote.results || []) {
						const record = buildStudentRecord({
							id: trimText(r.id),
							display_name: trimText(r.name),
							nickname: trimText(r.nickname),
							real_name: trimText(r.real_name),
						});
						const notionId = record.notionId;
						if (!notionId || !record.displayName || seen.has(notionId)) continue;
						seen.add(notionId);
						hits.push(record);
					}
				} catch (err) {
					console.error("Author remote search failed:", err);
				}
			}

			render(hits);
		})().catch((err) => {
			console.error("Author search failed:", err);
		});
	}, 200);

	inputEl.addEventListener("input", run);
	inputEl.addEventListener("blur", () => {
		window.setTimeout(() => {
			resultsRoot.innerHTML = "";
		}, 120);
	});
}

function formatCandidateNoteText(value) {
	const note = trimText(value);
	return note || "（セッションノート未記入）";
}

function getAuthorOptionLabel(selectEl, authorId) {
	const id = trimText(authorId);
	if (!id) return "";
	const option = Array.from(selectEl?.options || []).find((opt) => trimText(opt.value) === id);
	const optionLabel = trimText(option?.textContent);
	if (optionLabel) return optionLabel;
	const record = getStudentRecordByAnyId(id);
	return trimText(record?.choiceLabel || record?.displayName || id);
}

function renderUploadSelectedAuthors() {
	const root = qs("#upload-author-selected");
	const authorSelect = qs("#upload-author");
	if (!root || !authorSelect) return;
	root.innerHTML = "";
	const selectedIds = getSelectedAuthorIds(authorSelect);
	if (selectedIds.length === 0) {
		root.hidden = true;
		return;
	}
	root.hidden = false;
	selectedIds.forEach((authorId) => {
		const chip = el("span", { class: "chip chip--author-selected" });
		chip.appendChild(el("span", { text: getAuthorOptionLabel(authorSelect, authorId) || authorId }));
		const remove = el("button", { type: "button", text: "×", "aria-label": "作者選択を解除" });
		remove.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			const selected = new Set(getSelectedAuthorIds(authorSelect));
			selected.delete(authorId);
			setSelectedAuthorIds(authorSelect, Array.from(selected));
			authorSelect.dispatchEvent(new Event("change", { bubbles: true }));
		});
		chip.appendChild(remove);
		root.appendChild(chip);
	});
}

function renderUploadAuthorCandidates() {
	const root = qs("#upload-author-candidate-notes");
	const authorSelect = qs("#upload-author");
	if (!root || !authorSelect) return;
	root.innerHTML = "";

	const candidates = Array.isArray(state.upload.authorCandidates) ? state.upload.authorCandidates : [];
	if (candidates.length === 0) {
		root.hidden = true;
		return;
	}
	root.hidden = false;
	root.appendChild(el("div", { class: "subnote", text: "候補ボタン（作者名 + セッションノート）" }));
	const selectedIds = new Set(getSelectedAuthorIds(authorSelect));
	candidates.forEach((candidate) => {
		const candidateId = trimText(candidate?.id);
		const label = trimText(candidate?.label);
		if (!candidateId || !label) return;
		const button = el("button", {
			type: "button",
			class: `candidate-note candidate-note--button${selectedIds.has(candidateId) ? " is-selected" : ""}`,
		});
		button.appendChild(el("div", { class: "candidate-note__name", text: label }));
		button.appendChild(el("div", { class: "candidate-note__text", text: formatCandidateNoteText(candidate?.sessionNote) }));
		button.addEventListener("click", () => {
			const selected = new Set(getSelectedAuthorIds(authorSelect));
			if (selected.has(candidateId)) {
				selected.delete(candidateId);
			} else {
				ensureAuthorOption(authorSelect, buildStudentRecord({ id: candidateId, display_name: label }));
				selected.add(candidateId);
			}
			setSelectedAuthorIds(authorSelect, Array.from(selected));
			authorSelect.dispatchEvent(new Event("change", { bubbles: true }));
		});
		root.appendChild(button);
	});
}

function syncUploadAuthorUi() {
	renderUploadSelectedAuthors();
	renderUploadAuthorCandidates();
}

function getAuthorCandidatesForWork(work) {
	const ymd = String(work?.completedDate || "").trim();
	if (!ymd) return [];
	const groups = getParticipantsGroups(ymd);
	if (groups.length === 0) return [];

	const normClassroom = normalizeClassroom(work.classroom);
	let group = null;
	if (groups.length === 1) group = groups[0];
	else {
		group =
			groups.find((g) => normalizeClassroom(g.classroom) === normClassroom && (!work.venue || g.venue === work.venue)) ||
			groups.find((g) => normalizeClassroom(g.classroom) === normClassroom) ||
			(work.venue ? groups.find((g) => g.venue === work.venue) : null) ||
			groups[0];
	}

	const participants = Array.isArray(group?.participants) ? group.participants : [];
	return participants
		.map((participant) => buildAuthorCandidateFromParticipant(participant, { group }))
		.filter(Boolean);
}

function nextUploadDraftId() {
	const seq = Number(state.upload.nextDraftSeq) || 1;
	state.upload.nextDraftSeq = seq + 1;
	return `draft-${seq}`;
}

function createUploadFileEntry(file) {
	return {
		id: crypto.randomUUID(),
		file,
		previewUrl: URL.createObjectURL(file),
	};
}

function createUploadDraft(files, defaults = {}) {
	return {
		id: defaults.id || nextUploadDraftId(),
		files: Array.isArray(files) ? files : [],
		coverIndex: Math.max(0, Number(defaults.coverIndex) || 0),
		completedDate: trimText(defaults.completedDate),
		groupValue: trimText(defaults.groupValue),
		classroom: trimText(defaults.classroom),
		venue: trimText(defaults.venue),
		authorIds: Array.isArray(defaults.authorIds) ? [...new Set(defaults.authorIds.map(trimText).filter(Boolean))] : [],
		title: trimText(defaults.title),
		caption: trimText(defaults.caption),
		explicitTagIds: Array.isArray(defaults.explicitTagIds) ? [...new Set(defaults.explicitTagIds.map(trimText).filter(Boolean))] : [],
		ready: Boolean(defaults.ready),
		readyTouched: Boolean(defaults.readyTouched),
		authorCandidates: Array.isArray(defaults.authorCandidates) ? defaults.authorCandidates.slice() : [],
		status: trimText(defaults.status) || "pending",
		notionWorkId: trimText(defaults.notionWorkId),
		error: trimText(defaults.error),
	};
}

function disposeUploadFiles(files) {
	if (!Array.isArray(files)) return;
	files.forEach((entry) => {
		if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
	});
}

function getUploadDraftById(id) {
	const targetId = trimText(id);
	if (!targetId) return null;
	return state.upload.drafts.find((draft) => draft.id === targetId) || null;
}

function getActiveUploadDraft() {
	return getUploadDraftById(state.upload.activeDraftId);
}

function normalizeUploadDraftCoverIndex(draft) {
	const total = Array.isArray(draft?.files) ? draft.files.length : 0;
	if (!draft) return;
	if (total <= 0) {
		draft.coverIndex = 0;
		return;
	}
	const current = Number.isFinite(Number(draft.coverIndex)) ? Number(draft.coverIndex) : 0;
	draft.coverIndex = Math.max(0, Math.min(current, total - 1));
}

function normalizeUploadSelections() {
	const existingDraftIds = new Set(state.upload.drafts.map((draft) => draft.id));
	state.upload.selectedDraftIds = state.upload.selectedDraftIds.filter((id) => existingDraftIds.has(id));
	const active = getActiveUploadDraft();
	if (!active) {
		state.upload.selectedFileIds = [];
		return;
	}
	const fileIds = new Set((active.files || []).map((file) => file.id));
	state.upload.selectedFileIds = state.upload.selectedFileIds.filter((id) => fileIds.has(id));
}

function getUploadDraftDisplayTitle(draft, index) {
	const fallback = `作品${index + 1}`;
	const title = trimText(draft?.title);
	return title || fallback;
}

function getUploadDraftStatusLabel(draft) {
	const status = trimText(draft?.status) || "pending";
	if (status === "saved") return "登録済";
	if (status === "uploading") return "登録中";
	if (status === "error") return "失敗";
	return "未登録";
}

function updateUploadSelectionStatusText() {
	const statusEl = qs("#upload-image-selection-status");
	const splitBtn = qs("#upload-split-selected");
	const active = getActiveUploadDraft();
	if (!statusEl || !splitBtn) return;

	const selectedCount = state.upload.selectedFileIds.length;
	if (!active || (active.files || []).length === 0) {
		statusEl.textContent = "画像をチェックして作品を分割できます。";
		splitBtn.disabled = true;
		return;
	}
	if (active.status === "saved") {
		statusEl.textContent = "登録済み作品は画像分割できません。";
		splitBtn.disabled = true;
		return;
	}

	const total = active.files.length;
	statusEl.textContent =
		selectedCount > 0
			? `${selectedCount}枚選択中（全${total}枚）`
			: `この作品の画像 ${total}枚。分割したい画像をチェックしてください。`;
	splitBtn.disabled = selectedCount === 0 || selectedCount >= total;
}

function renderUploadDraftList() {
	const root = qs("#upload-draft-list");
	const statusEl = qs("#upload-draft-status");
	const mergeBtn = qs("#upload-draft-merge");
	if (!root || !statusEl || !mergeBtn) return;

	normalizeUploadSelections();
	root.innerHTML = "";

	const drafts = state.upload.drafts;
	if (drafts.length === 0) {
		root.appendChild(el("div", { class: "subnote", text: "作品キューは空です。" }));
		statusEl.textContent = "画像を選択すると作品キューが作成されます。";
		mergeBtn.disabled = true;
		return;
	}

	const totalFiles = drafts.reduce((sum, draft) => sum + (draft.files?.length || 0), 0);
	const pendingCount = drafts.filter((draft) => draft.status !== "saved").length;
	statusEl.textContent = `作品 ${drafts.length}件 / 画像 ${totalFiles}枚 / 未登録 ${pendingCount}件`;
	const mergeCandidates = drafts.filter((draft) => state.upload.selectedDraftIds.includes(draft.id) && draft.status !== "saved");
	mergeBtn.disabled = mergeCandidates.length < 2;

	drafts.forEach((draft, idx) => {
		const card = el("div", { class: `upload-draft-card${draft.id === state.upload.activeDraftId ? " is-active" : ""}` });
		const title = getUploadDraftDisplayTitle(draft, idx);
		const statusLabel = getUploadDraftStatusLabel(draft);
		const metaParts = [statusLabel, `${draft.files?.length || 0}枚`, draft.completedDate || "-", draft.classroom || "-"].filter(Boolean);
		if (draft.error && draft.status === "error") metaParts.push(draft.error);

		const checkWrap = el("label", { class: "checkbox checkbox--sm" });
		const check = el("input", { type: "checkbox" });
		check.checked = state.upload.selectedDraftIds.includes(draft.id);
		if (draft.status === "saved") check.disabled = true;
		check.addEventListener("change", () => {
			const selected = new Set(state.upload.selectedDraftIds);
			if (check.checked) selected.add(draft.id);
			else selected.delete(draft.id);
			state.upload.selectedDraftIds = Array.from(selected);
			renderUploadDraftList();
		});
		checkWrap.appendChild(check);
		checkWrap.appendChild(el("span", { text: "統合対象" }));

		const editBtn = el("button", { type: "button", class: "btn", text: draft.id === state.upload.activeDraftId ? "編集中" : "編集" });
		if (draft.id === state.upload.activeDraftId) editBtn.disabled = true;
		editBtn.addEventListener("click", () => {
			setActiveUploadDraft(draft.id, { saveCurrent: true });
		});

		card.appendChild(el("div", { class: "upload-draft-card__head" }, [checkWrap, editBtn]));
		card.appendChild(el("div", { class: "upload-draft-card__title", text: title }));
		card.appendChild(el("div", { class: "upload-draft-card__meta", text: metaParts.join(" / ") }));

		const thumbs = el("div", { class: "upload-draft-card__thumbs" });
		(draft.files || []).slice(0, 8).forEach((entry) => {
			const thumb = el("div", { class: "upload-draft-card__thumb" });
			thumb.appendChild(el("img", { src: entry.previewUrl, alt: "" }));
			thumbs.appendChild(thumb);
		});
		card.appendChild(thumbs);

		root.appendChild(card);
	});
}

function saveActiveDraftFromForm() {
	const active = getActiveUploadDraft();
	if (!active) return;

	active.coverIndex = state.upload.coverIndex;
	active.completedDate = trimText(qs("#upload-completed-date")?.value);
	active.groupValue = trimText(qs("#upload-group")?.value);
	active.classroom = normalizeClassroom(qs("#upload-classroom")?.value);
	active.venue = trimText(qs("#upload-venue")?.value);
	active.authorIds = getSelectedAuthorIds(qs("#upload-author"));
	active.title = trimText(qs("#upload-title")?.value);
	active.caption = trimText(qs("#upload-caption")?.value);
	active.explicitTagIds = Array.isArray(state.upload.explicitTagIds) ? state.upload.explicitTagIds.slice() : [];
	active.ready = Boolean(qs("#upload-ready")?.checked);
	active.readyTouched = Boolean(state.upload.readyTouched);
	active.authorCandidates = Array.isArray(state.upload.authorCandidates) ? state.upload.authorCandidates.slice() : [];
	normalizeUploadDraftCoverIndex(active);
}

function applyDraftToUploadForm(draft) {
	const dateInput = qs("#upload-completed-date");
	const classroomInput = qs("#upload-classroom");
	const venueInput = qs("#upload-venue");
	const titleInput = qs("#upload-title");
	const captionInput = qs("#upload-caption");
	const readyCb = qs("#upload-ready");
	const authorSearch = qs("#upload-author-search");
	const authorSearchResults = qs("#upload-author-search-results");
	const exifNote = qs("#upload-exif-note");
	const status = qs("#upload-status");

	const targetDraft = draft || null;
	state.upload.files = targetDraft?.files ? targetDraft.files.slice() : [];
	state.upload.coverIndex = targetDraft?.coverIndex || 0;
	state.upload.explicitTagIds = targetDraft?.explicitTagIds ? targetDraft.explicitTagIds.slice() : [];
	state.upload.readyTouched = Boolean(targetDraft?.readyTouched);
	state.upload.authorCandidates = targetDraft?.authorCandidates ? targetDraft.authorCandidates.slice() : [];
	state.upload.selectedFileIds = [];

	if (titleInput) titleInput.value = targetDraft?.title || "";
	if (captionInput) captionInput.value = targetDraft?.caption || "";
	if (dateInput) dateInput.value = targetDraft?.completedDate || "";
	if (classroomInput) classroomInput.value = targetDraft?.classroom || "";
	if (venueInput) venueInput.value = targetDraft?.venue || "";
	if (authorSearch) authorSearch.value = "";
	if (authorSearchResults) authorSearchResults.innerHTML = "";
	if (status) status.textContent = "";

	if (targetDraft) {
		updateUploadGroupAndAuthorCandidates({
			preferredGroupValue: targetDraft.groupValue || "",
			preferredAuthorIds: targetDraft.authorIds || [],
		});
	} else {
		updateUploadGroupAndAuthorCandidates({ preferredGroupValue: "", preferredAuthorIds: [] });
	}

	if (typeof state.upload.setTagState === "function") {
		state.upload.setTagState(targetDraft?.explicitTagIds || []);
	}

	if (readyCb) {
		if (targetDraft) {
			readyCb.checked = targetDraft.readyTouched ? Boolean(targetDraft.ready) : computeUploadReadyDefault();
		} else {
			readyCb.checked = false;
		}
	}

	if (exifNote) exifNote.textContent = targetDraft?.completedDate ? `完成日: ${targetDraft.completedDate}` : "";

	renderUploadPreviews();
	syncUploadAuthorUi();
}

function setActiveUploadDraft(draftId, { saveCurrent = true } = {}) {
	if (saveCurrent) saveActiveDraftFromForm();

	const target = getUploadDraftById(draftId);
	if (!target) return;
	state.upload.activeDraftId = target.id;
	applyDraftToUploadForm(target);
	renderUploadDraftList();
}

function renderUploadPreviews() {
	const root = qs("#upload-previews");
	if (!root) return;
	root.innerHTML = "";

	const active = getActiveUploadDraft();
	if (!active) {
		updateUploadSelectionStatusText();
		return;
	}

	normalizeUploadSelections();
	state.upload.files = active.files;
	state.upload.coverIndex = active.coverIndex;

	(active.files || []).forEach((entry, idx) => {
		const item = el("div", {
			class: `preview${idx === active.coverIndex ? " is-cover" : ""}${state.upload.selectedFileIds.includes(entry.id) ? " is-selected" : ""}`,
		});
		const img = el("img", { src: entry.previewUrl, alt: "" });
		const check = el("input", { class: "preview__select", type: "checkbox" });
		check.checked = state.upload.selectedFileIds.includes(entry.id);
		check.addEventListener("click", (e) => e.stopPropagation());
		check.addEventListener("change", () => {
			const selected = new Set(state.upload.selectedFileIds);
			if (check.checked) selected.add(entry.id);
			else selected.delete(entry.id);
			state.upload.selectedFileIds = Array.from(selected);
			renderUploadPreviews();
		});

		item.appendChild(img);
		item.appendChild(check);
		if (idx === active.coverIndex) item.appendChild(el("div", { class: "badge", text: "表紙" }));
		item.addEventListener("click", () => {
			active.coverIndex = idx;
			state.upload.coverIndex = idx;
			renderUploadPreviews();
			renderUploadDraftList();
		});
		root.appendChild(item);
	});

updateUploadSelectionStatusText();
}

function formatDateYmdInJst(date) {
	if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: JST_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(date);
	const byType = new Map(parts.map((part) => [part.type, part.value]));
	const year = trimText(byType.get("year"));
	const month = trimText(byType.get("month"));
	const day = trimText(byType.get("day"));
	if (!year || !month || !day) return "";
	return `${year}-${month}-${day}`;
}

function parseExifDateTimeParts(value) {
	const m = trimText(value).match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
	if (!m) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	const hour = Number(m[4]);
	const minute = Number(m[5]);
	const second = Number(m[6]);
	if ([year, month, day, hour, minute, second].some((n) => !Number.isFinite(n))) return null;
	return { year, month, day, hour, minute, second };
}

function parseExifOffsetMinutes(value) {
	const m = trimText(value).match(/^([+-])(\d{2}):?(\d{2})$/);
	if (!m) return null;
	const sign = m[1] === "-" ? -1 : 1;
	const hours = Number(m[2]);
	const minutes = Number(m[3]);
	if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
	return sign * (hours * 60 + minutes);
}

function toJstYmdFromExif(dateTimeValue, offsetValue = "") {
	const parts = parseExifDateTimeParts(dateTimeValue);
	if (!parts) return "";
	const exifDate = `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
	const offsetMinutes = parseExifOffsetMinutes(offsetValue);
	if (offsetMinutes === null) return exifDate;
	const utcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - offsetMinutes * 60 * 1000;
	return formatDateYmdInJst(new Date(utcMs)) || exifDate;
}

function getExifDateInfoFromJpeg(arrayBuffer) {
	const view = new DataView(arrayBuffer);
	const getAscii = (offset, len) => {
		let out = "";
		for (let i = 0; i < len; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
		return out;
	};

	if (view.byteLength < 4) return null;
	if (view.getUint16(0) !== 0xffd8) return null;

	let offset = 2;
	while (offset + 4 < view.byteLength) {
		if (view.getUint8(offset) !== 0xff) break;
		const marker = view.getUint8(offset + 1);
		offset += 2;
		if (marker === 0xda) break;

		const size = view.getUint16(offset);
		if (size < 2) break;

		if (marker === 0xe1) {
			const header = getAscii(offset + 2, 6);
			if (header === "Exif\0\0") {
				const tiffStart = offset + 2 + 6;
				const endian = getAscii(tiffStart, 2);
				const little = endian === "II";
				const readU16 = (o) => (little ? view.getUint16(o, true) : view.getUint16(o, false));
				const readU32 = (o) => (little ? view.getUint32(o, true) : view.getUint32(o, false));

				if (readU16(tiffStart + 2) !== 42) return null;
				const ifd0Offset = readU32(tiffStart + 4);
				let ifdOffset = tiffStart + ifd0Offset;
				if (ifdOffset + 2 > view.byteLength) return null;
				const entries = readU16(ifdOffset);
				ifdOffset += 2;

				const readAsciiValue = (entryOffset) => {
					const type = readU16(entryOffset + 2);
					const count = readU32(entryOffset + 4);
					if (type !== 2 || count < 2) return "";
					const valueOffsetOrData = entryOffset + 8;
					const dataOffset = count <= 4 ? valueOffsetOrData : tiffStart + readU32(valueOffsetOrData);
					if (dataOffset + count > view.byteLength) return "";
					return getAscii(dataOffset, count - 1);
				};

				let exifIfdPtr = 0;
				let dateTime = "";
				for (let i = 0; i < entries; i += 1) {
					const entryOffset = ifdOffset + i * 12;
					const tag = readU16(entryOffset);
					if (tag === 0x8769) {
						exifIfdPtr = readU32(entryOffset + 8);
					}
					if (tag === 0x0132) dateTime = readAsciiValue(entryOffset);
				}

				let offsetText = "";
				if (exifIfdPtr) {
					const exifIfdOffset = tiffStart + exifIfdPtr;
					if (exifIfdOffset + 2 > view.byteLength) return null;
					const exifEntries = readU16(exifIfdOffset);
					const exifBase = exifIfdOffset + 2;
					for (let i = 0; i < exifEntries; i += 1) {
						const entryOffset = exifBase + i * 12;
						const tag = readU16(entryOffset);
						if (tag === 0x9003) dateTime = readAsciiValue(entryOffset) || dateTime;
						if (tag === 0x9011) offsetText = readAsciiValue(entryOffset) || offsetText;
						if (tag === 0x9010) offsetText = readAsciiValue(entryOffset) || offsetText;
					}
				}
				if (dateTime) return { dateTime, offsetText };
			}
		}

		offset += size;
	}
	return null;
}

async function inferCompletedDateFromFiles(files) {
	const note = qs("#upload-exif-note");
	if (!files || files.length === 0) return "";

	const first = files[0];
	try {
		const head = await first.slice(0, 256 * 1024).arrayBuffer();
		const exif = getExifDateInfoFromJpeg(head);
		if (exif?.dateTime) {
			const ymd = toJstYmdFromExif(exif.dateTime, exif.offsetText);
			if (note) {
				const offset = trimText(exif.offsetText);
				const extra = offset ? ` / Offset: ${offset}` : "";
				note.textContent = `EXIF: ${exif.dateTime}${extra} -> JST日付 ${ymd || "-"}`;
			}
			if (ymd) return ymd;
		}
		if (note && exif) {
			note.textContent = "EXIF日時は見つかりましたが形式を解釈できませんでした。";
		}
	} catch {
		// noop
	}

	const fallback = first.lastModified ? new Date(first.lastModified) : null;
	if (fallback && !Number.isNaN(fallback.getTime())) {
		const ymd = formatDateYmdInJst(fallback);
		if (note) note.textContent = `EXIFなしのため lastModified からJST推定: ${ymd || "-"}`;
		return ymd;
	}

	if (note) note.textContent = "EXIFなし。日付を手入力してください。";
	return "";
}

function updateUploadGroupAndAuthorCandidates({ preferredGroupValue = "", preferredAuthorIds = null } = {}) {
	const dateInput = qs("#upload-completed-date");
	const ymd = String(dateInput.value || "").trim();

	const groupSelect = qs("#upload-group");
	const authorSelect = qs("#upload-author");
	if (!groupSelect || !authorSelect) return;

	const selectedAuthorIds = Array.isArray(preferredAuthorIds)
		? [...new Set(preferredAuthorIds.map(trimText).filter(Boolean))]
		: getSelectedAuthorIds(authorSelect);
	const selectedLabelsById = new Map(
		Array.from(authorSelect.options || [])
			.map((option) => [trimText(option.value), trimText(option.textContent)])
			.filter(([id, label]) => id && label),
	);

	const groups = ymd ? getParticipantsGroups(ymd) : [];
	populateSelect(groupSelect, {
		placeholder: "自動/手動",
		items: groups.map((g, idx) => ({
			value: String(idx),
			label: `${g.classroom || "-"} / ${g.venue || "-"}`,
		})),
	});

	if (groups.length > 0 && trimText(preferredGroupValue)) {
		const targetValue = trimText(preferredGroupValue);
		const exists = groups.some((_, idx) => String(idx) === targetValue);
		if (exists) groupSelect.value = targetValue;
	}

	let selectedGroup = null;
	if (groups.length === 1) {
		selectedGroup = groups[0];
		groupSelect.value = "0";
	}
	if (groups.length > 1 && groupSelect.value) selectedGroup = groups[Number(groupSelect.value)] || null;

	const venueFromGroup = selectedGroup?.venue || "";
	const classroomFromGroup = selectedGroup?.classroom || "";

	const classroomSelect = qs("#upload-classroom");
	if (classroomSelect && classroomFromGroup) classroomSelect.value = normalizeClassroom(classroomFromGroup);

	const venueSelect = qs("#upload-venue");
	const venueWarning = qs("#upload-venue-warning");
	if (venueSelect && venueFromGroup) {
		const options = Array.from(venueSelect.options).map((o) => o.value).filter(Boolean);
		if (options.includes(venueFromGroup)) {
			venueSelect.value = venueFromGroup;
			if (venueWarning) {
				venueWarning.hidden = true;
				venueWarning.textContent = "";
			}
		} else {
			venueSelect.value = "";
			if (venueWarning) {
				venueWarning.hidden = false;
				venueWarning.textContent = `会場「${venueFromGroup}」はNotionのSelect候補に存在しないため保存しません。手動選択してください。`;
			}
		}
	} else {
		if (venueWarning) {
			venueWarning.hidden = true;
			venueWarning.textContent = "";
		}
	}

	const participants = Array.isArray(selectedGroup?.participants) ? selectedGroup.participants : [];
	const candidates = participants
		.map((participant) => buildAuthorCandidateFromParticipant(participant, { group: selectedGroup }))
		.filter(Boolean);
	const options = candidates.map((candidate) => ({
		value: candidate.id,
		label: candidate.label,
	}));

	authorSelect.innerHTML = "";
	options.forEach((o) => authorSelect.appendChild(el("option", { value: o.value, text: o.label })));
	for (const selectedId of selectedAuthorIds) {
		const record = getStudentRecordByAnyId(selectedId);
		if (record) {
			ensureAuthorOption(authorSelect, record);
			continue;
		}
		const fallbackLabel = selectedLabelsById.get(selectedId);
		if (fallbackLabel) {
			authorSelect.appendChild(el("option", { value: selectedId, text: fallbackLabel }));
		}
	}
	setSelectedAuthorIds(authorSelect, selectedAuthorIds);
	state.upload.authorCandidates = candidates;
	const active = getActiveUploadDraft();
	if (active) {
		active.groupValue = trimText(groupSelect.value);
		active.authorCandidates = candidates.slice();
	}
	syncUploadAuthorUi();
}

function clearUploadSelectedFiles() {
	const allFiles = state.upload.drafts.flatMap((draft) => draft.files || []);
	disposeUploadFiles(allFiles);
	state.upload.drafts = [];
	state.upload.activeDraftId = "";
	state.upload.selectedDraftIds = [];
	state.upload.selectedFileIds = [];
	state.upload.files = [];
	state.upload.coverIndex = 0;
	state.upload.explicitTagIds = [];
	state.upload.readyTouched = false;
	state.upload.authorCandidates = [];
	if (typeof state.upload.setTagState === "function") state.upload.setTagState([]);
	renderUploadDraftList();
	renderUploadPreviews();
}

function resetUploadFormForNextEntry(statusText = "登録完了。次の作品を登録できます。") {
	const form = qs("#upload-form");
	const filesInput = qs("#upload-files");
	const status = qs("#upload-status");
	const exifNote = qs("#upload-exif-note");
	const authorSearch = qs("#upload-author-search");
	const authorSearchResults = qs("#upload-author-search-results");

	clearUploadSelectedFiles();
	if (form) form.reset();
	state.upload.explicitTagIds = [];
	state.upload.readyTouched = false;
	state.upload.authorCandidates = [];
	if (typeof state.upload.setTagState === "function") state.upload.setTagState([]);

	if (exifNote) exifNote.textContent = "";
	if (authorSearch) authorSearch.value = "";
	if (authorSearchResults) authorSearchResults.innerHTML = "";
	if (filesInput) filesInput.value = "";
	updateUploadGroupAndAuthorCandidates({ preferredGroupValue: "", preferredAuthorIds: [] });

	if (status) status.textContent = statusText;
	if (filesInput) filesInput.focus();
}

function createUploadDraftsFromFiles(files, { completedDate = "", classroom = "", venue = "" } = {}) {
	return files.map((file) =>
		createUploadDraft([createUploadFileEntry(file)], {
			completedDate,
			classroom,
			venue,
			ready: false,
			readyTouched: false,
			status: "pending",
		}),
	);
}

function splitSelectedFilesFromActiveDraft() {
	saveActiveDraftFromForm();
	const active = getActiveUploadDraft();
	if (!active) return showToast("作品を選択してください");
	if (active.status === "saved") return showToast("登録済み作品は分割できません。");

	const selectedSet = new Set(state.upload.selectedFileIds);
	const picked = active.files.filter((entry) => selectedSet.has(entry.id));
	if (picked.length === 0) return showToast("分割する画像を選択してください");
	if (picked.length >= active.files.length) return showToast("全画像選択は分割できません。1枚以上は元作品に残してください。");

	active.files = active.files.filter((entry) => !selectedSet.has(entry.id));
	normalizeUploadDraftCoverIndex(active);
	active.status = active.status === "saved" ? "pending" : active.status;
	active.error = "";

	const newDraft = createUploadDraft(picked, {
		completedDate: active.completedDate,
		groupValue: active.groupValue,
		classroom: active.classroom,
		venue: active.venue,
		authorIds: active.authorIds,
		title: "",
		caption: "",
		explicitTagIds: [],
		ready: false,
		readyTouched: false,
		authorCandidates: active.authorCandidates,
		status: "pending",
	});

	const activeIndex = state.upload.drafts.findIndex((draft) => draft.id === active.id);
	if (activeIndex >= 0) state.upload.drafts.splice(activeIndex + 1, 0, newDraft);
	else state.upload.drafts.push(newDraft);

	state.upload.selectedFileIds = [];
	state.upload.selectedDraftIds = [];
	setActiveUploadDraft(newDraft.id, { saveCurrent: false });
	showToast("選択画像を新しい作品に分割しました");
}

function mergeSelectedUploadDrafts() {
	saveActiveDraftFromForm();
	const selected = state.upload.selectedDraftIds
		.map((id) => getUploadDraftById(id))
		.filter(Boolean)
		.filter((draft) => draft.status !== "saved");
	if (selected.length < 2) return showToast("統合する作品を2件以上選択してください");

	const active = getActiveUploadDraft();
	const primary = active && selected.some((draft) => draft.id === active.id) ? active : selected[0];
	const mergeIds = new Set(selected.map((draft) => draft.id));
	const mergedFiles = [];
	for (const draft of selected) {
		mergedFiles.push(...(draft.files || []));
	}
	primary.files = mergedFiles;
	normalizeUploadDraftCoverIndex(primary);
	primary.status = "pending";
	primary.error = "";
	primary.notionWorkId = "";

	state.upload.drafts = state.upload.drafts.filter((draft) => !mergeIds.has(draft.id) || draft.id === primary.id);
	state.upload.selectedDraftIds = [];
	state.upload.selectedFileIds = [];
	setActiveUploadDraft(primary.id, { saveCurrent: false });
	showToast(`${selected.length}件を1件に統合しました`);
}

function initUpload() {
	const classroomSelect = qs("#upload-classroom");
	const venueSelect = qs("#upload-venue");

	const classroomOptions = (state.schema?.classroomOptions || []).map((v) => ({ value: v }));
	populateSelect(classroomSelect, { placeholder: "未選択", items: classroomOptions });

	const venueOptions = (state.schema?.venueOptions || []).map((v) => ({ value: v }));
	populateSelect(venueSelect, { placeholder: "未選択", items: venueOptions });

	const dateInput = qs("#upload-completed-date");
	const fromQuery = new URLSearchParams(window.location.search).get("date");
	if (fromQuery && /^\d{4}-\d{2}-\d{2}$/.test(fromQuery) && !dateInput.value) {
		dateInput.value = fromQuery;
	}

	const filesInput = qs("#upload-files");
	filesInput.addEventListener("change", async () => {
		clearUploadSelectedFiles();
		const files = Array.from(filesInput.files || []);
		if (files.length === 0) {
			resetUploadFormForNextEntry("画像を選択してください。");
			return;
		}

		const inferredDate = await inferCompletedDateFromFiles(files);
		const initialDate = inferredDate || fromQuery || "";
		const drafts = createUploadDraftsFromFiles(files, {
			completedDate: initialDate,
			classroom: normalizeClassroom(classroomSelect?.value || ""),
			venue: trimText(venueSelect?.value),
		});
		state.upload.drafts = drafts;
		state.upload.activeDraftId = drafts[0]?.id || "";
		state.upload.selectedDraftIds = [];
		state.upload.selectedFileIds = [];
		renderUploadDraftList();
		if (drafts[0]) {
			setActiveUploadDraft(drafts[0].id, { saveCurrent: false });
			const status = qs("#upload-status");
			if (status) status.textContent = `${drafts.length}作品分の下書きを作成しました。作品ごとに内容を確認して登録してください。`;
		}
	});

	dateInput.addEventListener("change", () => {
		state.upload.readyTouched = false;
		updateUploadGroupAndAuthorCandidates();
		saveActiveDraftFromForm();
		renderUploadDraftList();
	});

	const groupSelect = qs("#upload-group");
	groupSelect.addEventListener("change", () => {
		updateUploadGroupAndAuthorCandidates();
		saveActiveDraftFromForm();
	});

	classroomSelect?.addEventListener("change", () => {
		saveActiveDraftFromForm();
		renderUploadDraftList();
	});
	venueSelect?.addEventListener("change", () => {
		saveActiveDraftFromForm();
		renderUploadDraftList();
	});

	initStudentSearch();
	initTagInput("upload");

	const readyCb = qs("#upload-ready");
	const syncReady = () => {
		if (state.upload.readyTouched) return;
		readyCb.checked = computeUploadReadyDefault();
		saveActiveDraftFromForm();
		renderUploadDraftList();
	};
	readyCb.addEventListener("change", () => {
		state.upload.readyTouched = true;
		saveActiveDraftFromForm();
		renderUploadDraftList();
	});
	qs("#upload-title").addEventListener("input", () => {
		syncReady();
		saveActiveDraftFromForm();
		renderUploadDraftList();
	});
	qs("#upload-caption").addEventListener("change", () => {
		saveActiveDraftFromForm();
		renderUploadDraftList();
	});
	qs("#upload-author").addEventListener("change", () => {
		syncReady();
		syncUploadAuthorUi();
		saveActiveDraftFromForm();
		renderUploadDraftList();
	});

	const splitBtn = qs("#upload-split-selected");
	if (splitBtn) splitBtn.addEventListener("click", () => splitSelectedFilesFromActiveDraft());

	const mergeBtn = qs("#upload-draft-merge");
	if (mergeBtn) mergeBtn.addEventListener("click", () => mergeSelectedUploadDrafts());

	const submitAllBtn = qs("#upload-submit-all");
	if (submitAllBtn) {
		submitAllBtn.addEventListener("click", async () => {
			await submitUpload({ all: true });
		});
	});

	const form = qs("#upload-form");
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		await submitUpload({ all: false });
	});

	updateUploadGroupAndAuthorCandidates({ preferredGroupValue: "", preferredAuthorIds: [] });
	renderUploadDraftList();
	renderUploadPreviews();
}

function initStudentSearch() {
	bindAuthorSearchInput({
		inputEl: qs("#upload-author-search"),
		resultsRoot: qs("#upload-author-search-results"),
		selectEl: qs("#upload-author"),
	});
}

function initTagInput(prefix) {
	const queryEl = qs(`#${prefix}-tag-query`);
	const suggestRoot = qs(`#${prefix}-tag-suggest`);
	const chipsRoot = qs(`#${prefix}-tag-chips`);
	const derivedNote = qs(`#${prefix}-tag-derived-note`);
	const childSuggestRoot = qs(`#${prefix}-tag-children`);

	const titleTagRoot = el("div", { class: "chips" });
	childSuggestRoot.after(titleTagRoot);
	const relationEditor = createTagRelationEditor({
		onTagAdded: (id) => {
			const resolvedId = resolveMergedTagId(id);
			if (!resolvedId) return;
			const next = Array.from(new Set([...state.upload.explicitTagIds, resolvedId]));
			setState(next);
		},
	});
	titleTagRoot.after(relationEditor);

	const refreshTitleTag = () => {
		renderTitleTagSuggest(titleTagRoot, {
			getTitle: () => qs("#upload-title")?.value || "",
			getExplicitTagIds: () => state.upload.explicitTagIds,
			onTagAdded: (id) => setState(Array.from(new Set([...state.upload.explicitTagIds, id]))),
		});
	};

	const setState = (explicitIds) => {
		const normalizedExplicit = Array.from(
			new Set((Array.isArray(explicitIds) ? explicitIds : []).map((id) => resolveMergedTagId(trimText(id))).filter(Boolean)),
		);
		state.upload.explicitTagIds = normalizedExplicit;
		const derivedIds = computeDerivedParentTagIds(normalizedExplicit);
		renderChips(chipsRoot, {
			explicitIds: normalizedExplicit,
			derivedIds,
			onRemove: (id) => {
				setState(normalizedExplicit.filter((x) => x !== id));
			},
		});
		derivedNote.textContent = derivedIds.length > 0 ? `自動付与（親タグ）: ${derivedIds.length}件` : "";
		renderChildSuggest(childSuggestRoot, {
			explicitIds: normalizedExplicit,
			derivedIds,
			onAdd: (id) => setState(Array.from(new Set([...normalizedExplicit, id]))),
		});
		refreshTitleTag();
		if (!state.upload.readyTouched) {
			const readyCb = qs("#upload-ready");
			if (readyCb) readyCb.checked = computeUploadReadyDefault();
		}
		saveActiveDraftFromForm();
		renderUploadDraftList();
	};

	const renderSuggest = (query) => {
		const list = searchTags(query);
		suggestRoot.innerHTML = "";

		list.forEach((tag) => {
			const hint = tag.status === "merged" ? "統合タグ" : tag.usage_count ? `作品数 ${tag.usage_count}` : "";
			const item = el("div", { class: "suggest-item" }, [
				el("span", { text: tag.name }),
				el("span", { class: "suggest-item__hint", text: hint }),
			]);
			item.addEventListener("click", () => {
				const resolved = resolveMergedTagId(tag.id);
				if (!resolved) return;
				const next = Array.from(new Set([...state.upload.explicitTagIds, resolved]));
				setState(next);
				queryEl.value = "";
				suggestRoot.innerHTML = "";
				queryEl.focus();
			});
			suggestRoot.appendChild(item);
		});

		const q = String(query || "").trim();
		if (q && list.length < 6) {
			appendCreateTagSuggest(
				suggestRoot,
				q,
				(id) => {
					const next = Array.from(new Set([...state.upload.explicitTagIds, id]));
					setState(next);
					queryEl.value = "";
					suggestRoot.innerHTML = "";
				},
				{ relatedTagIds: state.upload.explicitTagIds },
			);
		}
	};

	queryEl.addEventListener(
		"input",
		debounce(() => renderSuggest(queryEl.value), 120),
	);

	document.addEventListener("click", () => {
		suggestRoot.innerHTML = "";
	});

	const titleEl = qs("#upload-title");
	if (titleEl) titleEl.addEventListener("input", debounce(refreshTitleTag, 200));

	state.upload.setTagState = (ids = []) => {
		queryEl.value = "";
		suggestRoot.innerHTML = "";
		setState(ids);
	};
	state.upload.resetTagState = () => state.upload.setTagState([]);
	state.upload.resetTagState();
}

function renderChildSuggest(root, { explicitIds, derivedIds, onAdd }) {
	if (!root) return;
	root.innerHTML = "";
	const selected = new Set([...explicitIds, ...derivedIds].map(resolveMergedTagId));

	const children = new Map();
	for (const id of explicitIds) {
		const tag = state.tagsById.get(resolveMergedTagId(id));
		if (!tag) continue;
		for (const c of tag.children || []) {
			const cid = resolveMergedTagId(c);
			if (!cid || selected.has(cid)) continue;
			const ctag = state.tagsById.get(cid);
			if (!ctag || ctag.status === "hidden") continue;
			children.set(cid, ctag);
		}
	}

	if (children.size === 0) return;
	root.appendChild(el("span", { class: "subnote", text: "子タグ候補：" }));
	for (const [id, tag] of children.entries()) {
		const chip = el("span", { class: "chip" });
		chip.appendChild(el("span", { text: tag.name }));
		chip.addEventListener("click", () => onAdd?.(id));
		root.appendChild(chip);
	}
}

function computeUploadReadyDefault() {
	const title = trimText(qs("#upload-title")?.value);
	const authorIds = getSelectedAuthorIds(qs("#upload-author"));
	const tags = state.upload.explicitTagIds || [];
	return Boolean(title && authorIds.length > 0 && tags.length > 0);
}

function getOrderedFilesForUploadDraft(draft) {
	const files = Array.isArray(draft?.files) ? draft.files.slice() : [];
	if (files.length <= 1) return files;
	const coverIndex = Math.max(0, Math.min(Number(draft.coverIndex) || 0, files.length - 1));
	const [cover] = files.splice(coverIndex, 1);
	files.unshift(cover);
	return files;
}

function validateUploadDraft(draft) {
	if (!draft || (draft.files || []).length === 0) return "画像を選択してください";
	if (!trimText(draft.completedDate)) return "完成日を入力してください";
	const classroom = normalizeClassroom(draft.classroom);
	if (!classroom) return "教室を選択してください";
	const invalidAuthorIds = (draft.authorIds || []).filter((id) => !isNotionIdLike(id));
	if (invalidAuthorIds.length > 0) {
		return "作者IDがNotion page idではありません。students_index.jsonに notion_id を含めるか、Notion検索で選択してください。";
	}
	return "";
}

async function submitSingleUploadDraft(draft, { statusEl, allowInteractiveRecovery = true } = {}) {
	const validationError = validateUploadDraft(draft);
	if (validationError) throw new Error(validationError);

	const completedDate = trimText(draft.completedDate);
	const classroom = normalizeClassroom(draft.classroom);
	const venue = trimText(draft.venue);
	const title = trimText(draft.title);
	const caption = trimText(draft.caption);
	const authorIds = Array.isArray(draft.authorIds) ? draft.authorIds.slice() : [];

	const explicitIds = Array.isArray(draft.explicitTagIds) ? draft.explicitTagIds.slice() : [];
	const derivedIds = computeDerivedParentTagIds(explicitIds);
	const tagIds = Array.from(new Set([...explicitIds, ...derivedIds]));
	const ready = Boolean(draft.ready);

	draft.status = "uploading";
	draft.error = "";
	renderUploadDraftList();

	const orderedFiles = getOrderedFilesForUploadDraft(draft);
	if (statusEl) statusEl.textContent = `${title || "作品"}: R2へアップロード中…`;

	let filesOut = [];
	try {
		const form = new FormData();
		orderedFiles.forEach((entry) => form.append("files", entry.file));
		form.append("prefix", `uploads/${completedDate}`);
		const uploaded = await apiFetch("/admin/r2/upload", { method: "POST", body: form });
		filesOut = uploaded?.files || [];
		if (statusEl) statusEl.textContent = `${title || "作品"}: Notionへ登録中…`;

		const createPayload = {
			title,
			completedDate,
			classroom,
			venue,
			authorIds,
			caption,
			tagIds,
			ready,
			images: filesOut.map((file) => ({ url: file.url, name: file.name })),
		};

		const tryCreate = async () =>
			apiFetch("/admin/notion/work", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(createPayload),
			});

		let created = null;
		try {
			created = await tryCreate();
		} catch (err) {
			console.error(err);
			if (!allowInteractiveRecovery) throw err;
			const retry = confirm("R2保存は成功しています。Notion作成を再試行しますか？（OK=再試行 / キャンセル=R2削除）");
			if (retry) {
				if (statusEl) statusEl.textContent = `${title || "作品"}: Notion作成を再試行中…`;
				created = await tryCreate();
			} else {
				const keys = filesOut.map((file) => file.key).filter(Boolean);
				if (keys.length > 0) {
					await apiFetch("/admin/r2/delete", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ keys }),
					});
					showToast("R2の孤立ファイルを削除しました");
				}
				throw err;
			}
		}

		draft.status = "saved";
		draft.error = "";
		draft.notionWorkId = trimText(created?.id);
		state.upload.selectedDraftIds = state.upload.selectedDraftIds.filter((id) => id !== draft.id);
		if (state.upload.activeDraftId === draft.id) {
			state.upload.selectedFileIds = [];
			renderUploadPreviews();
		}
		renderUploadDraftList();
		return created;
	} catch (err) {
		draft.status = "error";
		draft.error = trimText(err?.message) || "登録に失敗しました";
		renderUploadDraftList();
		throw err;
	}
}

async function submitUpload({ all = false } = {}) {
	const status = qs("#upload-status");
	const submit = qs("#upload-submit");
	const submitAll = qs("#upload-submit-all");

	saveActiveDraftFromForm();
	const active = getActiveUploadDraft();
	if (!active && !all) return showToast("作品を選択してください");
	if (!all && active?.status === "saved") {
		if (status) status.textContent = "この作品はすでに登録済みです。";
		return showToast("この作品はすでに登録済みです。");
	}

	const targets = all ? state.upload.drafts.filter((draft) => draft.status !== "saved") : [active];
	if (targets.length === 0) {
		if (status) status.textContent = "未登録の作品はありません。";
		return showToast("未登録の作品はありません。");
	}

	if (status) status.textContent = all ? `一括登録を開始します（${targets.length}件）…` : "登録処理を開始します…";
	submit.disabled = true;
	if (submitAll) submitAll.disabled = true;

	let success = 0;
	let failed = 0;
	let firstFailedDraft = null;

	try {
		for (let i = 0; i < targets.length; i += 1) {
			const draft = targets[i];
			setActiveUploadDraft(draft.id, { saveCurrent: false });
			const prefix = all ? `[${i + 1}/${targets.length}] ` : "";
			if (status) status.textContent = `${prefix}${getUploadDraftDisplayTitle(draft, i)} を登録中…`;
			try {
				await submitSingleUploadDraft(draft, { statusEl: status, allowInteractiveRecovery: !all });
				success += 1;
			} catch (err) {
				console.error(err);
				failed += 1;
				if (!firstFailedDraft) firstFailedDraft = draft;
				if (!all) throw err;
			}
		}
	} catch (err) {
		if (status) status.textContent = `失敗: ${err.message}`;
		showToast(`失敗: ${err.message}`);
	} finally {
		submit.disabled = false;
		if (submitAll) submitAll.disabled = false;
	}

	if (all) {
		if (failed === 0) {
			if (status) status.textContent = `一括登録完了: ${success}件`;
			showToast(`一括登録が完了しました（${success}件）`);
		} else {
			if (status) status.textContent = `一括登録完了: 成功${success}件 / 失敗${failed}件`;
			showToast(`一括登録を実行しました（成功${success}件 / 失敗${failed}件）`);
			if (firstFailedDraft) setActiveUploadDraft(firstFailedDraft.id, { saveCurrent: false });
		}
	} else {
		if (failed === 0 && success === 1) {
			const activeDraft = getActiveUploadDraft();
			const notionId = trimText(activeDraft?.notionWorkId);
			if (status) status.textContent = notionId ? `登録完了（Notion: ${notionId}）` : "登録完了";
			showToast("登録しました");
			const nextPending = state.upload.drafts.find((draft) => draft.status !== "saved");
			if (nextPending) setActiveUploadDraft(nextPending.id, { saveCurrent: false });
		}
	}
}

function applyCurationFilters() {
	const from = qs("#curation-from").value;
	const to = qs("#curation-to").value;
	const classroom = qs("#curation-classroom").value;
	const readyFilter = qs("#curation-ready-filter")?.value || "all";

	const missingTitle = qs("#curation-missing-title").checked;
	const missingAuthor = qs("#curation-missing-author").checked;
	const missingTags = qs("#curation-missing-tags").checked;

	const filtered = state.curation.works.filter((w) => {
		if (!isSameDayOrAfter(w.completedDate, from)) return false;
		if (!isSameDayOrBefore(w.completedDate, to)) return false;
		if (classroom && w.classroom !== classroom) return false;
		if (readyFilter === "unprepared" && w.ready) return false;
		if (readyFilter === "ready" && !w.ready) return false;
		if (missingTitle && w.title) return false;
		if (missingAuthor && (w.authorIds?.length || 0) > 0) return false;
		if (missingTags && (w.tagIds?.length || 0) > 0) return false;
		return true;
	});

	state.curation.filtered = filtered;
	renderCurationGrid();
}

function renderWorkCard(work, index) {
	const coverUrl = work.images?.[0]?.url || "";
	const title = work.title || "（無題）";
	const card = el("div", { class: "work-card", "data-index": String(index) });
	const thumb = el("div", { class: "work-card__thumb" });
	thumb.appendChild(el("img", { src: coverUrl, alt: "" }));
	if ((work.images?.length || 0) > 1) thumb.appendChild(el("div", { class: "badge", text: `${work.images.length}` }));
	card.appendChild(thumb);

	const meta = el("div", { class: "work-card__meta" });
	meta.appendChild(el("div", { class: "work-card__title", text: title }));
	meta.appendChild(
		el("div", { class: "work-card__sub" }, [
			el("span", { text: work.completedDate || "-" }),
			el("span", { text: work.ready ? "整備済" : "未整備" }),
			el("span", { text: work.classroom || "-" }),
		]),
	);
	card.appendChild(meta);

	card.addEventListener("click", () => openWorkModal(index));
	return card;
}

async function fetchAllWorksForCuration() {
	const out = [];
	let cursor = "";
	let loops = 0;
	do {
		const params = new URLSearchParams();
		if (cursor) params.set("cursor", cursor);
		const path = params.toString() ? `/admin/notion/works?${params.toString()}` : "/admin/notion/works";
		const data = await apiFetch(path);
		const results = Array.isArray(data?.results) ? data.results : [];
		out.push(...results);
		cursor = trimText(data?.nextCursor);
		loops += 1;
		if (loops > 200) throw new Error("作品一覧のページングが上限を超えました");
	} while (cursor);
	return out;
}

function renderCurationGrid() {
	const root = qs("#curation-grid");
	root.innerHTML = "";
	state.curation.filtered.forEach((w, idx) => {
		root.appendChild(renderWorkCard(w, idx));
	});
	qs("#curation-status").textContent = `${state.curation.filtered.length}件（全${state.curation.works.length}件）`;
}

async function loadCurationQueue() {
	qs("#curation-status").textContent = "読み込み中…";
	try {
		state.curation.works = await fetchAllWorksForCuration();
		state.curation.filtered = [...state.curation.works];

		const classroomSelect = qs("#curation-classroom");
		const currentClassroom = classroomSelect.value;
		const classrooms = Array.from(new Set(state.curation.works.map((w) => w.classroom).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja"));
		populateSelect(classroomSelect, { placeholder: "すべて", items: classrooms.map((v) => ({ value: v })) });
		if (currentClassroom && classrooms.includes(currentClassroom)) {
			classroomSelect.value = currentClassroom;
		}

		renderCurationGrid();
		applyCurationFilters();
	} catch (err) {
		qs("#curation-status").textContent = `失敗: ${err.message}`;
		showToast(`読み込み失敗: ${err.message}`);
	}
}

function buildViewer(work, { selectedUrls = new Set() } = {}) {
	let current = 0;
	const mainImg = el("img", { src: work.images?.[0]?.url || "", alt: "" });
	const badge = el("div", { class: "badge", text: `${1}/${Math.max(1, work.images?.length || 1)}` });
	const main = el("div", { class: "viewer-main" }, [mainImg, badge]);

	const strip = el("div", { class: "viewer-strip" });
	let thumbs = [];

	const renderStrip = () => {
		strip.innerHTML = "";
		thumbs = [];
		(work.images || []).forEach((img, idx) => {
			const t = el("div", { class: `viewer-thumb${idx === current ? " is-active" : ""}` });
			t.appendChild(el("img", { src: img.url, alt: "" }));

			const checkbox = el("input", { type: "checkbox" });
			checkbox.checked = selectedUrls.has(img.url);
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) selectedUrls.add(img.url);
				else selectedUrls.delete(img.url);
			});

			const overlay = el("label", { class: "thumb-select" }, [checkbox]);
			overlay.addEventListener("click", (e) => e.stopPropagation());
			t.appendChild(overlay);

			t.addEventListener("click", () => setCurrent(idx));
			strip.appendChild(t);
			thumbs.push(t);
		});
	};

	const setCurrent = (idx) => {
		current = Math.max(0, Math.min(idx, (work.images?.length || 1) - 1));
		mainImg.src = work.images[current]?.url || "";
		badge.textContent = `${current + 1}/${Math.max(1, work.images?.length || 1)}`;
		thumbs.forEach((t, i) => t.classList.toggle("is-active", i === current));
	};

	renderStrip();
	setCurrent(0);

	let startX = 0;
	mainImg.addEventListener("touchstart", (e) => {
		startX = e.touches?.[0]?.clientX || 0;
	});
	mainImg.addEventListener("touchend", (e) => {
		const endX = e.changedTouches?.[0]?.clientX || 0;
		const dx = endX - startX;
		if (Math.abs(dx) < 40) return;
		if (dx < 0) setCurrent(current + 1);
		else setCurrent(current - 1);
	});

	const makeCoverBtn = el("button", { type: "button", class: "btn", text: "この画像を表紙にする" });
	makeCoverBtn.addEventListener("click", () => {
		if (!work.images || work.images.length <= 1) return;
		const [picked] = work.images.splice(current, 1);
		work.images.unshift(picked);
		showToast("表紙を変更（保存で反映）");
		current = 0;
		renderStrip();
		setCurrent(0);
	});

	const clearSelectionBtn = el("button", { type: "button", class: "btn", text: "選択解除" });
	clearSelectionBtn.addEventListener("click", () => {
		selectedUrls.clear();
		renderStrip();
	});

	const actions = el("div", { class: "viewer-actions" }, [makeCoverBtn, clearSelectionBtn]);

	return {
		main,
		strip,
		actions,
		getCurrentImageUrl: () => work.images?.[current]?.url || "",
		getSelectedUrls: () => Array.from(selectedUrls),
	};
}

function renderWorkModal(work, index) {
	const modalRoot = qs("#modal-root");
	modalRoot.hidden = false;
	modalRoot.setAttribute("aria-hidden", "false");
	modalRoot.innerHTML = "";

	const close = () => {
		modalRoot.hidden = true;
		modalRoot.setAttribute("aria-hidden", "true");
		modalRoot.innerHTML = "";
	};

	const titleInput = el("input", { class: "input", type: "text", value: work.title || "" });
	const captionInput = el("textarea", { class: "input", rows: "3" });
	captionInput.value = work.caption || "";

	const readyCb = el("input", { type: "checkbox" });
	readyCb.checked = Boolean(work.ready);

	const authorSelect = el("select", { class: "input author-select-native", "aria-hidden": "true" });
	authorSelect.multiple = true;
	authorSelect.hidden = true;
	for (const s of state.studentsByNotionId.values()) {
		authorSelect.appendChild(el("option", { value: s.notionId, text: s.choiceLabel || s.displayName }));
	}
	setSelectedAuthorIds(authorSelect, Array.isArray(work.authorIds) ? work.authorIds : []);

	const authorCandidates = getAuthorCandidatesForWork(work);
	const authorSelected = el("div", { class: "chips", hidden: true });
	const authorCandidateNotes = el("div", { class: "candidate-notes" });
	const authorSearchInput = el("input", {
		class: "input",
		type: "text",
		placeholder: "例：けい",
		autocomplete: "off",
		"aria-label": "作者を名簿検索",
	});
	const authorSearchResults = el("div", { class: "suggest" });

	const syncModalAuthorUi = () => {
		syncAuthorPickerUi({
			selectEl: authorSelect,
			selectedRoot: authorSelected,
			candidatesRoot: authorCandidateNotes,
			candidates: authorCandidates,
		});
	};

	authorSelect.addEventListener("change", syncModalAuthorUi);
	bindAuthorSearchInput({
		inputEl: authorSearchInput,
		resultsRoot: authorSearchResults,
		selectEl: authorSelect,
	});
	syncModalAuthorUi();

	const tagQuery = el("input", { class: "input", type: "text", placeholder: "タグ検索", autocomplete: "off" });
	const tagSuggest = el("div", { class: "suggest" });
	const tagChips = el("div", { class: "chips" });
	const derivedNote = el("div", { class: "subnote" });
	const childSuggest = el("div", { class: "chips" });
	const titleTagRoot = el("div", { class: "chips" });
	const tagRelationEditor = createTagRelationEditor({
		onTagAdded: (id) => {
			const resolvedId = resolveMergedTagId(id);
			if (!resolvedId) return;
			explicitTagIds = Array.from(new Set([...explicitTagIds, resolvedId]));
			renderTags();
		},
	});
	let explicitTagIds = Array.isArray(work.tagIds) ? [...work.tagIds] : [];

	const refreshTitleTag = () => {
		renderTitleTagSuggest(titleTagRoot, {
			getTitle: () => titleInput.value || "",
			getExplicitTagIds: () => explicitTagIds,
			onTagAdded: (id) => {
				explicitTagIds = Array.from(new Set([...explicitTagIds, id]));
				renderTags();
			},
		});
	};

	const renderTags = () => {
		const derived = computeDerivedParentTagIds(explicitTagIds);
		renderChips(tagChips, {
			explicitIds: explicitTagIds,
			derivedIds: derived,
			onRemove: (id) => {
				explicitTagIds = explicitTagIds.filter((x) => x !== id);
				renderTags();
			},
		});
		derivedNote.textContent = derived.length ? `自動付与（親タグ）: ${derived.length}件` : "";
		renderChildSuggest(childSuggest, { explicitIds: explicitTagIds, derivedIds: derived, onAdd: (id) => {
			explicitTagIds = Array.from(new Set([...explicitTagIds, id]));
			renderTags();
		}});
		refreshTitleTag();
	};
	renderTags();

	const renderTagSuggest = debounce(() => {
		const q = trimText(tagQuery.value);
		const list = searchTags(q);
		tagSuggest.innerHTML = "";
		list.forEach((t) => {
			const item = el("div", { class: "suggest-item" }, [el("span", { text: t.name }), el("span", { class: "suggest-item__hint", text: t.status === "merged" ? "統合" : "" })]);
			item.addEventListener("click", () => {
				const id = resolveMergedTagId(t.id);
				explicitTagIds = Array.from(new Set([...explicitTagIds, id]));
				tagQuery.value = "";
				tagSuggest.innerHTML = "";
				renderTags();
			});
			tagSuggest.appendChild(item);
		});

		if (q && list.length < 6) {
			appendCreateTagSuggest(
				tagSuggest,
				q,
				(id) => {
					explicitTagIds = Array.from(new Set([...explicitTagIds, id]));
					tagQuery.value = "";
					tagSuggest.innerHTML = "";
					renderTags();
				},
				{ relatedTagIds: explicitTagIds },
			);
		}
	}, 120);
	tagQuery.addEventListener("input", renderTagSuggest);
	titleInput.addEventListener("input", debounce(refreshTitleTag, 200));

	const viewerWrap = el("div", { class: "image-viewer" });

	const selectedUrls = new Set();
	let viewer = null;
	const viewerColumn = el("div");
	const rebuildViewer = () => {
		viewerColumn.innerHTML = "";
		viewer = buildViewer(work, { selectedUrls });
		viewerColumn.appendChild(viewer.main);
		viewerColumn.appendChild(viewer.strip);
		viewerColumn.appendChild(viewer.actions);
	};
	rebuildViewer();
	viewerWrap.appendChild(viewerColumn);

	const tempTitleBtn = el("button", { type: "button", class: "btn", text: "仮題を付ける" });
	tempTitleBtn.addEventListener("click", () => {
		const shortClassroom = String(work.classroom || "").replace(/教室$/, "");
		const serial = String(index + 1).padStart(2, "0");
		titleInput.value = `${work.completedDate || "----"}（${shortClassroom || "-"}）#${serial}`;
		showToast("仮題をセットしました（整備済は自動でONになりません）");
	});

	const titleControls = el("div", { class: "inline-controls" }, [titleInput, tempTitleBtn]);

	const getSelectedOrCurrentUrls = () => {
		const list = viewer?.getSelectedUrls ? viewer.getSelectedUrls() : [];
		if (list.length > 0) return list;
		const currentUrl = viewer?.getCurrentImageUrl ? viewer.getCurrentImageUrl() : "";
		return currentUrl ? [currentUrl] : [];
	};

	const splitBtn = el("button", { type: "button", class: "btn", text: "選択画像で分割" });
	splitBtn.addEventListener("click", async () => {
		const urls = getSelectedOrCurrentUrls();
		if (urls.length === 0) return showToast("分割する画像が選択されていません");
		if (!confirm(`選択画像 ${urls.length}枚で新規作品に分割しますか？（新規は整備済=false）`)) return;
		splitBtn.disabled = true;
		try {
			const res = await apiFetch("/admin/image/split", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sourceWorkId: work.id, imageUrls: urls }),
			});
			showToast(`分割しました（new: ${res.newWorkId}）`);
			work.images = (work.images || []).filter((img) => !urls.includes(img.url));
			urls.forEach((u) => selectedUrls.delete(u));
			if ((work.images || []).length === 0) {
				showToast("元作品の画像が0枚になりました。必要なら作品はアーカイブしてください。");
				close();
				loadCurationQueue();
				return;
			}
			rebuildViewer();
		} catch (err) {
			showToast(`分割に失敗: ${err.message}`);
		} finally {
			splitBtn.disabled = false;
		}
	});

	const moveQuery = el("input", { class: "input input--sm", type: "text", placeholder: "移動先を検索（作品名）" });
	const moveResults = el("div", { class: "suggest" });
	const movePicked = el("div", { class: "subnote" });
	let moveTargetId = "";

	const renderWorkResults = (root, list, onPick) => {
		root.innerHTML = "";
		list.slice(0, 10).forEach((w) => {
			const label = w.title ? w.title : "（無題）";
			const hint = `${w.completedDate || "-"} / ${w.classroom || "-"}`;
			const item = el("div", { class: "suggest-item" }, [el("span", { text: label }), el("span", { class: "suggest-item__hint", text: hint })]);
			item.addEventListener("click", () => onPick(w));
			root.appendChild(item);
		});
	};

	const runMoveSearch = debounce(async () => {
		const q = moveQuery.value.trim();
		if (!q) return (moveResults.innerHTML = "");
		try {
			const res = await apiFetch(`/admin/notion/works?q=${encodeURIComponent(q)}`);
			const list = (res.results || []).filter((w) => w.id !== work.id);
			renderWorkResults(moveResults, list, (picked) => {
				moveTargetId = picked.id;
				movePicked.textContent = `移動先: ${picked.title || "（無題）"}（${picked.completedDate || "-"} / ${picked.classroom || "-"}）`;
				moveQuery.value = "";
				moveResults.innerHTML = "";
			});
		} catch (err) {
			moveResults.innerHTML = "";
		}
	}, 250);
	moveQuery.addEventListener("input", runMoveSearch);

	const moveBtn = el("button", { type: "button", class: "btn", text: "選択画像を移動" });
	moveBtn.addEventListener("click", async () => {
		const urls = getSelectedOrCurrentUrls();
		if (urls.length === 0) return showToast("移動する画像が選択されていません");
		if (!moveTargetId) return showToast("移動先の作品を選択してください");
		if (!confirm(`選択画像 ${urls.length}枚を移動しますか？`)) return;

		moveBtn.disabled = true;
		try {
			await apiFetch("/admin/image/move", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sourceWorkId: work.id, targetWorkId: moveTargetId, imageUrls: urls }),
			});
			showToast("移動しました");
			work.images = (work.images || []).filter((img) => !urls.includes(img.url));
			urls.forEach((u) => selectedUrls.delete(u));
			if ((work.images || []).length === 0) {
				showToast("移動元が0枚になりました（Notion側ではアーカイブされます）");
				close();
				loadCurationQueue();
				return;
			}
			rebuildViewer();
			moveTargetId = "";
			movePicked.textContent = "";
		} catch (err) {
			showToast(`移動に失敗: ${err.message}`);
		} finally {
			moveBtn.disabled = false;
		}
	});

	const mergeQuery = el("input", { class: "input input--sm", type: "text", placeholder: "統合元を検索（作品名）" });
	const mergeResults = el("div", { class: "suggest" });
	const mergeSourcesRoot = el("div", { class: "chips" });
	const mergeSources = new Map();

	const renderMergeSources = () => {
		mergeSourcesRoot.innerHTML = "";
		for (const [id, w] of mergeSources.entries()) {
			const chip = el("span", { class: "chip" });
			chip.appendChild(el("span", { text: w.title || "（無題）" }));
			const remove = el("button", { type: "button", text: "×" });
			remove.addEventListener("click", () => {
				mergeSources.delete(id);
				renderMergeSources();
			});
			chip.appendChild(remove);
			mergeSourcesRoot.appendChild(chip);
		}
	};

	const runMergeSearch = debounce(async () => {
		const q = mergeQuery.value.trim();
		if (!q) return (mergeResults.innerHTML = "");
		try {
			const res = await apiFetch(`/admin/notion/works?q=${encodeURIComponent(q)}`);
			const list = (res.results || []).filter((w) => w.id !== work.id && !mergeSources.has(w.id));
			renderWorkResults(mergeResults, list, (picked) => {
				mergeSources.set(picked.id, picked);
				renderMergeSources();
				mergeQuery.value = "";
				mergeResults.innerHTML = "";
			});
		} catch {
			mergeResults.innerHTML = "";
		}
	}, 250);
	mergeQuery.addEventListener("input", runMergeSearch);

	const mergeBtn = el("button", { type: "button", class: "btn", text: "統合（統合元はアーカイブ）" });
	mergeBtn.addEventListener("click", async () => {
		const sources = Array.from(mergeSources.keys());
		if (sources.length === 0) return showToast("統合元を追加してください");
		if (!confirm(`${sources.length}件の作品を統合しますか？（統合元はアーカイブ）`)) return;

		mergeBtn.disabled = true;
		try {
			await apiFetch("/admin/image/merge", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ targetWorkId: work.id, sourceWorkIds: sources, archiveSources: true }),
			});
			showToast("統合しました（反映は再読み込み後）");
			mergeSources.clear();
			renderMergeSources();
		} catch (err) {
			showToast(`統合に失敗: ${err.message}`);
		} finally {
			mergeBtn.disabled = false;
		}
	});

	const modalAuthorLabelId = `curation-author-label-${index}`;

	const info = el("div", {}, [
		el("div", { class: "form-row" }, [el("label", { class: "label", text: "作品名" }), titleControls]),
		el("div", { class: "form-row" }, [
			el("div", { id: modalAuthorLabelId, class: "label", text: "作者" }),
			authorSelect,
			el("div", { class: "author-picker", role: "group", "aria-labelledby": modalAuthorLabelId }, [
				authorSelected,
				authorCandidateNotes,
				el("div", { class: "author-picker__search" }, [
					el("div", { class: "subnote", text: "名簿検索" }),
					authorSearchInput,
					authorSearchResults,
				]),
			]),
		]),
		el("div", { class: "form-row" }, [el("label", { class: "label", text: "タグ" }), tagQuery, tagSuggest, tagChips, derivedNote, childSuggest, titleTagRoot, tagRelationEditor]),
		el("div", { class: "form-row" }, [el("label", { class: "label", text: "キャプション" }), captionInput]),
		el("div", { class: "form-row" }, [
			el("label", { class: "checkbox" }, [
				readyCb,
				el("span", { text: "整備済として確定（公開OK）" }),
			]),
		]),
		el("div", { class: "split-actions" }, [
			el("div", { class: "help", text: "画像セット操作（分割/移動/統合）" }),
			el("div", { class: "viewer-actions" }, [splitBtn]),
			el("div", { class: "form-row" }, [
				el("label", { class: "label", text: "移動" }),
				moveQuery,
				moveResults,
				movePicked,
				moveBtn,
			]),
			el("div", { class: "form-row" }, [
				el("label", { class: "label", text: "統合（この作品に集約）" }),
				el("div", { class: "subnote", text: "統合元は既定でアーカイブされます（★キーを温存）。" }),
				mergeQuery,
				mergeResults,
				mergeSourcesRoot,
				mergeBtn,
			]),
		]),
	]);

	viewerWrap.appendChild(info);

	const header = el("div", { class: "modal-header" }, [
		el("div", { class: "modal-title", text: `${work.completedDate || "-"} / ${work.classroom || "-"} / ${work.id}` }),
		el("button", { type: "button", class: "btn", text: "閉じる" }),
	]);
	header.querySelector("button").addEventListener("click", close);

	const footer = el("div", { class: "modal-footer" });

	const saveOnly = el("button", { type: "button", class: "btn", text: "保存のみ" });
	const saveNext = el("button", { type: "button", class: "btn btn--primary", text: "保存して次へ" });
	const skip = el("button", { type: "button", class: "btn", text: "スキップ" });

	footer.appendChild(skip);
	footer.appendChild(saveOnly);
	footer.appendChild(saveNext);

	const doSave = async ({ forceReady, goNext }) => {
		saveOnly.disabled = true;
		saveNext.disabled = true;
		skip.disabled = true;

		const derived = computeDerivedParentTagIds(explicitTagIds);
		const tagIds = Array.from(new Set([...explicitTagIds, ...derived]));
		const payload = {
			id: work.id,
			title: titleInput.value.trim(),
			authorIds: getSelectedAuthorIds(authorSelect),
			caption: captionInput.value.trim(),
			tagIds,
			ready: forceReady ? true : readyCb.checked,
			images: work.images || [],
		};

		try {
			await apiFetch("/admin/notion/work", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			showToast("保存しました");

			const nextWork = {
				...work,
				...payload,
				authorIds: payload.authorIds || [],
				tagIds,
				ready: payload.ready,
			};
			const idxAll = state.curation.works.findIndex((w) => w.id === work.id);
			if (idxAll >= 0) state.curation.works[idxAll] = nextWork;
			else state.curation.works.unshift(nextWork);

			applyCurationFilters();
			if (goNext) {
				close();
				openWorkModal(Math.min(index, state.curation.filtered.length - 1));
			} else {
				close();
			}
		} catch (err) {
			showToast(`保存に失敗: ${err.message}`);
		} finally {
			saveOnly.disabled = false;
			saveNext.disabled = false;
			skip.disabled = false;
		}
	};

	saveOnly.addEventListener("click", () => doSave({ forceReady: false, goNext: false }));
	saveNext.addEventListener("click", () => doSave({ forceReady: true, goNext: true }));
	skip.addEventListener("click", () => {
		close();
		openWorkModal(Math.min(index + 1, state.curation.filtered.length - 1));
	});

	const modal = el("div", { class: "modal" }, [header, el("div", { class: "modal-body" }, [viewerWrap]), footer]);
	modalRoot.appendChild(modal);

	modalRoot.addEventListener(
		"click",
		(e) => {
			if (e.target === modalRoot) close();
		},
		{ once: true },
	);
}

function openWorkModal(index) {
	state.curation.currentIndex = index;
	const work = state.curation.filtered[index];
	if (!work) return;
	renderWorkModal(work, index);
}

function initCuration() {
	qs("#curation-refresh").addEventListener("click", () => loadCurationQueue());
	qsa("#curation-from,#curation-to,#curation-classroom,#curation-ready-filter,#curation-missing-title,#curation-missing-author,#curation-missing-tags").forEach((elx) => {
		elx.addEventListener("change", () => applyCurationFilters());
	});
}

function initHeaderActions() {
	const triggerBtn = qs("#trigger-gallery-update");
	triggerBtn.addEventListener("click", async () => {
		if (!confirm("ギャラリーを更新しますか？（反映まで1〜2分かかります）")) return;
		triggerBtn.disabled = true;
		try {
			await apiFetch("/admin/trigger-gallery-update", { method: "POST" });
			showToast("更新をリクエストしました（1〜2分後に反映）");
		} catch (err) {
			showToast(`更新に失敗: ${err.message}`);
		} finally {
			triggerBtn.disabled = false;
		}
	});
}

function initToolsActions() {
	const tagEditorMount = qs("#tools-tag-relation-editor");
	if (tagEditorMount) {
		tagEditorMount.innerHTML = "";
		tagEditorMount.appendChild(
			createTagRelationEditor({
				onTagAdded: () => {},
			}),
		);
	}

	const recalcStatusEl = qs("#tools-tags-recalc-status");
	if (recalcStatusEl) recalcStatusEl.textContent = "-";

	const recalcBtn = qs("#trigger-tags-recalc-apply");
	if (recalcBtn) {
		recalcBtn.addEventListener("click", async () => {
			if (!confirm("タグDBの親子関係・統合ルールを既存作品へ反映しますか？")) return;
			recalcBtn.disabled = true;
			try {
				const res = await apiFetch("/admin/tag-recalc", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ apply: true }),
				});
				const updated = Number(res?.updated || 0);
				const changed = Number(res?.changed || 0);
				const scanned = Number(res?.scanned || 0);
				const remaining = Number(res?.remaining || 0);
				const warnings = Array.isArray(res?.warnings) ? res.warnings.length : 0;
				if (recalcStatusEl) {
					const suffix = warnings > 0 ? ` / 警告${warnings}件` : "";
					recalcStatusEl.textContent = `${formatIso(new Date().toISOString())}: 反映 ${updated}/${changed}件（走査${scanned}件、残${remaining}件）${suffix}`;
				}
				if (remaining > 0) {
					showToast(`タグ反映を実行しました（${updated}件反映、残り${remaining}件）。必要なら再実行してください。`);
				} else {
					showToast(`タグ反映を完了しました（${updated}件反映）`);
				}
				await loadSchemaAndIndexes();
				await loadCurationQueue();
			} catch (err) {
				if (recalcStatusEl) recalcStatusEl.textContent = `失敗: ${err.message}`;
				showToast(`タグ反映に失敗: ${err.message}`);
			} finally {
				recalcBtn.disabled = false;
			}
		});
	}

	const generatedAtEl = qs("#tools-tags-generated-at");
	if (generatedAtEl) {
		generatedAtEl.textContent = state.tagsIndex?.generated_at ? `generated_at: ${formatIso(state.tagsIndex.generated_at)}` : "-";
	}

	const btn = qs("#trigger-tags-index-update");
	if (!btn) return;
	btn.addEventListener("click", async () => {
		if (!confirm("タグインデックスを再生成しますか？")) return;
		btn.disabled = true;
		try {
			await apiFetch("/admin/trigger-tags-index-update", { method: "POST" });
			showToast("再生成をリクエストしました（反映まで少し待ってください）");
		} catch (err) {
			showToast(`再生成に失敗: ${err.message}`);
		} finally {
			btn.disabled = false;
		}
	});
}

async function init() {
	state.config = getConfig();
	initHeaderToolsToggle();
	initAdminAuthControls();
	initTabs();
	initHeaderActions();
	await loadGalleryUpdatedAt();
	await loadSchemaAndIndexes();

	initToolsActions();
	initUpload();
	initCuration();
	await loadCurationQueue();
}

init().catch((err) => {
	console.error(err);
	showToast(`初期化に失敗: ${err.message}`);
});
