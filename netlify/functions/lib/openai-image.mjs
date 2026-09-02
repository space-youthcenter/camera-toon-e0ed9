const PAPER_TOON_PROMPT = `Transform this photo crop into a simple childlike hand-drawn colored pencil drawing on paper. Keep the main composition, pose, and large shapes, but simplify details. Draw rough black ink outlines with slightly shaky, imperfect hand-drawn lines. Color it with uneven colored pencil or crayon strokes, leaving some white paper gaps. Allow a little coloring outside the outlines and slightly clumsy proportions. Make it look cute, playful, analog, and intentionally a little clumsy, like a young child carefully copied the photo onto paper. Add subtle paper grain. Avoid anime, webtoon, glossy digital cartoon, professional illustration, polished artwork, 3D render, oil painting, watercolor, realistic photo style, smooth vector lines, posterize-only effects, and edge-detect-only effects.`;

export async function transformWithOpenAI(imageBuffer, mimeType, width, height) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const form = new FormData();
  form.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-2");
  form.append("image[]", new Blob([imageBuffer], { type: mimeType }), "camera-toon-crop.jpg");
  form.append("prompt", PAPER_TOON_PROMPT);
  form.append("size", chooseImageSize(width, height));
  form.append("quality", normalizeQuality(process.env.OPENAI_IMAGE_QUALITY));
  form.append("output_format", "jpeg");
  form.append("output_compression", "82");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal
    });
    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI returned ${response.status}`;
      throw new Error(message);
    }
    const base64 = payload?.data?.[0]?.b64_json;
    if (!base64) throw new Error("OpenAI returned no image");
    return base64;
  } finally {
    clearTimeout(timeout);
  }
}

export function chooseImageSize(width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const ratio = Math.min(3, Math.max(1 / 3, safeWidth / safeHeight));
  let outputWidth = ratio >= 1 ? 1024 : 1024 * ratio;
  let outputHeight = ratio >= 1 ? 1024 / ratio : 1024;
  const minimumPixels = 655360;
  if (outputWidth * outputHeight < minimumPixels) {
    const scale = Math.sqrt(minimumPixels / (outputWidth * outputHeight));
    outputWidth *= scale;
    outputHeight *= scale;
  }
  outputWidth = Math.ceil(outputWidth / 16) * 16;
  outputHeight = Math.ceil(outputHeight / 16) * 16;
  return `${outputWidth}x${outputHeight}`;
}

export function normalizeQuality(value) {
  return ["low", "medium", "high"].includes(value) ? value : "low";
}
