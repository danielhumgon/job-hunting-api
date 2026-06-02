/*
  Job source registry — same pattern as LocalDB: a class encapsulating active sources.
*/

import config from '../../../config/index.js'
import GetOnBrdJobSource from './getonbrd.js'
import JoobleJobSource from './jooble.js'
import LeverJobSource from './lever.js'
import LinkedInJobSource from './linkedin.js'
import VacantesDigitales from './vacantesdigitales.js'
import XApiJobSource from './x-api.js'

class JobSources {
  constructor (localConfig = {}) {
    const cfg = localConfig.config || config

    /** Active ingestion adapters — append new source classes here. */
    this.sources = [
      // Commented for debugging purposes
      new VacantesDigitales({ config: cfg }),
      new JoobleJobSource({ config: cfg }),
      new GetOnBrdJobSource({ config: cfg }),
      new XApiJobSource({ config: cfg }),

      new LinkedInJobSource({ config: cfg })

      // NOTE: Reviewing this source .
      // new LeverJobSource({ config: cfg })

    ]

    this.sourcesSlug = this._buildSourcesSlug()
  }

  _buildSourcesSlug () {
    return this.sources.map(
      (source) => source.sourceSlug || source.constructor?.name || 'unknown'
    )
  }

  /**
   * Sources that implement **`fetchVacancies`** / **`normalize`** (ingestion).
   * @returns {Array<object>}
   */
  getActiveAdapters () {
    return this.sources
  }

  /**
   * Optional warmup: calls **`start()`** on each source when implemented (e.g. Vacantes Digitales browse bootstrap).
   */
  async start () {
    for (const source of this.sources) {
      if (typeof source.start !== 'function') continue
      await source.start()
    }
  }

  /**
   * Fetches normalized vacancies from every active source. Per-source failures are logged; does not run LLM or DB writes.
   *
   * @returns {Promise<{ vacancies: object[], metrics: object }>} Combined rows and per-source fetch metrics (see specs.md §8.2).
   */
  async ingestVacancies () {
    const fetchStartedAt = Date.now()
    const combined = []
    const perSource = []
    let sourcesSkippedNoFetcher = 0
    let sourcesFailed = 0

    for (const source of this.sources) {
      const name = source.sourceSlug || source.constructor?.name || 'unknown'
      if (typeof source.fetchVacancies !== 'function') {
        sourcesSkippedNoFetcher += 1
        perSource.push({ source: name, count: 0, ok: true, skipped: true })
        continue
      }
      try {
        const batch = await source.fetchVacancies()
        const count = Array.isArray(batch) ? batch.length : 0
        if (Array.isArray(batch)) {
          combined.push(...batch)
        }
        perSource.push({ source: name, count, ok: true })
      } catch (err) {
        sourcesFailed += 1
        console.error(`JobSources.ingestVacancies: source "${name}" failed:`, err.message)
        perSource.push({ source: name, count: 0, ok: false, error: err.message })
      }
    }

    return {
      vacancies: combined,
      metrics: {
        phase: 'fetch',
        durationMs: Date.now() - fetchStartedAt,
        totalRows: combined.length,
        sourcesTotal: this.sources.length,
        sourcesSkippedNoFetcher,
        sourcesFailed,
        perSource
      }
    }
  }
}

export default JobSources
export { GetOnBrdJobSource }
export { JoobleJobSource }
export { LeverJobSource }
export { LinkedInJobSource }
export { VacantesDigitales }
export { XApiJobSource }
