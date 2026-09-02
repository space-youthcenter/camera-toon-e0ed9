const STATUS_TTL_MS = 5 * 60 * 1000;
let cachedStatus = null;

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(200, { enabled: false });

  if (cachedStatus && cachedStatus.expiresAt > Date.now()) {
    return json(200, { enabled: cachedStatus.enabled });
  }

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  let enabled = false;
  try {
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
    enabled = response.ok;
  } catch (error) {
    enabled = false;
  } finally {
    clearTimeout(timeout);
  }

  cachedStatus = { enabled, expiresAt: Date.now() + STATUS_TTL_MS };
  return json(200, { enabled });
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}
