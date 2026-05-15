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

/**
 * One full-text query per core area in `vacancy-scoring-prompt.md` (Profile Context).
 * Each `GET /api/search?q=` returns up to 10 rows ([API docs](https://vacantesdigitales.com/api#endpoints)).
 */
export const PROFILE_STACK_SEARCH_QUERIES = [
  'Node.js Express Koa MongoDB',
  'React Next.js Vite Tailwind CSS',
  'web3 dApp IPFS P2P AI agents',
  'unit integration testing'
]

/**
 * Ingest drops vacancies whose title, body, keywords, or skills match these stacks (case-insensitive).
 * JavaScript / Node jobs are kept (`java` uses a boundary so it does not match `javascript`).
 */
export const IGNORE_STACK_FOR_INGEST = [
  'Python',
  'Java',
  'PHP',
  '.NET',
  'Ruby',
  'C++'
]

/** Precompiled matchers for {@link IGNORE_STACK_FOR_INGEST}. */
const IGNORE_STACK_REGEXES = [
  /\bpython(?:\d+(\.\d+)?)?\b/i,
  /\bphp\b/i,
  /\bruby\b/i,
  /\bjava\b(?!script\b|[a-z])/i,
  /\bdotnet\b/i,
  /\basp\.net\b/i,
  /(?:^|[^\w.])(?:\.net)(?:\s+core|\s+\d|$|\s|[),.;:!?/\-–—])/i,
  /\bc\+\+|\bcpp\b/i
]

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

    console.log('fetching vacancies', data.length)

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
   * Ingestion pipeline: runs **`GET /api/search`** once per {@link PROFILE_STACK_SEARCH_QUERIES}
   * (aligned with `vacancy-scoring-prompt.md` stack areas), merges rows, dedupes by `id`, then {@link VacantesDigitales#normalize}s each.
   *
   * @returns {Promise<object[]>} Array of normalized vacancy documents ready for LLM scoring / persistence.
   */
  async fetchVacancies () {
    const payloads = await Promise.all(
      PROFILE_STACK_SEARCH_QUERIES.map((q) => this._getJson('search', { q }))
    )
    const byId = new Map()
    let rawRowCount = 0
    for (const payload of payloads) {
      const rows = Array.isArray(payload.data) ? payload.data : []
      rawRowCount += rows.length
      for (const raw of rows) {
        if (raw && raw.id != null && !byId.has(raw.id)) {
          byId.set(raw.id, raw)
        }
      }
    }
    const deduped = [...byId.values()]
    const kept = deduped.filter((raw) => !this._matchesIgnoreStack(raw))
    const ignoredStackCount = deduped.length - kept.length
    const normalized = kept.map(this.normalize)
    let logMsg =
      `VacantesDigitales.fetchVacancies: ${normalized.length} unique vacancies` +
      (rawRowCount !== deduped.length
        ? ` (${rawRowCount} rows from /api/search before dedupe)`
        : '')
    if (ignoredStackCount > 0) {
      logMsg += `; skipped ${ignoredStackCount} ignored-stack match(es)`
    }
    console.log(logMsg)
    return normalized
  }

  /**
   * True if this raw row should not be ingested because it matches {@link IGNORE_STACK_FOR_INGEST}.
   *
   * @param {object} raw — API row (search/list/vacancies shape).
   * @returns {boolean}
   */
  _matchesIgnoreStack (raw) {
    if (!raw || typeof raw !== 'object') return false
    const parts = [
      raw.title,
      this._primaryBodyText(raw),
      ...(Array.isArray(raw.keywords) ? raw.keywords : []),
      ...(Array.isArray(raw.skills) ? raw.skills : [])
    ]
    const haystack = parts
      .filter((p) => p != null && String(p).length)
      .map((p) => String(p))
      .join('\n')
    if (!haystack.length) return false
    return IGNORE_STACK_REGEXES.some((re) => re.test(haystack))
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
    const category = raw.job_category || raw.category || this.category
    const slug = raw.slug || ''

    const bodyText = this._primaryBodyText(raw)
    const summary =
      bodyText.length > 480 ? `${bodyText.slice(0, 477)}…` : bodyText

    return {
      source: this.sourceSlug,
      externalId: raw.id,
      title: raw.title || '',
      slug,
      company: raw.company || null,
      category,
      locationType: this._mapJobLocationType(
        raw.job_location_type ?? raw.location_type
      ),
      addressLocality: raw.address_locality || null,
      addressCountry: raw.address_country || null,
      experienceLevel: raw.experience ?? raw.experience_level ?? null,
      datePosted: this._normalizeDate(
        raw.date_posted_iso || raw.post_date || raw.date_posted
      ),
      validThrough: this._normalizeDate(raw.valid_through),
      keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
      skills: Array.isArray(raw.skills) ? raw.skills : [],
      summary,
      content: bodyText,
      applyUrl: raw.post_url ?? raw.apply_url ?? null,
      sourceUrl:
        typeof raw.url === 'string' && raw.url
          ? raw.url
          : `https://vacantesdigitales.com/empleo-digital/${category}/${slug}`,
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
   * Prefer SEO/copy field from **`/api/vacancies`**, else markdown body from **`/api/list`** / **`/api/search`**.
   *
   * @param {object} raw
   * @returns {string}
   */
  _primaryBodyText (raw) {
    if (typeof raw.copy_seo_raw === 'string' && raw.copy_seo_raw.length) {
      return raw.copy_seo_raw
    }
    if (typeof raw.content === 'string' && raw.content.length) {
      return raw.content
    }
    if (typeof raw.summary === 'string') {
      return raw.summary
    }
    return ''
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
    if (jobLocationType == null || jobLocationType === '') return null
    const s = String(jobLocationType).trim()
    const lower = s.toLowerCase()
    if (
      lower === 'remoto' ||
      lower === 'remote' ||
      lower === 'telecommute'
    ) {
      return 'remoto'
    }
    if (lower === 'hibrido' || lower === 'hybrid' || lower === 'híbrido') {
      return 'hibrido'
    }
    if (
      lower === 'presencial' ||
      lower === 'onsite' ||
      lower === 'in_store' ||
      lower === 'in-store'
    ) {
      return 'presencial'
    }
    const t = s.toUpperCase()
    if (t === 'TELECOMMUTE') return 'remoto'
    if (t === 'HYBRID') return 'hibrido'
    if (t === 'ONSITE' || t === 'IN_STORE') return 'presencial'
    return lower || null
  }
}
