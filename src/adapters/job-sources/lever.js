/**
 * Lever Postings API — published jobs from **`GET /v0/postings/{site}`**.
 *
 * Public JSON listings (no API key for GET). Configure one or more Lever site slugs
 * via `LEVER_SITES` (comma-separated). The API has no full-text search; after each
 * site is paginated, rows are filtered client-side for stack profile keywords and
 * ignore-stack rules (aligned with `vacancy-scoring-prompt.md`).
 *
 * @see https://github.com/lever/postings-api
 */

import axios from 'axios'

/** Global postings API root (EU: `https://api.eu.lever.co/v0/postings`). */
export const LEVER_DEFAULT_API_BASE = 'https://api.lever.co/v0/postings'

/** Default `limit` query param per page. */
export const LEVER_DEFAULT_LIMIT = 100

/** Default max pages per site (`skip` += `limit` each page). */
export const LEVER_DEFAULT_MAX_PAGES_PER_SITE = 5

/**
 * Stack search phrases — used for client-side filtering (API has no full-text search).
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
export function stripLeverHtml (html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} workplaceType — `remote` | `hybrid` | `on-site` | `unspecified`
 * @returns {string|null}
 */
export function mapLeverWorkplaceType (workplaceType) {
  const w = String(workplaceType || '').toLowerCase()
  if (w === 'remote') return 'remoto'
  if (w === 'hybrid') return 'hibrido'
  if (w === 'on-site' || w === 'onsite') return 'presencial'
  return null
}

/**
 * @param {number|string|undefined} createdAt — epoch ms from API
 * @returns {Date|undefined}
 */
export function parseLeverCreatedAt (createdAt) {
  if (createdAt === undefined || createdAt === null || createdAt === '') {
    return undefined
  }
  const n = Number(createdAt)
  if (!Number.isFinite(n)) return undefined
  const d = new Date(n)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/**
 * @param {object} raw — Lever posting JSON
 * @returns {string}
 */
export function buildLeverBodyText (raw = {}) {
  const parts = [
    raw.descriptionPlain,
    raw.openingPlain,
    raw.descriptionBodyPlain,
    raw.additionalPlain
  ]
  const lists = Array.isArray(raw.lists) ? raw.lists : []
  for (const block of lists) {
    if (block && block.text) parts.push(String(block.text))
    if (block && block.content) parts.push(stripLeverHtml(block.content))
  }
  return parts
    .filter((p) => p != null && String(p).trim().length)
    .map((p) => String(p).trim())
    .join('\n\n')
}

/**
 * True when at least two tokens from any profile query appear in the haystack.
 *
 * @param {string} haystack
 * @param {string[]} [queries]
 * @returns {boolean}
 */
export function matchesStackProfile (haystack, queries = PROFILE_STACK_SEARCH_QUERIES) {
  const text = String(haystack || '').toLowerCase()
  if (!text.length) return false

  for (const query of queries) {
    const tokens = String(query)
      .toLowerCase()
      .split(/[\s,]+/)
      .map((t) => t.replace(/[^a-z0-9.#+]/g, ''))
      .filter((t) => t.length > 2)
    if (tokens.length === 0) continue

    let hits = 0
    for (const token of tokens) {
      if (token.length <= 2) continue
      if (text.includes(token)) hits += 1
    }
    if (hits >= 2) return true
  }
  return false
}

/**
 * @param {object} raw
 * @returns {boolean}
 */
export function matchesIgnoreStackForIngest (raw) {
  if (!raw || typeof raw !== 'object') return false
  const haystack = [
    raw.text,
    buildLeverBodyText(raw),
    raw.categories && raw.categories.team,
    raw.categories && raw.categories.department
  ]
    .filter((p) => p != null && String(p).length)
    .map((p) => String(p))
    .join('\n')
  if (!haystack.length) return false
  return IGNORE_STACK_REGEXES.some((re) => re.test(haystack))
}

/**
 * @param {object} raw — Lever posting
 * @param {string} siteSlug — Lever site name
 * @param {string} sourceSlug
 * @param {string} ingestionVersion
 */
export function normalizeLeverPosting (raw, siteSlug, sourceSlug, ingestionVersion) {
  const title = typeof raw.text === 'string' ? raw.text : ''
  const categories =
    raw.categories && typeof raw.categories === 'object' ? raw.categories : {}

  const bodyText = buildLeverBodyText(raw)
  const summary =
    bodyText.length > 480 ? `${bodyText.slice(0, 477)}…` : bodyText

  const hostedUrl =
    typeof raw.hostedUrl === 'string' && raw.hostedUrl ? raw.hostedUrl : null
  const applyUrl =
    typeof raw.applyUrl === 'string' && raw.applyUrl ? raw.applyUrl : null

  const keywords = []
  for (const key of ['commitment', 'team', 'department']) {
    const v = categories[key]
    if (v != null && String(v).trim()) keywords.push(String(v).trim())
  }
  if (typeof raw.country === 'string' && raw.country.trim()) {
    keywords.push(raw.country.trim())
  }

  const location =
    typeof categories.location === 'string' ? categories.location : null

  let locationType = mapLeverWorkplaceType(raw.workplaceType)
  if (!locationType) {
    locationType = inferLocationFromText(`${title}\n${bodyText}\n${location || ''}`)
  }

  const fetchedAt = new Date()

  return {
    source: sourceSlug,
    externalId: raw && raw.id != null ? String(raw.id) : '',
    title,
    slug: '',
    company: siteSlug || null,
    category:
      typeof categories.team === 'string'
        ? categories.team
        : typeof categories.department === 'string'
          ? categories.department
          : null,
    locationType,
    addressLocality: location,
    addressCountry:
      typeof raw.country === 'string' && raw.country ? raw.country : null,
    experienceLevel: null,
    datePosted: parseLeverCreatedAt(raw.createdAt),
    validThrough: undefined,
    keywords,
    skills: [],
    summary,
    content: bodyText,
    applyUrl,
    sourceUrl: hostedUrl,
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
 * @param {string} text
 * @returns {string|null}
 */
function inferLocationFromText (text) {
  const t = String(text || '')
  if (/\bremote\b|\bremoto\b|\btelecommut/i.test(t)) return 'remoto'
  if (/\bhybrid\b|\bh[ií]brido\b/i.test(t)) return 'hibrido'
  if (/\bonsite\b|\bon-site\b|\bpresencial\b/i.test(t)) return 'presencial'
  return null
}

/**
 * @param {string} envValue — comma-separated site slugs
 * @returns {string[]}
 */
export function parseLeverSites (envValue) {
  if (envValue == null || envValue === '') return []
  return String(envValue)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export default class LeverJobSource {
  /**
   * @param {object} [localConfig]
   * @param {object} [localConfig.config]
   */
  constructor (localConfig = {}) {
    this.config = localConfig.config || {}
    this.sourceSlug = 'lever'
    this.normalize = this.normalize.bind(this)

    this._apiBase = (
      this.config.leverApiBaseUrl || LEVER_DEFAULT_API_BASE
    ).replace(/\/$/, '')

    this._sites = Array.isArray(this.config.leverSites)
      ? this.config.leverSites
      : parseLeverSites(this.config.leverSites)

    this._teams = Array.isArray(this.config.leverTeams)
      ? this.config.leverTeams.filter(Boolean)
      : parseLeverSites(this.config.leverTeams)

    let limit = this.config.leverLimit
    if (limit != null) limit = parseInt(limit, 10)
    if (!Number.isFinite(limit) || limit < 1) {
      limit = LEVER_DEFAULT_LIMIT
    }
    this._limit = limit

    let maxPages = this.config.leverMaxPagesPerSite
    if (maxPages != null) maxPages = parseInt(maxPages, 10)
    if (!Number.isFinite(maxPages) || maxPages < 1) {
      maxPages = LEVER_DEFAULT_MAX_PAGES_PER_SITE
    }
    this._maxPagesPerSite = maxPages

    this._remoteOnly = this.config.leverRemoteOnly !== false
  }

  normalize (raw, siteSlug) {
    const ingestionVersion = this.config.jobIngestionVersion || '1'
    return normalizeLeverPosting(
      raw,
      siteSlug,
      this.sourceSlug,
      ingestionVersion
    )
  }

  /**
   * @param {string} site
   * @param {number} skip
   */
  async _getPostingsPage (site, skip) {
    const url = `${this._apiBase}/${encodeURIComponent(site)}`
    const params = new URLSearchParams()
    params.set('mode', 'json')
    params.set('limit', String(this._limit))
    params.set('skip', String(skip))
    for (const team of this._teams) {
      params.append('team', team)
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
        `LeverJobSource ${site} failed: ${status || 'ERR'} ${statusText}${extra}`
      )
    }
  }

  /**
   * @param {string} site
   * @returns {Promise<object[]>}
   */
  async _fetchSitePostings (site) {
    const combined = []
    for (let page = 0; page < this._maxPagesPerSite; page += 1) {
      const skip = page * this._limit
      const payload = await this._getPostingsPage(site, skip)
      const rows = Array.isArray(payload) ? payload : []
      combined.push(...rows)
      if (rows.length < this._limit) break
    }
    return combined
  }

  /**
   * @returns {Promise<object[]>}
   */
  async fetchVacancies () {
    if (!this._sites.length) {
      console.log(
        'LeverJobSource.fetchVacancies: no sites (set LEVER_SITES), skipping'
      )
      return []
    }

    const payloads = await Promise.all(
      this._sites.map((site) => this._fetchSitePostings(site))
    )

    const byId = new Map()
    let rawRowCount = 0
    let skippedStack = 0
    let skippedRemote = 0
    let skippedIgnore = 0

    for (let i = 0; i < payloads.length; i += 1) {
      const site = this._sites[i]
      const batch = payloads[i]
      rawRowCount += batch.length

      for (const raw of batch) {
        if (!raw || raw.id == null) continue

        if (this._remoteOnly) {
          const w = String(raw.workplaceType || '').toLowerCase()
          if (w === 'on-site' || w === 'onsite') {
            skippedRemote += 1
            continue
          }
        }
        if (matchesIgnoreStackForIngest(raw)) {
          skippedIgnore += 1
          continue
        }

        const haystack = [
          raw.text,
          buildLeverBodyText(raw),
          raw.categories && raw.categories.location
        ]
          .filter(Boolean)
          .join('\n')
        if (!matchesStackProfile(haystack)) {
          skippedStack += 1
          continue
        }

        const id = String(raw.id)
        if (!byId.has(id)) {
          byId.set(id, { raw, site })
        }
      }
    }

    const normalized = [...byId.values()].map(({ raw, site }) =>
      this.normalize(raw, site)
    )

    let logMsg =
      `LeverJobSource.fetchVacancies: ${normalized.length} unique vacancies` +
      ` (${this._sites.length} site(s), limit=${this._limit}, max_pages=${this._maxPagesPerSite}`
    if (this._teams.length) {
      logMsg += `, teams=${this._teams.join('|')}`
    }
    if (this._remoteOnly) {
      logMsg += ', remote_only'
    }
    logMsg += ')'
    if (rawRowCount !== normalized.length) {
      logMsg += ` (${rawRowCount} rows before filter/dedupe`
      const parts = []
      if (skippedRemote) parts.push(`${skippedRemote} on-site`)
      if (skippedIgnore) parts.push(`${skippedIgnore} ignore-stack`)
      if (skippedStack) parts.push(`${skippedStack} stack-filter`)
      if (parts.length) logMsg += `; skipped ${parts.join(', ')}`
      logMsg += ')'
    }
    console.log(logMsg)
    return normalized
  }
}
