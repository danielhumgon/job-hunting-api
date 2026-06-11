/*
  Build vacancy-scoring-prompt-dinamic.md from the base prompt and recent rejectReason values.

  Run: node util/promptInitializer.js
  Safe to call at API startup — never throws; always writes the output file.
*/

import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import mongoose from 'mongoose'

import config from '../config/index.js'
import Vacancy from '../src/adapters/localdb/models/vacancy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

export const PLACEHOLDER = '{{DYNAMIC_REJECT_REASONS}}'
export const FALLBACK_REJECT_REASONS =
  '_No recent manual rejection reasons on record._'

const BASE_PROMPT_PATH = path.join(
  ROOT,
  'src/adapters/llm/vacancy-scoring-prompt.md'
)
const OUTPUT_PROMPT_PATH = path.join(
  ROOT,
  'src/adapters/llm/vacancy-scoring-prompt-dinamic.md'
)

const REJECTED_QUERY = {
  rejected: true,
  rejectReason: { $exists: true, $nin: [null, ''] }
}

/**
 * @param {object[]} vacancies
 * @returns {string} Markdown bullet list or empty string
 */
export function formatRejectReasons (vacancies = []) {
  const lines = vacancies
    .map((v) => String(v.rejectReason ?? '').trim())
    .filter((text) => text.length > 0)

  if (!lines.length) return ''

  return lines
    .map((text) => {
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      return `* **Reason:** "${escaped}"`
    })
    .join('\n')
}

/**
 * @param {string} reasonsBlock
 * @returns {string}
 */
export function injectRejectReasons (basePrompt, reasonsBlock) {
  if (!basePrompt.includes(PLACEHOLDER)) {
    return `${basePrompt}\n\n## Learned Rejection Patterns (Recent Dismissals)\n\n${reasonsBlock}\n\n
    The user has explicitly rejected jobs for these conditions. If the post matches or implies any of them, treat it as a hard negative signal, penalize heavily (Max score: 0.15 - 0.20), and explain it in the reasons:`
  }
  return basePrompt.replace(PLACEHOLDER, reasonsBlock)
}

/**
 * @returns {Promise<object[]>}
 */
export async function fetchLatestRejectedVacancies (limit = 10) {
  return Vacancy.find(REJECTED_QUERY)
    .sort({ rejectedAt: -1, updatedAt: -1 })
    .limit(limit)
    .select({ rejectReason: 1 })
    .lean()
}

let dbConnectedHere = false

async function connectDb () {
  if (mongoose.connection.readyState !== 0) return
  mongoose.Promise = global.Promise
  mongoose.set('useCreateIndex', true)
  await mongoose.connect(config.database, {
    useUnifiedTopology: true,
    useNewUrlParser: true
  })
  dbConnectedHere = true
}

async function disconnectDb () {
  if (!dbConnectedHere) return
  await mongoose.connection.close()
  dbConnectedHere = false
}

/**
 * Query recent rejections, merge into the base LLM prompt, write the dynamic file.
 * Never throws — uses fallback text when the DB is unavailable or returns no rows.
 *
 * @returns {Promise<{ ok: boolean, reasonCount: number, outputPath: string }>}
 */
export async function initializeDynamicVacancyPrompt () {
  let reasonsBlock = FALLBACK_REJECT_REASONS
  let reasonCount = 0

  try {
    if (!config.noMongo) {
      await connectDb()
      const rows = await fetchLatestRejectedVacancies(10)
      const formatted = formatRejectReasons(rows)
      if (formatted) {
        reasonsBlock = formatted
        reasonCount = formatted.split('\n').length
      }
    }
  } catch (err) {
    console.error('promptInitializer: DB query failed:', err.message)
  } finally {
    try {
      await disconnectDb()
    } catch (err) {
      console.error('promptInitializer: DB disconnect failed:', err.message)
    }
  }

  try {
    const basePrompt = readFileSync(BASE_PROMPT_PATH, 'utf8')
    const output = injectRejectReasons(basePrompt, reasonsBlock)
    writeFileSync(OUTPUT_PROMPT_PATH, output, 'utf8')
    console.log(
      `promptInitializer: wrote ${OUTPUT_PROMPT_PATH} (${reasonCount} rejection reason(s))`
    )
    return { ok: true, reasonCount, outputPath: OUTPUT_PROMPT_PATH }
  } catch (err) {
    console.error('promptInitializer: failed to write dynamic prompt:', err.message)
    try {
      writeFileSync(
        OUTPUT_PROMPT_PATH,
        'Reply with JSON only: {"score":0,"reasons":[],"flags":[]}\n',
        'utf8'
      )
      return { ok: true, reasonCount: 0, outputPath: OUTPUT_PROMPT_PATH }
    } catch (writeErr) {
      console.error('promptInitializer: emergency write failed:', writeErr.message)
      return { ok: false, reasonCount: 0, outputPath: OUTPUT_PROMPT_PATH }
    }
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  initializeDynamicVacancyPrompt()
    .then((result) => process.exit(result.ok ? 0 : 1))
    .catch((err) => {
      console.error('promptInitializer: unexpected error:', err.message)
      process.exit(1)
    })
}
