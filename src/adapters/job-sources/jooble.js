/**
 * Jooble — job listings from **`POST https://jooble.org/api/{api_key}`**.
 *
 * Authenticates with the API key in the URL path (`JOOBLE_API_KEY` in config).
 * One search per stack query in {@link PROFILE_STACK_SEARCH_QUERIES}, paginated by
 * `page` (30 results per page per Jooble), merged and deduped by job `id`.
 *
 * @see https://jooble.org/api/about
 * @see https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation
 */

import axios from 'axios'

export const JOOBLE_API_BASE = 'https://jooble.org/api'

/** Jooble returns 20 jobs per page (observed; not documented as a constant). */
export const JOOBLE_JOBS_PER_PAGE = 20

/** Default max pages fetched per keyword query (30 jobs × pages). */
export const JOOBLE_DEFAULT_MAX_PAGES_PER_QUERY = 1

/**
 * One search per core area in `vacancy-scoring-prompt.md` (Profile Context).
 */
export const PROFILE_STACK_SEARCH_QUERIES = [
  'Node.js Express Koa MongoDB',
  'React Next.js Vite Tailwind CSS',
  'web3 dApp IPFS P2P AI agents',
  'unit integration testing'
]

export const IGNORE_STACK_FOR_INGEST = [
  'Python',
  'Java',
  'PHP',
  '.NET',
  'Ruby',
  'C++'
]

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

/**
 * @param {string} html
 * @returns {string}
 */
export function stripJoobleHtml (html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} text
 * @returns {string|null}
 */
export function inferJoobleLocationType (text) {
  const t = String(text || '')
  if (/\bremote\b|\bremoto\b|\btelecommut/i.test(t)) return 'remoto'
  if (/\bhybrid\b|\bh[ií]brido\b/i.test(t)) return 'hibrido'
  if (/\bonsite\b|\bpresencial\b/i.test(t)) return 'presencial'
  return null
}

/**
 * @param {string|undefined} updated — ISO datetime from API
 * @returns {Date|undefined}
 */
export function parseJoobleUpdated (updated) {
  if (!updated) return undefined
  const d = new Date(updated)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/**
 * @param {object} raw — job object from Jooble `jobs[]`
 * @param {string} sourceSlug
 * @param {string} ingestionVersion
 * @returns {object}
 */
export function normalizeJoobleJob (raw, sourceSlug, ingestionVersion) {
  const title = typeof raw.title === 'string' ? raw.title : ''
  const snippet = stripJoobleHtml(raw.snippet)
  const location = typeof raw.location === 'string' ? raw.location : ''
  const bodyText = [snippet, location].filter(Boolean).join('\n')
  const summary =
    bodyText.length > 480 ? `${bodyText.slice(0, 477)}…` : bodyText

  const link = typeof raw.link === 'string' ? raw.link : null
  const company =
    typeof raw.company === 'string' && raw.company.trim()
      ? raw.company.trim()
      : null

  const keywords = []
  if (typeof raw.salary === 'string' && raw.salary.trim()) {
    keywords.push(raw.salary.trim())
  }
  if (typeof raw.type === 'string' && raw.type.trim()) {
    keywords.push(raw.type.trim())
  }
  if (typeof raw.source === 'string' && raw.source.trim()) {
    keywords.push(raw.source.trim())
  }

  const fetchedAt = new Date()

  return {
    source: sourceSlug,
    externalId: raw && raw.id != null ? String(raw.id) : '',
    title,
    slug: '',
    company,
    category: typeof raw.type === 'string' && raw.type ? raw.type : null,
    locationType: inferJoobleLocationType(`${title}\n${bodyText}`),
    addressLocality: location || null,
    addressCountry: null,
    experienceLevel: null,
    datePosted: parseJoobleUpdated(raw.updated),
    validThrough: undefined,
    keywords,
    skills: [],
    summary,
    content: bodyText,
    applyUrl: link,
    sourceUrl: link,
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
 * @param {object} raw — Jooble job row before normalization
 * @returns {boolean}
 */
export function matchesIgnoreStackForIngest (raw) {
  if (!raw || typeof raw !== 'object') return false
  const parts = [
    raw.title,
    stripJoobleHtml(raw.snippet),
    raw.type,
    raw.company
  ]
  const haystack = parts
    .filter((p) => p != null && String(p).length)
    .map((p) => String(p))
    .join('\n')
  if (!haystack.length) return false
  return IGNORE_STACK_REGEXES.some((re) => re.test(haystack))
}

export default class JoobleJobSource {
  /**
   * @param {object} [localConfig]
   * @param {object} [localConfig.config] — **`joobleApiKey`**, **`jobIngestionVersion`**
   */
  constructor (localConfig = {}) {
    this.config = localConfig.config || {}
    this.sourceSlug = 'jooble'
    this.normalize = this.normalize.bind(this)

    const key = this.config.joobleApiKey
    this._apiKey = key != null && key !== '' ? String(key) : ''

    this._searchQueries = PROFILE_STACK_SEARCH_QUERIES
    this._location = ''
    this._appendRemote = true
    this._maxPagesPerQuery = JOOBLE_DEFAULT_MAX_PAGES_PER_QUERY
  }

  normalize (raw) {
    const ingestionVersion = this.config.jobIngestionVersion || '1'
    return normalizeJoobleJob(raw, this.sourceSlug, ingestionVersion)
  }

  _searchUrl () {
    return `${JOOBLE_API_BASE}/${this._apiKey}`
  }

  _keywordsForQuery (query) {
    const base = String(query || '').trim()
    if (!base) return ''
    if (this._appendRemote && !/\bremote\b/i.test(base)) {
      return `${base} remote`
    }
    return base
  }

  /**
   * @param {object} body — POST JSON body
   * @returns {Promise<object>}
   */
  async _postSearch (body) {
    try {
      const { data } = await axios.post(this._searchUrl(), body, {
        headers: { 'Content-Type': 'application/json' }
      })
      return data
    } catch (err) {
      const status = err.response && err.response.status
      const statusText =
        (err.response && err.response.statusText) || err.message
      const detail =
        err.response &&
        err.response.data &&
        JSON.stringify(err.response.data).slice(0, 300)
      const extra = detail ? ` ${detail}` : ''
      throw new Error(
        `JoobleJobSource search failed: ${status || 'ERR'} ${statusText}${extra}`
      )
    }
  }

  /**
   * @param {string} keywords
   * @returns {Promise<object[]>}
   */
  async _fetchSearchPages (keywords) {
    const combined = []
    for (let page = 1; page <= this._maxPagesPerQuery; page += 1) {
      const body = {
        keywords,
        location: this._location,
        page: String(page),
        companysearch: 'false'
      }
      const payload = await this._postSearch(body)
      const rows = Array.isArray(payload.jobs) ? payload.jobs : []
      combined.push(...rows)
      if (rows.length < JOOBLE_JOBS_PER_PAGE) break
    }
    return combined
  }

  /**
   * @returns {Promise<object[]>}
   */
  async fetchVacancies () {
    if (!this._apiKey) {
      console.log(
        'JoobleJobSource.fetchVacancies: no API key (set JOOBLE_API_KEY), skipping'
      )
      return []
    }

    const payloads = await Promise.all(
      this._searchQueries.map((query) =>
        this._fetchSearchPages(this._keywordsForQuery(query))
      )
    )

    const byId = new Map()
    let rawRowCount = 0
    for (const batch of payloads) {
      rawRowCount += batch.length
      for (const raw of batch) {
        if (!raw || raw.id == null) continue
        const id = String(raw.id)
        if (!byId.has(id)) {
          byId.set(id, raw)
        }
      }
    }

    const deduped = [...byId.values()]
    const kept = deduped.filter((raw) => !matchesIgnoreStackForIngest(raw))
    const ignoredStackCount = deduped.length - kept.length
    const normalized = kept.map(this.normalize)

    let logMsg =
      `JoobleJobSource.fetchVacancies: ${normalized.length} unique vacancies` +
      ` (${this._searchQueries.length} queries, max_pages=${this._maxPagesPerQuery}` +
      (this._appendRemote ? ', append_remote' : '') +
      ')'
    if (rawRowCount !== deduped.length) {
      logMsg += ` (${rawRowCount} rows before dedupe)`
    }
    if (ignoredStackCount > 0) {
      logMsg += `; skipped ${ignoredStackCount} ignored-stack match(es)`
    }
    console.log(logMsg)
    return normalized
  }
}
