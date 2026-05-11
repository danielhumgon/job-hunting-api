/**
 * Helpers for resilient HTTP calls to LLM providers (rate limits, overload 503, etc.).
 */

/** HTTP statuses that are commonly transient for cloud LLM gateways. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export function isRetryableHttpStatus (status) {
  return RETRYABLE_STATUS.has(Number(status))
}

export function sleepMs (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Exponential backoff with optional cap and jitter (reduces thundering herd).
 * @param {number} attemptIndexZeroBased - 0 for first retry delay after attempt 1 failed
 * @param {number} initialMs
 * @param {number} maxMs
 * @param {number} multiplier - typically 2
 * @param {number} jitterRatio - 0..1 fraction of delay to add randomly
 */
export function nextBackoffMs (
  attemptIndexZeroBased,
  initialMs,
  maxMs,
  multiplier,
  jitterRatio = 0.25
) {
  const base = initialMs * multiplier ** attemptIndexZeroBased
  const capped = Math.min(maxMs, Math.round(base))
  const jitter = capped * jitterRatio * Math.random()
  return Math.round(capped + jitter)
}

/**
 * POST with fetch; retries on retryable HTTP codes and on network errors.
 * @param {string} url
 * @param {RequestInit} init
 * @param {{
 *   maxAttempts?: number
 *   initialDelayMs?: number
 *   maxDelayMs?: number
 *   multiplier?: number
 *   jitterRatio?: number
 *   onRetry?: (info: { attempt: number, maxAttempts: number, reason: string, status?: number, delayMs: number }) => void
 * }} opts
 * @returns {Promise<Response>} ok response
 */
export async function fetchPostWithRetry (url, init, opts = {}) {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5)
  const initialDelayMs = opts.initialDelayMs ?? 1000
  const maxDelayMs = opts.maxDelayMs ?? 32000
  const multiplier = opts.multiplier ?? 2
  const jitterRatio = opts.jitterRatio ?? 0.25

  let lastNetworkError = /** @type {Error | null} */ (null)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.ok) {
        return res
      }

      const bodyText = await res.text()
      const bodySnippet = bodyText.slice(0, 500)

      const canRetry =
        isRetryableHttpStatus(res.status) && attempt < maxAttempts

      if (canRetry) {
        const delayMs = nextBackoffMs(
          attempt - 1,
          initialDelayMs,
          maxDelayMs,
          multiplier,
          jitterRatio
        )
        opts.onRetry?.({
          attempt,
          maxAttempts,
          reason: `HTTP_${res.status}`,
          status: res.status,
          delayMs,
          bodySnippet
        })
        await sleepMs(delayMs)
        continue
      }

      // Body already consumed — wrap so callers can read .text() / .json() again.
      return new Response(bodyText, {
        status: res.status,
        statusText: res.statusText,
        headers: { 'Content-Type': res.headers.get('content-type') || 'text/plain' }
      })
    } catch (err) {
      lastNetworkError = err instanceof Error ? err : new Error(String(err))
      const canRetry = attempt < maxAttempts
      if (canRetry) {
        const delayMs = nextBackoffMs(
          attempt - 1,
          initialDelayMs,
          maxDelayMs,
          multiplier,
          jitterRatio
        )
        opts.onRetry?.({
          attempt,
          maxAttempts,
          reason: 'network_error',
          delayMs,
          error: lastNetworkError.message
        })
        await sleepMs(delayMs)
        continue
      }
      throw lastNetworkError
    }
  }
}
