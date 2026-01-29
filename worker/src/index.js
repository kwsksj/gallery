const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
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

    return new Response("Not found", {
      status: 404,
      headers: withCors({ "Cache-Control": "no-store" }),
    });
  },
};
