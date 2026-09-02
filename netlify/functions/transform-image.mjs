import { transformWithOpenAI } from "./lib/openai-image.mjs";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const parsed = parseImageRequest(event);
    if (parsed.buffer.length > MAX_IMAGE_BYTES) return json(413, { error: "Image is too large" });

    const openaiStarted = nowMs();
    const base64 = await transformWithOpenAI(
      parsed.buffer,
      parsed.mimeType,
      parsed.width,
      parsed.height
    );
    const openaiMs = Math.round(nowMs() - openaiStarted);
    console.info("[Camera Toon timing] OpenAI image edit", `${openaiMs}ms`, `${parsed.width}x${parsed.height}`);
    return json(200, {
      image: `data:image/jpeg;base64,${base64}`,
      timing: { openaiMs }
    });
  } catch (error) {
    console.error("Camera Toon transform failed", error instanceof Error ? error.message : error);
    return json(502, { error: "Image transformation failed" });
  }
}

function parseImageRequest(event) {
  const contentType = String(event.headers?.["content-type"] || event.headers?.["Content-Type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const query = event.queryStringParameters || {};

  if (["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    if (!event.body) throw new Error("Image is required");
    return {
      mimeType: contentType,
      buffer: Buffer.from(event.body, event.isBase64Encoded ? "base64" : "binary"),
      width: positiveNumber(query.width, 1024),
      height: positiveNumber(query.height, 1024)
    };
  }

  const body = JSON.parse(event.body || "{}");
  const parsed = parseDataURL(body.image);
  return {
    ...parsed,
    width: positiveNumber(body.width, 1024),
    height: positiveNumber(body.height, 1024)
  };
}

function parseDataURL(value) {
  if (typeof value !== "string") throw new Error("Image is required");
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Unsupported image data");
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}
