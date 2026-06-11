/**
 * Vacancy LLM scoring — OpenAI-compatible `POST {baseUrl}/chat/completions`
 * (Ollama local `/v1` or cloud), with resilient POST via `fetchPostWithRetry`.
 * Used by ingestion after job-sources `normalize()`.
 */

import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'

import wlogger from '../wlogger.js'
import { fetchPostWithRetry } from './fetch-with-retry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const llmJsonSchema = z.object({
  score: z.number(),
  reasons: z.array(z.string()).default([]),
  flags: z.array(z.string()).default([])
})

/** LLM flag when title/body are not primarily English or Spanish. */
export const LLM_UNSUPPORTED_LANGUAGE_FLAG = 'unsupported_language'

/**
 * @param {object} [llmFields]
 * @param {string[]} [llmFields.llmFlags]
 * @returns {boolean}
 */
export function vacancyHasUnsupportedLanguage (llmFields = {}) {
  const flags = llmFields.llmFlags
  if (!Array.isArray(flags)) return false
  return flags.some(
    (flag) => String(flag).trim().toLowerCase() === LLM_UNSUPPORTED_LANGUAGE_FLAG
  )
}

function clamp01 (n) {
  if (Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function dedupeLower (arr) {
  const seen = new Set()
  const out = []
  for (const s of arr) {
    const t = String(s || '').trim().toLowerCase()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function parseAssistantJson (rawText) {
  const trimmed = String(rawText || '').trim()
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
  const body = jsonMatch ? jsonMatch[0] : trimmed
  return JSON.parse(body)
}

export default class LlmAdapter {
  constructor (localConfig = {}) {
    this.config = localConfig.config || {}
    this.baseUrl = (this.config.llmApiUrl || 'http://127.0.0.1:11434/v1').replace(/\/$/, '')
    this.model = this.config.llmModel || 'gemma4'
    this.apiKey = this.config.llmApiKey || ''
    this._promptVersion = String(this.config.llmPromptVersion || '1')
    this._promptPath =
      localConfig.promptPath || this._resolvePromptPath()
    this._systemPrompt = this._loadSystemPrompt()

    this._retry = {
      maxAttempts: this.config.llmMaxRetries ?? 5,
      initialDelayMs: this.config.llmRetryInitialDelayMs ?? 1000,
      maxDelayMs: this.config.llmRetryMaxDelayMs ?? 32000,
      multiplier: this.config.llmRetryMultiplier ?? 2
    }
  }

  _resolvePromptPath () {
    const dynamicPath = path.join(__dirname, 'vacancy-scoring-prompt-dinamic.md')
    if (existsSync(dynamicPath)) return dynamicPath
    return path.join(__dirname, 'vacancy-scoring-prompt.md')
  }

  /** Reload system prompt after util/promptInitializer.js updates the dynamic file. */
  reloadSystemPrompt () {
    this._promptPath = this._resolvePromptPath()
    this._systemPrompt = this._loadSystemPrompt()
  }

  _loadSystemPrompt () {
    try {
      return readFileSync(this._promptPath, 'utf8')
    } catch (err) {
      console.error('LlmAdapter: cannot read vacancy scoring prompt:', err.message)
      return 'Reply with JSON only: {"score":0,"reasons":[],"flags":[]}'
    }
  }

  _buildUserJson (vacancy) {
    return JSON.stringify({
      title: vacancy.title,
      company: vacancy.company,
      category: vacancy.category,
      locationType: vacancy.locationType,
      experienceLevel: vacancy.experienceLevel,
      keywords: vacancy.keywords,
      skills: vacancy.skills,
      summary: vacancy.summary,
      content:
        typeof vacancy.content === 'string' ? vacancy.content.slice(0, 12000) : vacancy.content
    })
  }

  async _chatCompletions (userText) {
    const url = `${this.baseUrl}/chat/completions`
    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: this._systemPrompt },
        { role: 'user', content: userText }
      ],
      temperature: 0.2,
      stream: false
    }

    const headers = {
      'Content-Type': 'application/json'
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    const res = await fetchPostWithRetry(
      url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      },
      {
        maxAttempts: this._retry.maxAttempts,
        initialDelayMs: this._retry.initialDelayMs,
        maxDelayMs: this._retry.maxDelayMs,
        multiplier: this._retry.multiplier,
        onRetry: (info) => {
          const chunk = [`[llm] retry ${info.attempt}/${info.maxAttempts} in ${info.delayMs}ms ${info.reason || ''}`]
          if (info.bodySnippet != null) {
            chunk.push(`snippet=${String(info.bodySnippet).slice(0, 120)}`)
          }
          if (info.error != null) {
            chunk.push(`err=${info.error}`)
          }
          console.log(chunk.join(' '))
          wlogger.warn('LLM retry', info)
        }
      }
    )

    if (!res.ok) {
      const text = await res.text()
      const snippet = text.slice(0, 500)
      wlogger.warn('LLM HTTP error', res.status, snippet)
      console.log(
        `[llm] HTTP ${res.status} model=${this.model} url=${url}`,
        snippet
      )
      throw new Error(`LLM_HTTP_${res.status}`)
    }

    const data = await res.json()
    const rawText = data?.choices?.[0]?.message?.content ?? ''
    return { raw: data, rawText }
  }

  async score (vacancy) {
    const userText = this._buildUserJson(vacancy)
    try {
      const { raw, rawText } = await this._chatCompletions(userText)

      let parsed
      try {
        parsed = parseAssistantJson(rawText)
      } catch (e) {
        wlogger.warn('LLM JSON parse failed', e)
        console.log('[llm] parse failed; raw:', String(rawText).slice(0, 300))
        return {
          llmStatus: 'failed',
          llmScore: null,
          llmReasons: [],
          llmFlags: [],
          llmModel: this.model,
          llmPromptVersion: this._promptVersion,
          llmClassifiedAt: new Date(),
          llmRawOutput: { openaiCompat: raw, assistantText: rawText },
          belowMinScore: false
        }
      }

      const validated = llmJsonSchema.safeParse(parsed)
      if (!validated.success) {
        console.error('LlmAdapter.score zod:', validated.error.flatten())
        return {
          llmStatus: 'failed',
          llmScore: null,
          llmReasons: [],
          llmFlags: [],
          llmModel: this.model,
          llmPromptVersion: this._promptVersion,
          llmClassifiedAt: new Date(),
          llmRawOutput: { openaiCompat: raw, assistantText: rawText, parsed },
          belowMinScore: false
        }
      }

      const { score, reasons, flags } = validated.data
      let llmScore = clamp01(score)
      const llmReasons = dedupeLower(reasons)
      const llmFlags = dedupeLower(flags)
      if (vacancyHasUnsupportedLanguage({ llmFlags })) {
        llmScore = 0
      }
      const min = this.config.minVacancyLlmScore
      const belowMinScore =
        vacancyHasUnsupportedLanguage({ llmFlags }) ||
        (typeof min === 'number' && !Number.isNaN(min) && typeof llmScore === 'number'
          ? llmScore < min
          : false)

      return {
        llmScore,
        llmReasons,
        llmFlags,
        llmModel: this.model,
        llmPromptVersion: this._promptVersion,
        llmStatus: 'completed',
        llmClassifiedAt: new Date(),
        llmRawOutput: { openaiCompat: raw, assistantText: rawText },
        belowMinScore
      }
    } catch (err) {
      console.error('LlmAdapter.score:', err.message)
      return {
        llmStatus: 'failed',
        llmScore: null,
        llmReasons: [],
        llmFlags: [],
        llmModel: this.model,
        llmPromptVersion: this._promptVersion,
        llmClassifiedAt: new Date(),
        llmRawOutput: err.message,
        belowMinScore: false
      }
    }
  }
}
