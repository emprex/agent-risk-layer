const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3:4b-instruct';
const DEFAULT_TIMEOUT_MS = 60000;

function resolveTimeoutMs(explicitTimeoutMs) {
  if (Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
    return explicitTimeoutMs;
  }

  const configured = Number.parseInt(
    String(process.env.ARL_AI_TIMEOUT_MS || '').trim(),
    10
  );

  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_TIMEOUT_MS;
}

export async function askLocalOllama({
  messages,
  fetchImpl = globalThis.fetch,
  baseUrl =
    process.env.ARL_OLLAMA_URL ||
    process.env.OLLAMA_URL ||
    DEFAULT_OLLAMA_URL,
  model =
    process.env.ARL_AI_MODEL ||
    DEFAULT_MODEL,
  timeoutMs
} = {}) {
  const resolvedTimeoutMs = resolveTimeoutMs(timeoutMs);
  if (typeof fetchImpl !== 'function') {
    return {
      available: false,
      reason: 'fetch_unavailable'
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    resolvedTimeoutMs
  );

  try {
    const response = await fetchImpl(
      `${String(baseUrl).replace(/\/$/, '')}/api/chat`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model,
          stream: false,
          messages
        }),
        signal: controller.signal
      }
    );

    if (!response.ok) {
      return {
        available: false,
        reason: `ollama_http_${response.status}`
      };
    }

    const payload = await response.json();
    const content = String(
      payload?.message?.content || ''
    ).trim();

    if (!content) {
      return {
        available: false,
        reason: 'ollama_empty_response'
      };
    }

    return {
      available: true,
      model,
      content
    };
  } catch (error) {
    return {
      available: false,
      reason:
        error?.name === 'AbortError'
          ? 'ollama_timeout'
          : 'ollama_unavailable'
    };
  } finally {
    clearTimeout(timer);
  }
}
