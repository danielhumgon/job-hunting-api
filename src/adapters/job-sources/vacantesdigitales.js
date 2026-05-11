/**
 * VacantesDigitales — HTTP client, browse helpers, and ingestion (specs.md §6).
 *
 * @see https://vacantesdigitales.com/api#endpoints
 */

import axios from 'axios'

/** Base path for all public API requests. */
const BASE_URL = 'https://vacantesdigitales.com/api'
/** Page size for GET /api/list (API default). */
const LIST_PAGE_SIZE = 10

export default class VacantesDigitales {
  /**
   * Sets base URLs, ingestion filters, and binds `normalize` for use as a callback (e.g. `rows.map(this.normalize)`).
   *
   * @param {object} [localConfig]
   * @param {object} [localConfig.config] — Application config; **`jobIngestionVersion`** is read when building normalized documents.
   */
  constructor (localConfig = {}) {
    this.baseUrl = BASE_URL
    this.config = localConfig.config || {}
    this.sourceSlug = 'vacantesdigitales'
    this.category = 'desarrollo'
    this.locationTypeFilter = 'remoto'
    this.pageLimit = 100
    this.normalize = this.normalize.bind(this)
  }

  /**
   * Low-level GET helper: builds URL under the `BASE_URL` constant, forwards query params, and returns parsed JSON (`data` from axios).
   *
   * @param {string} resourcePath — Path segment after `/api/` (e.g. `categories`, `list`, `vacancies`, `category/remoto`).
   * @param {Record<string, string|number|undefined>} [query] — Query string parameters; `undefined` / `null` values are skipped.
   * @returns {Promise<object|Array>} Parsed JSON body from the API.
   * @throws {Error} When the HTTP request fails or returns a non-success status.
   */
  async _getJson (resourcePath, query = {}) {
    const url = `${this.baseUrl.replace(/\/$/, '')}/${resourcePath.replace(/^\//, '')}`
    const params = {}
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params[key] = value
      }
    }
    try {
      const { data } = await axios.get(url, { params })
      return data
    } catch (err) {
      console.log('err', err)
      const status = err.response && err.response.status
      const statusText =
        (err.response && err.response.statusText) || err.message
      throw new Error(
        `VacantesDigitales ${resourcePath} failed: ${status || 'ERR'} ${statusText}`
      )
    }
  }

  /**
   * Browse entry point: in parallel, loads **taxonomy** (`GET /api/categories`) and **latest vacancies** (`GET /api/list?page=…`).
   * Concatenates list pages until `targetCount` rows are available (10 rows per list page), then merges taxonomy fields with a `{ vacancies }` wrapper.
   *
   * @param {number} [targetCount=100] — Max number of vacancy rows to return from `/list` (may fetch multiple pages).
   * @returns {Promise<object>} Spread of the categories API response (`dimensions`, `categories`, `telegram_channel`, …) plus **`vacancies`**: `{ data, pagination }`.
   */
  async start (targetCount = 100) {
    const pagesNeeded = Math.ceil(targetCount / LIST_PAGE_SIZE)
    const pageNumbers = Array.from({ length: pagesNeeded }, (_, i) => i + 1)

    const results = await Promise.all([
      this._getJson('categories'),
      ...pageNumbers.map((p) => this._getJson('list', { page: p }))
    ])

    const taxonomy = results[0]
    const payloads = results.slice(1)

    const data = []
    for (const payload of payloads) {
      if (Array.isArray(payload.data)) {
        data.push(...payload.data)
      }
    }

    const trimmed = data.slice(0, targetCount)
    const refPagination = payloads[0]?.pagination

    const vacancies = {
      data: trimmed,
      pagination: {
        returned: trimmed.length,
        pagesFetched: pagesNeeded,
        perRequestLimit: LIST_PAGE_SIZE,
        totalAvailable: refPagination?.total,
        totalPagesOnApi: refPagination?.pages
      }
    }

    return {
      ...taxonomy,
      vacancies
    }
  }

  /**
   * Ingestion pipeline: pages **`GET /api/vacancies`** with fixed filters (`category=desarrollo`, `location_type=remoto`, `limit=100`) until all pages are consumed (see specs.md §6).
   * Each row is passed through {@link VacantesDigitales#normalize}.
   *
   * @returns {Promise<object[]>} Array of normalized vacancy documents ready for LLM scoring / persistence.
   */
  async fetchVacancies () {
    const out = []
    let page = 1
    let totalPages = 1

    while (page <= totalPages) {
      const payload = await this._getJson('vacancies', {
        category: this.category,
        location_type: this.locationTypeFilter,
        limit: this.pageLimit,
        page
      })
      const rows = Array.isArray(payload.data) ? payload.data : []
      out.push(...rows.map(this.normalize))
      const pag = payload.pagination || {}
      totalPages = typeof pag.pages === 'number' ? pag.pages : 1
      page += 1
    }

    return out
  }

  /**
   * Maps one raw row from **`/api/vacancies`** into the canonical stored shape (source metadata, LLM placeholders, URLs).
   * Does not call the network.
   *
   * @param {object} raw — Single item from `payload.data` (see Vacantes Digitales API).
   * @returns {object} Normalized document including **`source`**, **`externalId`**, **`llmStatus`: `'pending'`**, etc.
   */
  normalize (raw) {
    const fetchedAt = new Date()
    const ingestionVersion = this.config.jobIngestionVersion || '1'
    const category = raw.job_category || this.category
    const slug = raw.slug || ''

    const summarySource = typeof raw.copy_seo_raw === 'string' ? raw.copy_seo_raw : ''
    const summary =
      summarySource.length > 480 ? `${summarySource.slice(0, 477)}…` : summarySource

    return {
      source: this.sourceSlug,
      externalId: raw.id,
      title: raw.title || '',
      slug,
      company: raw.company || null,
      category,
      locationType: this._mapJobLocationType(raw.job_location_type),
      addressLocality: raw.address_locality || null,
      addressCountry: raw.address_country || null,
      experienceLevel: raw.experience || null,
      datePosted: this._normalizeDate(raw.date_posted_iso || raw.post_date),
      validThrough: this._normalizeDate(raw.valid_through),
      keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
      skills: Array.isArray(raw.skills) ? raw.skills : [],
      summary,
      content: typeof raw.copy_seo_raw === 'string' ? raw.copy_seo_raw : '',
      applyUrl: raw.post_url || null,
      sourceUrl: `https://vacantesdigitales.com/empleo-digital/${category}/${slug}`,
      fetchedAt,
      ingestionVersion,

      llmScore: null,
      llmReasons: [],
      llmFlags: [],
      llmModel: null,
      llmPromptVersion: null,
      llmStatus: 'pending',
      llmClassifiedAt: null,
      llmRawOutput: null,
      belowMinScore: false
    }
  }

  /**
   * Parses API date strings into **`Date`** instances; invalid or missing values become **`undefined`** (Mongo can omit the field).
   *
   * @param {string|number|Date|undefined} value — ISO string or other input accepted by `new Date()`.
   * @returns {Date|undefined}
   */
  _normalizeDate (value) {
    if (!value) return undefined
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? undefined : d
  }

  /**
   * Maps API **job location type** enums (e.g. Schema.org `TELECOMMUTE`) to short Spanish modality slugs used in our schema (`remoto`, `hibrido`, `presencial`).
   *
   * @param {string|null|undefined} jobLocationType — Raw `job_location_type` from the API.
   * @returns {string|null} Lowercase modality or **`null`** if unknown.
   */
  _mapJobLocationType (jobLocationType) {
    const t = String(jobLocationType || '').toUpperCase()
    if (t === 'TELECOMMUTE') return 'remoto'
    if (t === 'HYBRID') return 'hibrido'
    if (t === 'ONSITE' || t === 'IN_STORE') return 'presencial'
    return jobLocationType ? String(jobLocationType).toLowerCase() : null
  }
}
