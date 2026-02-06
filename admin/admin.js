import { debounce, el, formatIso, normalizeSearch, qs, qsa, showToast } from "../shared/gallery-core.js";

const state = {
	config: null,
	schema: null,
	participantsIndex: null,
	studentsIndex: null,
	studentsByNotionId: new Map(),
	studentsByStudentId: new Map(),
	tagsIndex: null,
	tagsById: new Map(),
	tagsSearch: [],
	upload: {
		files: [],
		coverIndex: 0,
		explicitTagIds: [],
		readyTouched: false,
	},
	curation: {
		works: [],
		filtered: [],
		currentIndex: -1,
	},
};

function getConfig() {
	const app = qs("#app");
	const apiBaseFromData = app?.dataset.apiBase || "";
	const apiBase = String(window.ADMIN_API_BASE || apiBaseFromData || "").trim();
	const galleryJsonUrl = String(window.GALLERY_JSON_URL || app?.dataset.galleryJson || "./gallery.json").trim();
	return {
		apiBase,
		galleryJsonUrl,
	};
}

async function apiFetch(path, init = {}) {
	const base = state.config.apiBase;
	const url = base ? new URL(path, base).toString() : path;
	const res = await fetch(url, { credentials: "include", ...init });
	const data = await res.json().catch(() => null);
	if (!res.ok) {
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

function buildTagSearchList(tagsIndex) {
	const tags = Array.isArray(tagsIndex?.tags) ? tagsIndex.tags : [];
	const list = [];
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
		const tokens = [tag.name, ...tag.aliases].filter(Boolean).map(normalizeSearch);
		list.push({ tag, tokens });
	}
	return list;
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
	const tasks = [
		apiFetch("/admin/notion/schema").then((d) => (state.schema = d)),
		apiFetch("/participants-index").then((d) => (state.participantsIndex = d.data)),
		apiFetch("/students-index").then((d) => (state.studentsIndex = d.data)),
		apiFetch("/tags-index").then((d) => (state.tagsIndex = d.data)),
	];

	const results = await Promise.allSettled(tasks);
	const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason?.message).filter(Boolean);
	if (errors.length > 0) {
		setBanner(`一部データの取得に失敗しました：${errors.join(" / ")}`);
	}

	if (state.studentsIndex?.students) {
		for (const s of state.studentsIndex.students) {
			const displayName = String(s.display_name || "").trim();
			const studentId = String(s.student_id || "").trim();
			const notionIdRaw = String(s.notion_id || s.notionId || s.id || "").trim();
			const notionId = isNotionIdLike(notionIdRaw) ? notionIdRaw : isNotionIdLike(studentId) ? studentId : "";
			if (!displayName) continue;

			const record = { notionId, studentId, displayName };
			if (notionId) state.studentsByNotionId.set(notionId, record);
			if (studentId) state.studentsByStudentId.set(studentId, record);
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
		tab.addEventListener("click", () => activate(tab.dataset.tab));
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
		.map((p) => {
			const studentId = String(p.student_id || "").trim();
			const mapped = studentId ? state.studentsByStudentId.get(studentId) : null;
			const notionId = mapped?.notionId || (isNotionIdLike(studentId) ? studentId : "");
			const label = String(p.display_name || mapped?.displayName || studentId || "").trim();
			return notionId && label ? { id: notionId, label } : null;
		})
		.filter(Boolean);
}

function renderUploadPreviews() {
	const root = qs("#upload-previews");
	root.innerHTML = "";

	state.upload.files.forEach((file, idx) => {
		const url = file.previewUrl;
		const item = el("div", { class: `preview${idx === state.upload.coverIndex ? " is-cover" : ""}` });
		const img = el("img", { src: url, alt: "" });
		item.appendChild(img);
		if (idx === state.upload.coverIndex) item.appendChild(el("div", { class: "badge", text: "表紙" }));
		item.addEventListener("click", () => {
			state.upload.coverIndex = idx;
			renderUploadPreviews();
		});
		root.appendChild(item);
	});
}

function getExifDateTimeOriginalFromJpeg(arrayBuffer) {
	const view = new DataView(arrayBuffer);
	const getAscii = (offset, len) => {
		let out = "";
		for (let i = 0; i < len; i += 1) out += String.fromCharCode(view.getUint8(offset + i));
		return out;
	};

	if (view.byteLength < 4) return "";
	if (view.getUint16(0) !== 0xffd8) return "";

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

				if (readU16(tiffStart + 2) !== 42) return "";
				const ifd0Offset = readU32(tiffStart + 4);
				let ifdOffset = tiffStart + ifd0Offset;
				if (ifdOffset + 2 > view.byteLength) return "";
				const entries = readU16(ifdOffset);
				ifdOffset += 2;

				let exifIfdPtr = 0;
				for (let i = 0; i < entries; i += 1) {
					const entryOffset = ifdOffset + i * 12;
					const tag = readU16(entryOffset);
					if (tag === 0x8769) {
						exifIfdPtr = readU32(entryOffset + 8);
						break;
					}
				}
				if (!exifIfdPtr) return "";
				const exifIfdOffset = tiffStart + exifIfdPtr;
				if (exifIfdOffset + 2 > view.byteLength) return "";
				const exifEntries = readU16(exifIfdOffset);
				let exifBase = exifIfdOffset + 2;

				const readAsciiValue = (entryOffset) => {
					const type = readU16(entryOffset + 2);
					const count = readU32(entryOffset + 4);
					if (type !== 2 || count < 2) return "";
					const valueOffsetOrData = entryOffset + 8;
					const dataOffset = count <= 4 ? valueOffsetOrData : tiffStart + readU32(valueOffsetOrData);
					if (dataOffset + count > view.byteLength) return "";
					return getAscii(dataOffset, count - 1);
				};

				let dateTimeOriginal = "";
				for (let i = 0; i < exifEntries; i += 1) {
					const entryOffset = exifBase + i * 12;
					const tag = readU16(entryOffset);
					if (tag === 0x9003) {
						dateTimeOriginal = readAsciiValue(entryOffset);
						break;
					}
				}
				if (dateTimeOriginal) return dateTimeOriginal;

				for (let i = 0; i < exifEntries; i += 1) {
					const entryOffset = exifBase + i * 12;
					const tag = readU16(entryOffset);
					if (tag === 0x0132) {
						return readAsciiValue(entryOffset);
					}
				}
			}
		}

		offset += size;
	}
	return "";
}

async function inferCompletedDateFromFiles(files) {
	const note = qs("#upload-exif-note");
	if (!files || files.length === 0) return "";

	const first = files[0];
	try {
		const head = await first.slice(0, 256 * 1024).arrayBuffer();
		const exif = getExifDateTimeOriginalFromJpeg(head);
		if (exif) {
			const ymd = exif.slice(0, 10).replaceAll(":", "-");
			if (note) note.textContent = `EXIF DateTimeOriginal: ${exif}`;
			return ymd;
		}
	} catch {
		// noop
	}

	const fallback = first.lastModified ? new Date(first.lastModified) : null;
	if (fallback && !Number.isNaN(fallback.getTime())) {
		const ymd = fallback.toISOString().slice(0, 10);
		if (note) note.textContent = `EXIFなしのため lastModified から推定: ${ymd}`;
		return ymd;
	}

	if (note) note.textContent = "EXIFなし。日付を手入力してください。";
	return "";
}

function updateUploadGroupAndAuthorCandidates() {
	const dateInput = qs("#upload-completed-date");
	const ymd = String(dateInput.value || "").trim();

	const groupSelect = qs("#upload-group");
	const authorSelect = qs("#upload-author");

	const groups = ymd ? getParticipantsGroups(ymd) : [];
	populateSelect(groupSelect, {
		placeholder: "自動/手動",
		items: groups.map((g, idx) => ({
			value: String(idx),
			label: `${g.classroom || "-"} / ${g.venue || "-"}`,
		})),
	});

	let selectedGroup = null;
	if (groups.length === 1) selectedGroup = groups[0];
	if (groups.length > 1 && groupSelect.value) selectedGroup = groups[Number(groupSelect.value)] || null;

	const venueFromGroup = selectedGroup?.venue || "";
	const classroomFromGroup = selectedGroup?.classroom || "";

	const classroomSelect = qs("#upload-classroom");
	if (classroomFromGroup) classroomSelect.value = normalizeClassroom(classroomFromGroup);

	const venueSelect = qs("#upload-venue");
	const venueWarning = qs("#upload-venue-warning");
	if (venueFromGroup) {
		const options = Array.from(venueSelect.options).map((o) => o.value).filter(Boolean);
		if (options.includes(venueFromGroup)) {
			venueSelect.value = venueFromGroup;
			venueWarning.hidden = true;
			venueWarning.textContent = "";
		} else {
			venueSelect.value = "";
			venueWarning.hidden = false;
			venueWarning.textContent = `会場「${venueFromGroup}」はNotionのSelect候補に存在しないため保存しません。手動選択してください。`;
		}
	} else {
		venueWarning.hidden = true;
		venueWarning.textContent = "";
	}

	const participants = Array.isArray(selectedGroup?.participants) ? selectedGroup.participants : [];
	const options = participants
		.map((p) => {
			const studentId = String(p.student_id || "").trim();
			const mapped = studentId ? state.studentsByStudentId.get(studentId) : null;
			const value = mapped?.notionId || studentId;
			const label = String(p.display_name || mapped?.displayName || studentId || "").trim();
			return value && label ? { value, label } : null;
		})
		.filter(Boolean);

	authorSelect.innerHTML = "";
	authorSelect.appendChild(el("option", { value: "", text: "未選択" }));
	options.forEach((o) => authorSelect.appendChild(el("option", { value: o.value, text: o.label })));
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
		state.upload.files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
		state.upload.files = Array.from(filesInput.files || []).map((f) => ({
			file: f,
			previewUrl: URL.createObjectURL(f),
		}));
		state.upload.coverIndex = 0;
		renderUploadPreviews();

		const ymd = await inferCompletedDateFromFiles(state.upload.files.map((x) => x.file));
		const dateInput = qs("#upload-completed-date");
		if (ymd && !dateInput.value) dateInput.value = ymd;
		updateUploadGroupAndAuthorCandidates();
	});

	dateInput.addEventListener("change", () => updateUploadGroupAndAuthorCandidates());

	const groupSelect = qs("#upload-group");
	groupSelect.addEventListener("change", () => updateUploadGroupAndAuthorCandidates());

	initStudentSearch();
	initTagInput("upload");

	const readyCb = qs("#upload-ready");
	const syncReady = () => {
		if (state.upload.readyTouched) return;
		readyCb.checked = computeUploadReadyDefault();
	};
	readyCb.addEventListener("change", () => {
		state.upload.readyTouched = true;
	});
	qsa("#upload-title,#upload-author").forEach((elx) => elx.addEventListener("change", syncReady));

	const form = qs("#upload-form");
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		await submitUpload();
	});

	updateUploadGroupAndAuthorCandidates();
}

function initStudentSearch() {
	const input = qs("#upload-author-search");
	const resultsRoot = qs("#upload-author-search-results");
	const authorSelect = qs("#upload-author");

	const render = (items) => {
		resultsRoot.innerHTML = "";
		items.slice(0, 12).forEach((s) => {
			const item = el("div", { class: "suggest-item" }, [
				el("span", { text: s.displayName }),
				el("span", { class: "suggest-item__hint", text: s.studentId ? `(${s.studentId})` : "" }),
			]);
			item.addEventListener("click", () => {
				const value = s.notionId || s.studentId;
				if (!value) return;
				const existing = Array.from(authorSelect.options).some((o) => o.value === value);
				if (!existing) authorSelect.appendChild(el("option", { value, text: s.displayName }));
				authorSelect.value = value;
				resultsRoot.innerHTML = "";
				input.value = "";
			});
			resultsRoot.appendChild(item);
		});
	};

	const run = debounce(() => {
		(async () => {
			const raw = input.value.trim();
			const q = normalizeSearch(raw);
			if (!q) return render([]);

			const hits = [];
			const seen = new Set();
			for (const s of [...state.studentsByNotionId.values(), ...state.studentsByStudentId.values()]) {
				const keyId = s.notionId || s.studentId;
				if (!keyId || seen.has(keyId)) continue;
				seen.add(keyId);
				const key = normalizeSearch(s.displayName);
				if (key.includes(q)) hits.push(s);
			}

			if (hits.length < 8 && raw.length >= 2) {
				try {
					const remote = await apiFetch(`/admin/notion/search-students?q=${encodeURIComponent(raw)}`);
					for (const r of remote.results || []) {
						const notionId = String(r.id || "").trim();
						const displayName = String(r.name || "").trim();
						if (!notionId || !displayName || seen.has(notionId)) continue;
						seen.add(notionId);
						hits.push({ notionId, studentId: "", displayName });
					}
				} catch {
					// noop
				}
			}

			render(hits);
		})().catch(() => {});
	}, 200);

	input.addEventListener("input", run);
}

function initTagInput(prefix) {
	const queryEl = qs(`#${prefix}-tag-query`);
	const suggestRoot = qs(`#${prefix}-tag-suggest`);
	const chipsRoot = qs(`#${prefix}-tag-chips`);
	const derivedNote = qs(`#${prefix}-tag-derived-note`);
	const childSuggestRoot = qs(`#${prefix}-tag-children`);

	const setState = (explicitIds) => {
		state.upload.explicitTagIds = explicitIds;
		const derivedIds = computeDerivedParentTagIds(explicitIds);
		renderChips(chipsRoot, {
			explicitIds,
			derivedIds,
			onRemove: (id) => {
				setState(explicitIds.filter((x) => x !== id));
			},
		});
		derivedNote.textContent = derivedIds.length > 0 ? `自動付与（親タグ）: ${derivedIds.length}件` : "";
		renderChildSuggest(childSuggestRoot, { explicitIds, derivedIds, onAdd: (id) => setState(Array.from(new Set([...explicitIds, id]))) });
		if (!state.upload.readyTouched) {
			const readyCb = qs("#upload-ready");
			if (readyCb) readyCb.checked = computeUploadReadyDefault();
		}
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
			if (state.tagsSearch.length === 0) {
				suggestRoot.appendChild(
					el("div", { class: "suggest-item" }, [
						el("span", { text: "タグインデックス未取得" }),
						el("span", { class: "suggest-item__hint", text: "新規作成は抑止しています" }),
					]),
				);
				return;
			}

			const exact = list.some((t) => t.name === q);
			if (!exact) {
				const create = el("div", { class: "suggest-item" }, [
					el("span", { text: `「${q}」を新規作成` }),
					el("span", { class: "suggest-item__hint", text: "タグDBに追加" }),
				]);
				create.addEventListener("click", async () => {
					try {
						const created = await apiFetch("/admin/notion/tag", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ name: q }),
						});
						showToast("タグを作成しました");
						const id = created?.id;
						if (id) {
							state.tagsById.set(id, { id, name: q, aliases: [], status: "active", merge_to: "", parents: [], children: [], usage_count: 0 });
							const next = Array.from(new Set([...state.upload.explicitTagIds, id]));
							setState(next);
						}
						queryEl.value = "";
						suggestRoot.innerHTML = "";
					} catch (err) {
						showToast(`タグ作成に失敗: ${err.message}`);
					}
				});
				suggestRoot.appendChild(create);
			}
		}
	};

	queryEl.addEventListener(
		"input",
		debounce(() => renderSuggest(queryEl.value), 120),
	);

	document.addEventListener("click", () => {
		suggestRoot.innerHTML = "";
	});

	setState([]);
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
	const title = qs("#upload-title").value.trim();
	const author = qs("#upload-author").value.trim();
	const tags = state.upload.explicitTagIds || [];
	return Boolean(title && author && tags.length > 0);
}

async function submitUpload() {
	const status = qs("#upload-status");
	const submit = qs("#upload-submit");
	const readyCb = qs("#upload-ready");

	const files = state.upload.files.map((x) => x.file);
	if (files.length === 0) return showToast("画像を選択してください");

	const completedDate = qs("#upload-completed-date").value.trim();
	if (!completedDate) return showToast("完成日を入力してください");

	const classroom = normalizeClassroom(qs("#upload-classroom").value);
	if (!classroom) return showToast("教室を選択してください");

	const venue = qs("#upload-venue").value || "";

	const authorId = qs("#upload-author").value.trim();
	if (authorId && !isNotionIdLike(authorId)) {
		return showToast("作者IDがNotion page idではありません。students_index.jsonに notion_id を含めるか、Notion検索で選択してください。");
	}

	const title = qs("#upload-title").value.trim();
	const caption = qs("#upload-caption").value.trim();

	const explicitIds = state.upload.explicitTagIds;
	const derivedIds = computeDerivedParentTagIds(explicitIds);
	const tagIds = Array.from(new Set([...explicitIds, ...derivedIds]));

	const ready = readyCb.checked;

	status.textContent = "アップロード準備中…";
	submit.disabled = true;

	const ordered = [...state.upload.files];
	const [cover] = ordered.splice(state.upload.coverIndex, 1);
	ordered.unshift(cover);

	try {
		const form = new FormData();
		ordered.forEach((x) => form.append("files", x.file));
		form.append("prefix", `uploads/${completedDate}`);
		const uploaded = await apiFetch("/admin/r2/upload", { method: "POST", body: form });
		const filesOut = uploaded?.files || [];
		status.textContent = `R2保存OK（${filesOut.length}枚）。Notion作成中…`;

		const createPayload = {
			title,
			completedDate,
			classroom,
			venue,
			authorId,
			caption,
			tagIds,
			ready,
			images: filesOut.map((f) => ({ url: f.url, name: f.name })),
		};

		const tryCreate = async () =>
			apiFetch("/admin/notion/work", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(createPayload),
			});

		let created;
		try {
			created = await tryCreate();
		} catch (err) {
			console.error(err);
			const retry = confirm("R2保存は成功しています。Notion作成を再試行しますか？（OK=再試行 / キャンセル=R2削除）");
			if (retry) {
				status.textContent = "Notion作成を再試行中…";
				created = await tryCreate();
			} else {
				const keys = filesOut.map((f) => f.key).filter(Boolean);
				if (keys.length) {
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

		status.textContent = `完了（Notion: ${created.id}）`;
		showToast("登録しました");
		return;
	} catch (err) {
		console.error(err);
		status.textContent = `失敗: ${err.message}`;
		showToast(`失敗: ${err.message}`);
	} finally {
		submit.disabled = false;
	}
}

function applyCurationFilters() {
	const from = qs("#curation-from").value;
	const to = qs("#curation-to").value;
	const classroom = qs("#curation-classroom").value;

	const missingTitle = qs("#curation-missing-title").checked;
	const missingAuthor = qs("#curation-missing-author").checked;
	const missingTags = qs("#curation-missing-tags").checked;

	const filtered = state.curation.works.filter((w) => {
		if (!isSameDayOrAfter(w.completedDate, from)) return false;
		if (!isSameDayOrBefore(w.completedDate, to)) return false;
		if (classroom && w.classroom !== classroom) return false;
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
			el("span", { text: work.classroom || "-" }),
		]),
	);
	card.appendChild(meta);

	card.addEventListener("click", () => openWorkModal(index));
	return card;
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
		const data = await apiFetch("/admin/notion/works?unprepared=1");
		state.curation.works = data.results || [];
		state.curation.filtered = [...state.curation.works];

		const classroomSelect = qs("#curation-classroom");
		const classrooms = Array.from(new Set(state.curation.works.map((w) => w.classroom).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja"));
		populateSelect(classroomSelect, { placeholder: "すべて", items: classrooms.map((v) => ({ value: v })) });

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

	const authorSelect = el("select", { class: "input" });
	authorSelect.appendChild(el("option", { value: "", text: "未選択" }));
	for (const s of state.studentsByNotionId.values()) {
		authorSelect.appendChild(el("option", { value: s.notionId, text: s.displayName }));
	}
	authorSelect.value = work.authorIds?.[0] || "";

	const authorCandidates = getAuthorCandidatesForWork(work);
	const authorCandidateChips = el("div", { class: "chips" });
	if (authorCandidates.length > 0) {
		authorCandidates.forEach((c) => {
			const chip = el("span", { class: "chip" });
			chip.appendChild(el("span", { text: c.label }));
			chip.addEventListener("click", () => {
				authorSelect.value = c.id;
				showToast(`作者候補を選択: ${c.label}`);
			});
			authorCandidateChips.appendChild(chip);
		});
	} else {
		authorCandidateChips.appendChild(el("div", { class: "subnote", text: "当日参加者候補なし（名簿から選択してください）" }));
	}

	const tagQuery = el("input", { class: "input", type: "text", placeholder: "タグ検索", autocomplete: "off" });
	const tagSuggest = el("div", { class: "suggest" });
	const tagChips = el("div", { class: "chips" });
	const derivedNote = el("div", { class: "subnote" });
	const childSuggest = el("div", { class: "chips" });
	let explicitTagIds = Array.isArray(work.tagIds) ? [...work.tagIds] : [];

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
	};
	renderTags();

	const renderTagSuggest = debounce(() => {
		const q = tagQuery.value;
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
	}, 120);
	tagQuery.addEventListener("input", renderTagSuggest);

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

	const info = el("div", {}, [
		el("div", { class: "form-row" }, [el("label", { class: "label", text: "作品名" }), titleControls]),
		el("div", { class: "form-row" }, [el("label", { class: "label", text: "作者" }), authorSelect, authorCandidateChips]),
		el("div", { class: "form-row" }, [el("label", { class: "label", text: "タグ" }), tagQuery, tagSuggest, tagChips, derivedNote, childSuggest]),
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
			authorId: authorSelect.value || "",
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

			if (payload.ready) {
				state.curation.works = state.curation.works.filter((w) => w.id !== work.id);
			} else {
				const idxAll = state.curation.works.findIndex((w) => w.id === work.id);
				if (idxAll >= 0) state.curation.works[idxAll] = { ...work, ...payload, authorIds: payload.authorId ? [payload.authorId] : [], tagIds, ready: payload.ready };
			}

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
	qsa("#curation-from,#curation-to,#curation-classroom,#curation-missing-title,#curation-missing-author,#curation-missing-tags").forEach((elx) => {
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
