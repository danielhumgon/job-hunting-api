/**
 * Get on Board — public job listings from **`GET /api/v0/search/jobs`**.
 *
 * No authentication required. One search request per stack query in
 * {@link PROFILE_STACK_SEARCH_QUERIES} (aligned with `vacancy-scoring-prompt.md`),
 * paginated until `meta.total_pages` is exhausted, then merged and deduped by job `id`.
 *
 * @see https://www.getonbrd.com/api-doc.html
 */

import axios from 'axios'

/** Production API root (trailing slash stripped before requests). */
export const GETONBRD_DEFAULT_API_BASE = 'https://www.getonbrd.com/api/v0'

/** Default page size for search (API max is 120). */
export const GETONBRD_DEFAULT_PER_PAGE = 50

/**
 * One stack phrase per core area in `vacancy-scoring-prompt.md` (Profile Context).
 * Each phrase is split into words for {@link PROFILE_STACK_SEARCH_QUERIES}.
 */
export const PROFILE_STACKS = [
  'Node.js Express Koa MongoDB',
  'React Next.js Vite Tailwind CSS',
  'web3 dApp'
]

/**
 * @param {string[]} stacks — space-separated stack phrases
 * @returns {string[]} one search query per word
 */
export function profileStackSearchQueriesFromStacks (stacks) {
  return stacks.flatMap((stack) =>
    String(stack)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  )
}

/** One Get on Board `query` per stack term (words from {@link PROFILE_STACKS}). */
export const PROFILE_STACK_SEARCH_QUERIES =
  profileStackSearchQueriesFromStacks(PROFILE_STACKS)

/**
 * Ingest drops vacancies whose title or body match these stacks (case-insensitive).
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

/**
 * @param {object} attrs — job `attributes` from Get on Board API
 * @returns {string}
 */
export function buildGetOnBrdBodyText (attrs = {}) {
  const parts = [
    attrs.description,
    attrs.functions,
    attrs.desirable,
    attrs.benefits,
    attrs.projects
  ]
  return parts
    .filter((p) => p != null && String(p).trim().length)
    .map((p) => String(p).trim())
    .join('\n\n')
}

/**
 * @param {object} attrs
 * @returns {string|null}
 */
export function mapGetOnBrdLocationType (attrs = {}) {
  if (attrs.remote === true) return 'remoto'
  const mod = String(attrs.remote_modality || '').toLowerCase()
  if (mod.includes('hybrid') || mod === 'hybrid_partial') return 'hibrido'
  if (mod.includes('remote') && mod !== 'no_remote') return 'remoto'
  if (mod === 'no_remote' || mod === 'onsite' || mod === 'in_office') {
    return 'presencial'
  }
  return null
}

/**
 * @param {number|string|undefined} publishedAt — Unix epoch seconds
 * @returns {Date|undefined}
 */
export function parseGetOnBrdPublishedAt (publishedAt) {
  if (publishedAt === undefined || publishedAt === null || publishedAt === '') {
    return undefined
  }
  const n = Number(publishedAt)
  if (!Number.isFinite(n)) return undefined
  const ms = n < 1e12 ? n * 1000 : n
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/**
 * @param {object} raw — API job resource `{ id, type, attributes, links? }`
 * @param {string} sourceSlug
 * @param {string} ingestionVersion
 * @returns {object}
 */
export function normalizeGetOnBrdJob (raw, sourceSlug, ingestionVersion) {
  const attrs =
    raw && typeof raw.attributes === 'object' ? raw.attributes : {}
  const links = raw && typeof raw.links === 'object' ? raw.links : {}

  const bodyText = buildGetOnBrdBodyText(attrs)
  const summary =
    bodyText.length > 480 ? `${bodyText.slice(0, 477)}…` : bodyText

  const publicUrl =
    typeof links.public_url === 'string' && links.public_url
      ? links.public_url
      : null

  let slug = ''
  if (publicUrl) {
    const m = publicUrl.match(/\/jobs\/([^/?#]+)/i)
    if (m) slug = m[1]
  }

  const countries = Array.isArray(attrs.countries)
    ? attrs.countries.map((c) => String(c)).filter(Boolean)
    : []

  const perks = Array.isArray(attrs.perks)
    ? attrs.perks.map((p) => String(p)).filter(Boolean)
    : []

  const keywords = [
    ...(attrs.category_name ? [String(attrs.category_name)] : []),
    ...perks
  ]

  const fetchedAt = new Date()

  return {
    source: sourceSlug,
    externalId: raw && raw.id != null ? String(raw.id) : '',
    title: typeof attrs.title === 'string' ? attrs.title : '',
    slug,
    company: null,
    category:
      typeof attrs.category_name === 'string' ? attrs.category_name : null,
    locationType: mapGetOnBrdLocationType(attrs),
    addressLocality: null,
    addressCountry: countries.length ? countries.join(', ') : null,
    experienceLevel: null,
    datePosted: parseGetOnBrdPublishedAt(attrs.published_at),
    validThrough: undefined,
    keywords,
    skills: [],
    summary,
    content: bodyText,
    applyUrl: publicUrl,
    sourceUrl: publicUrl,
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
 * @param {object} raw — API job resource before normalization
 * @returns {boolean}
 */
export function matchesIgnoreStackForIngest (raw) {
  if (!raw || typeof raw !== 'object') return false
  const attrs =
    typeof raw.attributes === 'object' ? raw.attributes : {}
  const parts = [
    attrs.title,
    buildGetOnBrdBodyText(attrs),
    ...(Array.isArray(attrs.perks) ? attrs.perks : []),
    attrs.category_name
  ]
  const haystack = parts
    .filter((p) => p != null && String(p).length)
    .map((p) => String(p))
    .join('\n')
  if (!haystack.length) return false
  return IGNORE_STACK_REGEXES.some((re) => re.test(haystack))
}

export default class GetOnBrdJobSource {
  /**
   * @param {object} [localConfig]
   * @param {object} [localConfig.config] — **`jobIngestionVersion`**
   */
  constructor (localConfig = {}) {
    this.config = localConfig.config || {}
    this.sourceSlug = 'getonbrd'
    this.normalize = this.normalize.bind(this)

    this.baseUrl = GETONBRD_DEFAULT_API_BASE
    this._searchQueries = PROFILE_STACK_SEARCH_QUERIES
    this._lang = 'en'
    this._remoteOnly = true
    this._perPage = GETONBRD_DEFAULT_PER_PAGE
  }

  /**
   * @param {object} raw — job resource from `data[]`
   */
  normalize (raw) {
    const ingestionVersion = this.config.jobIngestionVersion || '1'
    return normalizeGetOnBrdJob(raw, this.sourceSlug, ingestionVersion)
  }

  /**
   * @param {string} resourcePath — path under `/api/v0/` (e.g. `search/jobs`)
   * @param {Record<string, string|number|boolean|null|undefined>} [query]
   */
  async _getJson (resourcePath, query = {}) {
    const url = `${this.baseUrl}/${resourcePath.replace(/^\//, '')}`
    const params = {}
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params[key] = value
      }
    }
    try {
      const { data } = await axios.get(url, {
        params,
        headers: { Accept: 'application/json' }
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
        `GetOnBrdJobSource ${resourcePath} failed: ${status || 'ERR'} ${statusText}${extra}`
      )
    }
  }

  /**
   * Fetches every page for one search `query`.
   *
   * @param {string} query
   * @returns {Promise<object[]>}
   */
  async _fetchSearchPages (query) {
    const combined = []
    let page = 1
    let totalPages = 1

    do {
      const q = {
        query,
        lang: this._lang,
        page,
        per_page: this._perPage
      }
      if (this._remoteOnly) {
        q.remote = 'true'
      }

      const payload = await this._getJson('search/jobs', q)
      const rows = Array.isArray(payload.data) ? payload.data : []
      combined.push(...rows)

      const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {}
      totalPages = Math.max(1, parseInt(meta.total_pages, 10) || 1)
      page += 1
    } while (page <= totalPages)

    return combined
  }

  /**
   * Runs {@link PROFILE_STACK_SEARCH_QUERIES}, paginates each search, dedupes by `id`,
   * drops ignore-stack matches, then normalizes.
   *
   * @returns {Promise<object[]>}
   */
  async fetchVacancies () {
    const payloads = await Promise.all(
      this._searchQueries.map((query) => this._fetchSearchPages(query))
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
      `GetOnBrdJobSource.fetchVacancies: ${normalized.length} unique vacancies` +
      ` (${this._searchQueries.length} queries, per_page=${this._perPage}` +
      (this._remoteOnly ? ', remote=true' : '') +
      `, lang=${this._lang})`
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
