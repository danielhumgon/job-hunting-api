/*
  Ingestion pipeline: fetch from job sources → validate → LLM score → persist (upsert per doc).
*/

import VacancyEntity from '../entities/vacancy.js'
import { vacancyHasUnsupportedLanguage } from '../adapters/llm/index.js'

/** Drop ingested rows when `datePosted` is older than this many days. */
export const INGESTION_MAX_POST_AGE_DAYS = 30

/**
 * @param {object} row — normalized vacancy row
 * @param {number} [maxAgeDays]
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isVacancyTooOldForIngestion (
  row,
  maxAgeDays = INGESTION_MAX_POST_AGE_DAYS,
  now = new Date()
) {
  const datePosted = row?.datePosted
  if (datePosted == null) return false

  const posted =
    datePosted instanceof Date ? datePosted : new Date(datePosted)
  if (Number.isNaN(posted.getTime())) return false

  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - maxAgeDays)
  return posted < cutoff
}

function dedupeBySourceAndExternalId (rows) {
  if (!Array.isArray(rows)) return []
  const map = new Map()
  for (const row of rows) {
    const key = `${String(row?.source ?? '')}:${String(row?.externalId ?? '')}`
    map.set(key, row)
  }
  return [...map.values()]
}

class IngestionUseCases {
  constructor (localConfig = {}) {
    this.adapters = localConfig.adapters
    if (!this.adapters) {
      throw new Error(
        'Instance of adapters must be passed in when instantiating Ingestion Use Cases library.'
      )
    }
    this.VacancyModel = this.adapters.localdb.Vacancy
    this._vacancyEntity = new VacancyEntity()
  }

  /**
   * Full ingestion tick: fetch normalized rows, validate, score with LLM, upsert into MongoDB.
   * Per-source and LLM failures are non-fatal; unexpected outer errors set `ok: false`.
   *
   * @returns {Promise<{ ok: boolean, metrics: object, error?: string }>}
   */
  async ingestVacancies () {
    const startedAt = Date.now()

    try {
      const { vacancies: fetched, metrics: fetchMetrics } =
        await this.adapters.jobSources.ingestVacancies()

      const rows = dedupeBySourceAndExternalId(fetched)

      let skippedInvalid = 0
      let skippedTooOld = 0
      let skippedUnsupportedLanguage = 0
      let llmFailed = 0
      let persisted = 0
      let persistErrors = 0
      let inserted = 0
      let modified = 0
      let matched = 0

      for (const row of rows) {
        try {
          this._vacancyEntity.validateForPersistence(row)
        } catch (err) {
          skippedInvalid += 1
          console.log('ingestion: skipped invalid vacancy:', err.message)
          continue
        }

        if (isVacancyTooOldForIngestion(row)) {
          skippedTooOld += 1
          console.log(
            'ingestion: skipped vacancy older than',
            INGESTION_MAX_POST_AGE_DAYS,
            'day(s):',
            row.source,
            row.externalId
          )
          continue
        }

        const llmFields = await this.adapters.llm.score(row)
        if (llmFields.llmStatus === 'failed') {
          llmFailed += 1
        }
        if (vacancyHasUnsupportedLanguage(llmFields)) {
          skippedUnsupportedLanguage += 1
          console.log(
            'ingestion: skipped unsupported language vacancy:',
            row.source,
            row.externalId
          )
          continue
        }

        const doc = { ...row, ...llmFields }

        try {
          const res = await this.VacancyModel.updateOne(
            { source: doc.source, externalId: doc.externalId },
            { $set: doc },
            { upsert: true }
          )
          persisted += 1
          inserted += res.upsertedCount || 0
          modified += res.modifiedCount || 0
          matched += res.matchedCount || 0
        } catch (err) {
          persistErrors += 1
          console.error('ingestion: upsert failed:', err.message)
        }
      }

      return {
        ok: true,
        metrics: {
          phase: 'ingestVacancies',
          durationMs: Date.now() - startedAt,
          fetch: fetchMetrics,
          fetchedRows: Array.isArray(fetched) ? fetched.length : 0,
          dedupedRows: rows.length,
          skippedInvalid,
          skippedTooOld,
          skippedUnsupportedLanguage,
          llmFailed,
          persisted,
          persistErrors,
          inserted,
          modified,
          matched
        }
      }
    } catch (err) {
      console.error('Error in IngestionUseCases.ingestVacancies:', err.message)
      return {
        ok: false,
        error: err.message,
        metrics: {
          phase: 'ingestVacancies',
          durationMs: Date.now() - startedAt
        }
      }
    }
  }
}

export default IngestionUseCases
