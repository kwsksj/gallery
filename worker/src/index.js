const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function withCors(headers = {}) {
  return { ...CORS_HEADERS, ...headers };
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: withCors({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    }),
  });
}

function errorResponse(status, message) {
  return jsonResponse({ error: message }, status);
}

function okResponse(data, status = 200) {
  return jsonResponse({ ok: true, ...data }, status);
}

function badRequest(message) {
  return jsonResponse({ ok: false, error: message }, 400);
}

function serverError(message) {
  return jsonResponse({ ok: false, error: message }, 500);
}

function parseIds(url) {
  const raw = url.searchParams.get("ids") || "";
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

async function handleGetStars(url, env) {
  if (!env.STAR_KV) return errorResponse(500, "KV binding not configured");
  const ids = parseIds(url);
  if (ids.length === 0) return jsonResponse({ stars: {} });

  const entries = await Promise.all(
    ids.map(async (id) => {
      const raw = await env.STAR_KV.get(`star:${id}`);
      return [id, normalizeCount(raw)];
    })
  );

  return jsonResponse({ stars: Object.fromEntries(entries) });
}

async function handlePostStar(request, env) {
  if (!env.STAR_KV) return errorResponse(500, "KV binding not configured");
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return errorResponse(400, "invalid json");
  }

  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return errorResponse(400, "invalid id");

  const delta = Number.isFinite(Number(body?.delta)) ? Number(body.delta) : 1;
  const key = `star:${id}`;

  const currentRaw = await env.STAR_KV.get(key);
  const current = normalizeCount(currentRaw);
  const next = normalizeCount(current + delta);

  await env.STAR_KV.put(key, String(next));
  return jsonResponse({ id, stars: next });
}

function getEnvString(env, key, fallback = "") {
  const value = env?.[key];
  if (typeof value !== "string") return fallback;
  return value.trim();
}

function getBearerToken(request) {
  const raw = asString(request.headers.get("Authorization")).trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? asString(match[1]).trim() : "";
}

function getWorksProps(env) {
  return {
    title: getEnvString(env, "NOTION_WORKS_TITLE_PROP", "作品名"),
    images: getEnvString(env, "NOTION_WORKS_IMAGES_PROP", "画像"),
    completedDate: getEnvString(env, "NOTION_WORKS_COMPLETED_DATE_PROP", "完成日"),
    classroom: getEnvString(env, "NOTION_WORKS_CLASSROOM_PROP", "教室"),
    venue: getEnvString(env, "NOTION_WORKS_VENUE_PROP", "会場"),
    author: getEnvString(env, "NOTION_WORKS_AUTHOR_PROP", "作者"),
    caption: getEnvString(env, "NOTION_WORKS_CAPTION_PROP", "キャプション"),
    tags: getEnvString(env, "NOTION_WORKS_TAGS_PROP", "タグ"),
    ready: getEnvString(env, "NOTION_WORKS_READY_PROP", "整備済"),
  };
}

function getTagsProps(env) {
  return {
    title: getEnvString(env, "NOTION_TAGS_TITLE_PROP", "タグ"),
    status: getEnvString(env, "NOTION_TAGS_STATUS_PROP", "状態"),
  };
}

function findFirstDatabasePropertyNameByType(database, type) {
  const props = database?.properties || {};
  for (const [name, prop] of Object.entries(props)) {
    if (prop?.type === type) return name;
  }
  return "";
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeYmd(value) {
  const raw = asString(value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return "";
}

function buildNotionHeaders(env) {
  const token = getEnvString(env, "NOTION_TOKEN");
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };
}

async function notionFetch(env, path, init) {
  const headers = buildNotionHeaders(env);
  if (!headers) return { ok: false, status: 500, data: { error: "NOTION_TOKEN not configured" } };

  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers || {}),
    },
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function getNotionFileUrl(file) {
  if (!file || typeof file !== "object") return "";
  if (file.type === "external") return asString(file.external?.url);
  if (file.type === "file") return asString(file.file?.url);
  return "";
}

function simplifyNotionFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .map((f) => ({
      name: asString(f?.name),
      type: asString(f?.type),
      url: getNotionFileUrl(f),
    }))
    .filter((f) => f.url);
}

function notionTitle(content) {
  return {
    title: [
      {
        type: "text",
        text: { content: asString(content) },
      },
    ],
  };
}

function notionRichText(content) {
  const text = asString(content);
  if (!text) return { rich_text: [] };
  return {
    rich_text: [
      {
        type: "text",
        text: { content: text },
      },
    ],
  };
}

function notionSelect(value) {
  const name = asString(value).trim();
  if (!name) return { select: null };
  return { select: { name } };
}

function notionDate(ymd) {
  const date = normalizeYmd(ymd);
  if (!date) return { date: null };
  return { date: { start: date } };
}

function notionCheckbox(value) {
  return { checkbox: Boolean(value) };
}

function notionRelation(ids) {
  if (!Array.isArray(ids)) return { relation: [] };
  const relation = ids
    .filter((id) => typeof id === "string" && id.trim())
    .map((id) => ({ id: id.trim() }));
  return { relation };
}

function notionExternalFiles(files) {
  if (!Array.isArray(files)) return { files: [] };
  const notionFiles = files
    .map((f) => {
      if (!f || typeof f !== "object") return null;
      const url = asString(f.url).trim();
      if (!url) return null;
      const name = asString(f.name).trim() || url.split("/").pop() || "image";
      const type = asString(f.type).trim();
      if (type === "file") {
        return { name, type: "file", file: { url } };
      }
      return { name, type: "external", external: { url } };
    })
    .filter(Boolean);
  return { files: notionFiles };
}

function pickWorkProperties(env, payload) {
  const worksProps = getWorksProps(env);
  const props = {};

  if ("title" in payload && worksProps.title) props[worksProps.title] = notionTitle(payload.title);
  if ("completedDate" in payload && worksProps.completedDate) props[worksProps.completedDate] = notionDate(payload.completedDate);
  if ("classroom" in payload && worksProps.classroom) props[worksProps.classroom] = notionSelect(payload.classroom);
  if ("venue" in payload && worksProps.venue) props[worksProps.venue] = notionSelect(payload.venue);
  if ("caption" in payload && worksProps.caption) props[worksProps.caption] = notionRichText(payload.caption);
  if ("ready" in payload && worksProps.ready) props[worksProps.ready] = notionCheckbox(payload.ready);

  if ("authorId" in payload && worksProps.author)
    props[worksProps.author] = notionRelation(payload.authorId ? [payload.authorId] : []);
  if ("tagIds" in payload && worksProps.tags)
    props[worksProps.tags] = notionRelation(Array.isArray(payload.tagIds) ? payload.tagIds : []);
  if ("images" in payload && worksProps.images) props[worksProps.images] = notionExternalFiles(payload.images);

  return props;
}

function simplifyWorkFromNotionPage(env, page) {
  const worksProps = getWorksProps(env);
  const props = page?.properties || {};
  const titleParts = (worksProps.title ? props[worksProps.title]?.title : null) || [];
  const title = titleParts.map((t) => asString(t?.plain_text)).join("");

  const completedDate = worksProps.completedDate ? asString(props[worksProps.completedDate]?.date?.start) : "";
  const classroom = worksProps.classroom ? asString(props[worksProps.classroom]?.select?.name) : "";
  const venue = worksProps.venue ? asString(props[worksProps.venue]?.select?.name) : "";

  const authorRelation = worksProps.author ? props[worksProps.author]?.relation : null;
  const authorIds = Array.isArray(authorRelation)
    ? authorRelation.map((r) => asString(r?.id)).filter(Boolean)
    : [];
  const tagsRelation = worksProps.tags ? props[worksProps.tags]?.relation : null;
  const tagIds = Array.isArray(tagsRelation)
    ? tagsRelation.map((r) => asString(r?.id)).filter(Boolean)
    : [];

  const captionParts = (worksProps.caption ? props[worksProps.caption]?.rich_text : null) || [];
  const caption = captionParts.map((t) => asString(t?.plain_text)).join("");

  const ready = worksProps.ready ? Boolean(props[worksProps.ready]?.checkbox) : false;
  const imagesRaw = (worksProps.images ? props[worksProps.images]?.files : null) || [];
  const images = simplifyNotionFiles(imagesRaw);

  return {
    id: asString(page?.id),
    title,
    completedDate,
    classroom,
    venue,
    authorIds,
    tagIds,
    caption,
    ready,
    images,
  };
}

async function handleNotionSchema(env) {
  const worksDbId = getEnvString(env, "NOTION_WORKS_DB_ID");
  if (!worksDbId) return serverError("NOTION_WORKS_DB_ID not configured");

  const res = await notionFetch(env, `/databases/${worksDbId}`, { method: "GET" });
  if (!res.ok) {
    return jsonResponse({ ok: false, error: "failed to fetch notion database", detail: res.data }, 500);
  }

  const properties = res.data?.properties || {};
  const worksProps = getWorksProps(env);
  const classroomOptions = worksProps.classroom
    ? (properties[worksProps.classroom]?.select?.options || []).map((o) => asString(o?.name)).filter(Boolean)
    : [];
  const venueOptions = worksProps.venue
    ? (properties[worksProps.venue]?.select?.options || []).map((o) => asString(o?.name)).filter(Boolean)
    : [];

  return okResponse({ classroomOptions, venueOptions });
}

async function handleNotionListWorks(url, env) {
  const worksDbId = getEnvString(env, "NOTION_WORKS_DB_ID");
  if (!worksDbId) return serverError("NOTION_WORKS_DB_ID not configured");

  const worksProps = getWorksProps(env);
  const unprepared = url.searchParams.get("unprepared") === "1";
  const query = asString(url.searchParams.get("q")).trim();
  const cursor = asString(url.searchParams.get("cursor")).trim();

  const body = { page_size: 100 };
  if (worksProps.completedDate) {
    body.sorts = [{ property: worksProps.completedDate, direction: "descending" }];
  }

  const filters = [];
  if (unprepared) {
    if (worksProps.ready) filters.push({ property: worksProps.ready, checkbox: { equals: false } });
  }
  if (query) {
    if (worksProps.title) filters.push({ property: worksProps.title, title: { contains: query } });
  }

  if (filters.length === 1) body.filter = filters[0];
  if (filters.length > 1) body.filter = { and: filters };
  if (cursor) body.start_cursor = cursor;

  const res = await notionFetch(env, `/databases/${worksDbId}/query`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return jsonResponse({ ok: false, error: "failed to query notion database", detail: res.data }, 500);
  }

  const results = Array.isArray(res.data?.results) ? res.data.results.map((page) => simplifyWorkFromNotionPage(env, page)) : [];
  return okResponse({
    results,
    nextCursor: res.data?.has_more ? asString(res.data?.next_cursor) : "",
  });
}

async function handleNotionSearchStudents(url, env) {
  const worksDbId = getEnvString(env, "NOTION_WORKS_DB_ID");
  if (!worksDbId) return serverError("NOTION_WORKS_DB_ID not configured");

  const q = asString(url.searchParams.get("q")).trim();
  if (!q) return badRequest("missing q");

  let studentsDbId = getEnvString(env, "NOTION_STUDENTS_DB_ID");
  if (!studentsDbId) {
    const worksProps = getWorksProps(env);
    if (!worksProps.author) return serverError("NOTION_WORKS_AUTHOR_PROP not configured");
    const worksDbRes = await notionFetch(env, `/databases/${worksDbId}`, { method: "GET" });
    if (!worksDbRes.ok) return jsonResponse({ ok: false, error: "failed to fetch works database", detail: worksDbRes.data }, 500);
    const rel = worksDbRes.data?.properties?.[worksProps.author]?.relation;
    studentsDbId = asString(rel?.database_id);
  }

  if (!studentsDbId) return serverError("students database id not found");

  const studentsDbRes = await notionFetch(env, `/databases/${studentsDbId}`, { method: "GET" });
  if (!studentsDbRes.ok) return jsonResponse({ ok: false, error: "failed to fetch students database", detail: studentsDbRes.data }, 500);

  const titleProp = findFirstDatabasePropertyNameByType(studentsDbRes.data, "title");
  if (!titleProp) return serverError("students title property not found");

  const queryRes = await notionFetch(env, `/databases/${studentsDbId}/query`, {
    method: "POST",
    body: JSON.stringify({
      page_size: 20,
      filter: {
        property: titleProp,
        title: { contains: q },
      },
      sorts: [{ property: titleProp, direction: "ascending" }],
    }),
  });

  if (!queryRes.ok) return jsonResponse({ ok: false, error: "failed to query students database", detail: queryRes.data }, 500);

  const results = Array.isArray(queryRes.data?.results)
    ? queryRes.data.results.map((page) => {
        const id = asString(page?.id);
        const parts = page?.properties?.[titleProp]?.title || [];
        const name = parts.map((t) => asString(t?.plain_text)).join("");
        return id && name ? { id, name } : null;
      }).filter(Boolean)
    : [];

  return okResponse({ results });
}

async function handleNotionCreateWork(request, env) {
  const worksDbId = getEnvString(env, "NOTION_WORKS_DB_ID");
  if (!worksDbId) return serverError("NOTION_WORKS_DB_ID not configured");

  const payload = await readJson(request);
  if (!payload || typeof payload !== "object") return badRequest("invalid json");

  const worksProps = getWorksProps(env);
  const props = pickWorkProperties(env, payload);
  if (worksProps.title && !(worksProps.title in props)) props[worksProps.title] = notionTitle(payload.title || "");

  const res = await notionFetch(env, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: worksDbId },
      properties: props,
    }),
  });

  if (!res.ok) {
    return jsonResponse({ ok: false, error: "failed to create notion page", detail: res.data }, 500);
  }

  return okResponse({ id: asString(res.data?.id) }, 201);
}

async function handleNotionUpdateWork(request, env) {
  const payload = await readJson(request);
  if (!payload || typeof payload !== "object") return badRequest("invalid json");
  const id = asString(payload.id).trim();
  if (!id) return badRequest("missing id");

  const props = pickWorkProperties(env, payload);
  const body = {};
  if (Object.keys(props).length > 0) body.properties = props;

  if ("archived" in payload) body.archived = Boolean(payload.archived);

  if (Object.keys(body).length === 0) return badRequest("no updates");

  const res = await notionFetch(env, `/pages/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return jsonResponse({ ok: false, error: "failed to update notion page", detail: res.data }, 500);
  }

  return okResponse({ id });
}

async function handleNotionCreateTag(request, env) {
  const tagsDbId = getEnvString(env, "NOTION_TAGS_DB_ID");
  if (!tagsDbId) return serverError("NOTION_TAGS_DB_ID not configured");

  const payload = await readJson(request);
  if (!payload || typeof payload !== "object") return badRequest("invalid json");
  const name = asString(payload.name).trim();
  if (!name) return badRequest("missing name");

  const tagsProps = getTagsProps(env);
  const properties = {};
  properties[tagsProps.title || "タグ"] = notionTitle(name);
  if (tagsProps.status) properties[tagsProps.status] = notionSelect("active");

  const res = await notionFetch(env, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: tagsDbId },
      properties,
    }),
  });

  if (!res.ok) {
    return jsonResponse({ ok: false, error: "failed to create notion tag", detail: res.data }, 500);
  }

  return okResponse({ id: asString(res.data?.id), name }, 201);
}

async function handleR2Upload(request, env) {
  if (!env.GALLERY_R2) return serverError("R2 binding not configured (GALLERY_R2)");
  const baseUrl = getEnvString(env, "R2_PUBLIC_BASE_URL");
  if (!baseUrl) return serverError("R2_PUBLIC_BASE_URL not configured");

  let form;
  try {
    form = await request.formData();
  } catch {
    return badRequest("invalid form-data");
  }

  const files = form.getAll("files");
  if (!files || files.length === 0) return badRequest("no files");

  const prefix = asString(form.get("prefix")).trim() || "uploads";

  const results = [];
  for (const f of files) {
    if (!(f instanceof File)) continue;
    const contentType = asString(f.type) || "application/octet-stream";
    const extFromName = (() => {
      const name = asString(f.name);
      const idx = name.lastIndexOf(".");
      if (idx === -1) return "";
      return name.slice(idx).toLowerCase();
    })();
    const ext = extFromName || (contentType === "image/jpeg" ? ".jpg" : contentType === "image/png" ? ".png" : "");
    const key = `${prefix}/${crypto.randomUUID()}${ext}`;

    await env.GALLERY_R2.put(key, f.stream(), {
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

    const url = `${baseUrl.replace(/\/$/, "")}/${key}`;
    results.push({ key, url, name: asString(f.name) || key.split("/").pop(), type: contentType });
  }

  return okResponse({ files: results });
}

async function handleR2Delete(request, env) {
  if (!env.GALLERY_R2) return serverError("R2 binding not configured (GALLERY_R2)");
  const payload = await readJson(request);
  if (!payload || typeof payload !== "object") return badRequest("invalid json");
  const keys = Array.isArray(payload.keys) ? payload.keys.map((k) => asString(k).trim()).filter(Boolean) : [];
  if (keys.length === 0) return badRequest("no keys");

  await Promise.all(keys.map((k) => env.GALLERY_R2.delete(k)));
  return okResponse({ deleted: keys.length });
}

async function fetchWorkPage(env, workId) {
  const res = await notionFetch(env, `/pages/${workId}`, { method: "GET" });
  if (!res.ok) return null;
  return res.data;
}

async function handleImageSplit(request, env) {
  const worksDbId = getEnvString(env, "NOTION_WORKS_DB_ID");
  if (!worksDbId) return serverError("NOTION_WORKS_DB_ID not configured");
  const worksProps = getWorksProps(env);

  const payload = await readJson(request);
  if (!payload || typeof payload !== "object") return badRequest("invalid json");

  const sourceWorkId = asString(payload.sourceWorkId).trim();
  const imageUrls = Array.isArray(payload.imageUrls) ? payload.imageUrls.map((u) => asString(u).trim()).filter(Boolean) : [];
  if (!sourceWorkId || imageUrls.length === 0) return badRequest("missing params");

  const sourcePage = await fetchWorkPage(env, sourceWorkId);
  if (!sourcePage) return jsonResponse({ ok: false, error: "source work not found" }, 404);

  const source = simplifyWorkFromNotionPage(env, sourcePage);
  const selected = source.images.filter((img) => imageUrls.includes(img.url));
  if (selected.length === 0) return badRequest("no matching images");
  const remaining = source.images.filter((img) => !imageUrls.includes(img.url));

  const createPayload = {
    title: source.title,
    completedDate: source.completedDate,
    classroom: source.classroom,
    venue: source.venue,
    authorId: source.authorIds[0] || "",
    tagIds: source.tagIds,
    caption: source.caption,
    ready: false,
    images: selected,
  };

  const createRes = await notionFetch(env, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: worksDbId },
      properties: pickWorkProperties(env, createPayload),
    }),
  });
  if (!createRes.ok) {
    return jsonResponse({ ok: false, error: "failed to create split work", detail: createRes.data }, 500);
  }

  const updateRes = await notionFetch(env, `/pages/${sourceWorkId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [worksProps.images || "画像"]: notionExternalFiles(remaining),
      },
    }),
  });
  if (!updateRes.ok) {
    return jsonResponse(
      { ok: false, error: "split created but failed to update source images", newWorkId: asString(createRes.data?.id), detail: updateRes.data },
      500,
    );
  }

  return okResponse({ newWorkId: asString(createRes.data?.id), remainingCount: remaining.length });
}

async function handleImageMove(request, env) {
  const worksProps = getWorksProps(env);

  const payload = await readJson(request);
  if (!payload || typeof payload !== "object") return badRequest("invalid json");

  const sourceWorkId = asString(payload.sourceWorkId).trim();
  const targetWorkId = asString(payload.targetWorkId).trim();
  const imageUrls = Array.isArray(payload.imageUrls) ? payload.imageUrls.map((u) => asString(u).trim()).filter(Boolean) : [];
  const archiveSourceIfEmpty = payload.archiveSourceIfEmpty !== false;

  if (!sourceWorkId || !targetWorkId || imageUrls.length === 0) return badRequest("missing params");

  const [sourcePage, targetPage] = await Promise.all([fetchWorkPage(env, sourceWorkId), fetchWorkPage(env, targetWorkId)]);
  if (!sourcePage) return jsonResponse({ ok: false, error: "source work not found" }, 404);
  if (!targetPage) return jsonResponse({ ok: false, error: "target work not found" }, 404);

  const source = simplifyWorkFromNotionPage(env, sourcePage);
  const target = simplifyWorkFromNotionPage(env, targetPage);

  const moving = source.images.filter((img) => imageUrls.includes(img.url));
  if (moving.length === 0) return badRequest("no matching images");

  const remaining = source.images.filter((img) => !imageUrls.includes(img.url));
  const nextTargetImages = [...target.images, ...moving];

  const updateTarget = notionFetch(env, `/pages/${targetWorkId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [worksProps.images || "画像"]: notionExternalFiles(nextTargetImages),
      },
    }),
  });

  const updateSource = notionFetch(env, `/pages/${sourceWorkId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [worksProps.images || "画像"]: notionExternalFiles(remaining),
      },
    }),
  });

  const [targetRes, sourceRes] = await Promise.all([updateTarget, updateSource]);
  if (!targetRes.ok || !sourceRes.ok) {
    return jsonResponse(
      { ok: false, error: "failed to move images", detail: { target: targetRes.data, source: sourceRes.data } },
      500,
    );
  }

  if (archiveSourceIfEmpty && remaining.length === 0) {
    await notionFetch(env, `/pages/${sourceWorkId}`, {
      method: "PATCH",
      body: JSON.stringify({ archived: true }),
    });
  }

  return okResponse({ moved: moving.length, sourceRemaining: remaining.length });
}

async function handleImageMerge(request, env) {
  const worksProps = getWorksProps(env);

  const payload = await readJson(request);
  if (!payload || typeof payload !== "object") return badRequest("invalid json");

  const targetWorkId = asString(payload.targetWorkId).trim();
  const sourceWorkIds = Array.isArray(payload.sourceWorkIds)
    ? payload.sourceWorkIds.map((id) => asString(id).trim()).filter(Boolean)
    : [];
  const archiveSources = payload.archiveSources !== false;

  if (!targetWorkId || sourceWorkIds.length === 0) return badRequest("missing params");

  const targetPage = await fetchWorkPage(env, targetWorkId);
  if (!targetPage) return jsonResponse({ ok: false, error: "target work not found" }, 404);
  const target = simplifyWorkFromNotionPage(env, targetPage);

  const sourcePages = await Promise.all(sourceWorkIds.map((id) => fetchWorkPage(env, id)));
  const sources = sourcePages
    .map((p, idx) => (p ? { id: sourceWorkIds[idx], work: simplifyWorkFromNotionPage(env, p) } : null))
    .filter(Boolean);
  if (sources.length === 0) return badRequest("no valid sources");

  const nextImages = [...target.images];
  const seen = new Set(nextImages.map((img) => img.url));
  for (const { work } of sources) {
    for (const img of work.images) {
      if (seen.has(img.url)) continue;
      seen.add(img.url);
      nextImages.push(img);
    }
  }

  const updateRes = await notionFetch(env, `/pages/${targetWorkId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [worksProps.images || "画像"]: notionExternalFiles(nextImages),
      },
    }),
  });

  if (!updateRes.ok) {
    return jsonResponse({ ok: false, error: "failed to update target images", detail: updateRes.data }, 500);
  }

  if (archiveSources) {
    await Promise.all(
      sources.map(({ id }) =>
        notionFetch(env, `/pages/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ archived: true }),
        }),
      ),
    );
  }

  return okResponse({ mergedSources: sources.length, targetImageCount: nextImages.length });
}

async function handleTriggerGalleryUpdate(request, env) {
  const repo = getEnvString(env, "GITHUB_REPO");
  const token = getEnvString(env, "GITHUB_TOKEN");
  const workflowFile = getEnvString(env, "GITHUB_WORKFLOW_FILE", "gallery-export.yml");
  const ref = getEnvString(env, "GITHUB_REF", "main");

  if (!repo || !token) return serverError("GitHub env not configured (GITHUB_REPO, GITHUB_TOKEN)");

  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "gallery-admin",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref }),
  });

  if (response.status === 204) {
    return okResponse({ message: "workflow triggered" });
  }

  const text = await response.text().catch(() => "");
  return jsonResponse({ ok: false, error: `GitHub API error: ${text}` }, 500);
}

async function handleTriggerTagsIndexUpdate(request, env) {
  const repo = getEnvString(env, "GITHUB_REPO");
  const token = getEnvString(env, "GITHUB_TOKEN");
  const workflowFile = getEnvString(env, "GITHUB_TAGS_WORKFLOW_FILE", "");
  const ref = getEnvString(env, "GITHUB_REF", "main");

  if (!repo || !token) return serverError("GitHub env not configured (GITHUB_REPO, GITHUB_TOKEN)");
  if (!workflowFile) return serverError("GITHUB_TAGS_WORKFLOW_FILE not configured");

  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "gallery-admin",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref }),
  });

  if (response.status === 204) {
    return okResponse({ message: "workflow triggered" });
  }

  const text = await response.text().catch(() => "");
  return jsonResponse({ ok: false, error: `GitHub API error: ${text}` }, 500);
}

async function handleProxyJson(env, urlVarName, r2KeyVarName, defaultKey) {
  const url = getEnvString(env, urlVarName);
  if (url) {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return jsonResponse({ ok: false, error: "failed to fetch upstream json" }, 502);
    const data = await res.json().catch(() => null);
    if (!data) return jsonResponse({ ok: false, error: "invalid upstream json" }, 502);
    return okResponse({ data });
  }

  if (!env.GALLERY_R2) return serverError("R2 binding not configured (GALLERY_R2)");
  const key = getEnvString(env, r2KeyVarName, defaultKey);
  const obj = await env.GALLERY_R2.get(key);
  if (!obj) return jsonResponse({ ok: false, error: "not found" }, 404);
  const text = await obj.text();
  try {
    const data = JSON.parse(text);
    return okResponse({ data });
  } catch {
    return jsonResponse({ ok: false, error: "invalid json in r2" }, 502);
  }
}

async function handleParticipantsIndexPush(request, env) {
  if (!env.GALLERY_R2) return serverError("R2 binding not configured (GALLERY_R2)");

  const expectedToken =
    getEnvString(env, "UPLOAD_UI_PARTICIPANTS_INDEX_PUSH_TOKEN") ||
    getEnvString(env, "PARTICIPANTS_INDEX_PUSH_TOKEN");
  if (!expectedToken) {
    return serverError("UPLOAD_UI_PARTICIPANTS_INDEX_PUSH_TOKEN not configured");
  }

  const actualToken = getBearerToken(request);
  if (!actualToken || actualToken !== expectedToken) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const payload = await readJson(request);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return badRequest("invalid json");
  }

  const key = getEnvString(env, "PARTICIPANTS_INDEX_KEY", "participants_index.json");
  const json = JSON.stringify(payload);
  await env.GALLERY_R2.put(key, json, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      cacheControl: "max-age=300",
    },
  });

  return okResponse({
    key,
    bytes: new TextEncoder().encode(json).length,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: withCors() });
    }

    if (pathname === "/stars" && request.method === "GET") {
      return handleGetStars(url, env);
    }

    if (pathname === "/star" && request.method === "POST") {
      return handlePostStar(request, env);
    }

    if (pathname === "/participants-index" && request.method === "GET") {
      return handleProxyJson(env, "PARTICIPANTS_INDEX_URL", "PARTICIPANTS_INDEX_KEY", "participants_index.json");
    }

    if (pathname === "/participants-index" && request.method === "POST") {
      return handleParticipantsIndexPush(request, env);
    }

    if (pathname === "/students-index" && request.method === "GET") {
      return handleProxyJson(env, "STUDENTS_INDEX_URL", "STUDENTS_INDEX_KEY", "students_index.json");
    }

    if (pathname === "/tags-index" && request.method === "GET") {
      return handleProxyJson(env, "TAGS_INDEX_URL", "TAGS_INDEX_KEY", "tags_index.json");
    }

    if (pathname === "/admin/notion/schema" && request.method === "GET") {
      return handleNotionSchema(env);
    }

    if (pathname === "/admin/notion/works" && request.method === "GET") {
      return handleNotionListWorks(url, env);
    }

    if (pathname === "/admin/notion/search-students" && request.method === "GET") {
      return handleNotionSearchStudents(url, env);
    }

    if (pathname === "/admin/notion/work" && request.method === "POST") {
      return handleNotionCreateWork(request, env);
    }

    if (pathname === "/admin/notion/work" && request.method === "PATCH") {
      return handleNotionUpdateWork(request, env);
    }

    if (pathname === "/admin/notion/tag" && request.method === "POST") {
      return handleNotionCreateTag(request, env);
    }

    if (pathname === "/admin/r2/upload" && request.method === "POST") {
      return handleR2Upload(request, env);
    }

    if (pathname === "/admin/r2/delete" && request.method === "POST") {
      return handleR2Delete(request, env);
    }

    if (pathname === "/admin/image/split" && request.method === "POST") {
      return handleImageSplit(request, env);
    }

    if (pathname === "/admin/image/move" && request.method === "POST") {
      return handleImageMove(request, env);
    }

    if (pathname === "/admin/image/merge" && request.method === "POST") {
      return handleImageMerge(request, env);
    }

    if (pathname === "/admin/trigger-gallery-update" && request.method === "POST") {
      return handleTriggerGalleryUpdate(request, env);
    }

    if (pathname === "/admin/trigger-tags-index-update" && request.method === "POST") {
      return handleTriggerTagsIndexUpdate(request, env);
    }

    return new Response("Not found", {
      status: 404,
      headers: withCors({ "Cache-Control": "no-store" }),
    });
  },
};
