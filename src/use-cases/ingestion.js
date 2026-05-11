/*
  Ingestion pipeline: fetch from job sources → validate → LLM score → persist (upsert per doc).
*/

import VacancyEntity from '../entities/vacancy.js'

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

        const llmFields = await this.adapters.llm.score(row)
        if (llmFields.llmStatus === 'failed') {
          llmFailed += 1
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
