/**
 * X (Twitter API v2) — job leads from **`GET /2/tweets/search/recent`**.
 *
 * Authenticates with **`Authorization: Bearer`** using **`xApiBearerToken`** from app config
 * (set **`X_API_BEARER_TOKEN`** in `.env`, merged in `config/env/common.js`).
 * Optional **`X_API_MAX_RESULTS`** may be read from the environment in this module only
 * (not declared in `common.js`). Search **`query`** strings are defined in
 * {@link PROFILE_STACK_SEARCH_QUERIES} (one request per stack area).
 *
 * @see https://developer.x.com/en/docs/twitter-api/tweets/search/api-reference/get-tweets-search-recent
 */

import axios from 'axios'

/**
 * Hiring / job-post signals paired with each stack clause (X recent search).
 * @see https://developer.x.com/en/docs/twitter-api/tweets/search/integrate/build-a-query
 */
const X_HIRING_SIGNALS =
  '(hiring OR vacante OR vacantes OR #hiring OR #empleo OR job OR "we are hiring" OR buscamos)'

/**
 * One recent-search query per core area in `vacancy-scoring-prompt.md` (Profile Context).
 * Stack keywords use OR groups; each query also requires hiring signals and excludes retweets.
 */
export const PROFILE_STACK_SEARCH_QUERIES = [
  `(nodejs OR "node.js" OR express OR koa OR mongodb) ${X_HIRING_SIGNALS} -is:retweet`,
  `(react OR "next.js" OR nextjs OR vite OR tailwind) ${X_HIRING_SIGNALS} -is:retweet`,
  `(web3 OR dapp OR ipfs OR p2p OR "ai agent" OR "ai agents") ${X_HIRING_SIGNALS} -is:retweet`,
  `(jest OR vitest OR "unit test" OR "integration test") (node OR react OR javascript OR fullstack) ${X_HIRING_SIGNALS} -is:retweet`
]

const API_BASE = 'https://api.x.com/2'

/** Default `max_results` when config / env omit it (X.com allows 10–100). */
export const X_API_DEFAULT_MAX_RESULTS = 10

/** @deprecated Use {@link PROFILE_STACK_SEARCH_QUERIES}; kept for tests / backward references. */
export const X_RECENT_SEARCH_QUERY = PROFILE_STACK_SEARCH_QUERIES[0]

const X_RECENT_SEARCH_TWEET_FIELDS =
  'text,author_id,created_at,public_metrics'

function buildAuthorMap (includes) {
  const map = new Map()
  const users = includes && Array.isArray(includes.users) ? includes.users : []
  for (const u of users) {
    if (u && u.id != null) {
      map.set(String(u.id), u)
    }
  }
  return map
}

/**
 * @param {object} tweet
 * @param {object|null} author — user object from `includes.users` or null
 * @param {string} sourceSlug
 * @param {string} ingestionVersion
 */
export function normalizeXTweet (tweet, author, sourceSlug, ingestionVersion) {
  const text = typeof tweet.text === 'string' ? tweet.text : ''
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length) || text
  const title =
    firstLine.length > 140 ? `${firstLine.slice(0, 137)}…` : firstLine || '(no text)'

  const username =
    author && typeof author.username === 'string' && author.username
      ? author.username
      : null
  const externalId = tweet.id != null ? String(tweet.id) : ''
  const statusUrl = username
    ? `https://x.com/${username}/status/${externalId}`
    : `https://x.com/i/web/status/${externalId}`

  let datePosted
  console.log('tweet', tweet)
  if (typeof tweet.created_at === 'string') {
    const d = new Date(tweet.created_at)
    console.log('d', d.toDateString())
    if (!Number.isNaN(d.getTime())) datePosted = d
  }

  const entities = tweet.entities && typeof tweet.entities === 'object' ? tweet.entities : {}
  const hashtags = Array.isArray(entities.hashtags)
    ? entities.hashtags
      .map((h) => (h && h.tag != null ? String(h.tag) : ''))
      .filter(Boolean)
    : []

  let locationType = null
  if (/\bremote\b|\bremoto\b|\btelecommut/i.test(text)) {
    locationType = 'remoto'
  } else if (/\bhybrid\b|\bh[ií]brido\b/i.test(text)) {
    locationType = 'hibrido'
  } else if (/\bonsite\b|\bpresencial\b/i.test(text)) {
    locationType = 'presencial'
  }

  const company =
    author && typeof author.name === 'string' && author.name.trim()
      ? author.name.trim()
      : username
        ? `@${username}`
        : null

  const bodyText = text
  const summary =
    bodyText.length > 480 ? `${bodyText.slice(0, 477)}…` : bodyText

  const fetchedAt = new Date()

  return {
    source: sourceSlug,
    externalId,
    title,
    slug: '',
    company,
    category: null,
    locationType,
    addressLocality: null,
    addressCountry: null,
    experienceLevel: null,
    datePosted,
    validThrough: undefined,
    keywords: hashtags,
    skills: [],
    summary,
    content: bodyText,
    applyUrl: null,
    sourceUrl: statusUrl,
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

export default class XApiJobSource {
  /**
   * @param {object} [localConfig]
   * @param {object} [localConfig.config] — **`xApiBearerToken`** (required for fetch); optional **`xApiMaxResults`** for tests; **`jobIngestionVersion`**
   */
  constructor (localConfig = {}) {
    this.config = localConfig.config || {}
    this.sourceSlug = 'x'
    this.normalize = this.normalize.bind(this)

    const token = this.config.xApiBearerToken
    this._authToken =
      token != null && token !== '' ? String(token) : ''

    this._searchQueries = PROFILE_STACK_SEARCH_QUERIES

    this._maxResults = X_API_DEFAULT_MAX_RESULTS
  }

  /**
   * Maps a v2 tweet + optional author into the canonical vacancy document.
   *
   * @param {object} raw — tweet object from search `data[]`
   * @param {object|null} [author] — matching user from `includes.users`
   */
  normalize (raw, author = null) {
    const ingestionVersion = this.config.jobIngestionVersion || '1'
    return normalizeXTweet(raw, author, this.sourceSlug, ingestionVersion)
  }

  /**
   * Headers for X API v2 (**Bearer** app token).
   * @returns {Record<string, string>}
   */
  _buildAuthHeaders () {
    return {
      Authorization: `Bearer ${this._authToken}`
    }
  }

  /**
   * @param {string} path — e.g. `/tweets/search/recent`
   * @param {Record<string, string|number|null|undefined>} [query]
   */
  async _getJson (path, query = {}) {
    const rel = path.startsWith('/') ? path : `/${path}`
    const url = `${API_BASE}${rel}`
    const params = {}
    for (const [k, v] of Object.entries(query)) {
      if (v != null) params[k] = v
    }
    console.log('getJson url', url)
    console.log('getJson headers', this._buildAuthHeaders())
    console.log('getJson params', params)
    try {
      const { data } = await axios.get(url, {
        headers: this._buildAuthHeaders(),
        params
      })
      console.log('getJson data', data)
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
        `XApiJobSource ${path} failed: ${status || 'ERR'} ${statusText}${extra}`
      )
    }
  }

  /**
   * Runs one recent-search request per {@link PROFILE_STACK_SEARCH_QUERIES}, merges tweets,
   * dedupes by id, then normalizes. No-op when bearer token is missing.
   *
   * @returns {Promise<object[]>}
   */
  async fetchVacancies () {
    console.log('fetchVacancies start x-api')
    if (!this._authToken) {
      console.log(
        'XApiJobSource.fetchVacancies: no bearer token (set X_API_BEARER_TOKEN), skipping'
      )
      return []
    }

    const payloads = await Promise.all(
      this._searchQueries.map((query) =>
        this._getJson('/tweets/search/recent', {
          query,
          max_results: this._maxResults,
          'tweet.fields': X_RECENT_SEARCH_TWEET_FIELDS
        })
      )
    )

    const byId = new Map()
    let rawRowCount = 0
    for (const payload of payloads) {
      const rows = Array.isArray(payload.data) ? payload.data : []
      rawRowCount += rows.length
      const authorById = buildAuthorMap(payload.includes)
      for (const tweet of rows) {
        if (!tweet || tweet.id == null) continue
        const id = String(tweet.id)
        if (byId.has(id)) continue
        const author =
          tweet.author_id != null
            ? authorById.get(String(tweet.author_id)) || null
            : null
        byId.set(id, this.normalize(tweet, author))
      }
    }

    const normalized = [...byId.values()]
    let logMsg =
      `XApiJobSource.fetchVacancies: ${normalized.length} unique tweets` +
      ` (${this._searchQueries.length} queries, max_results=${this._maxResults})`
    if (rawRowCount !== normalized.length) {
      logMsg += ` (${rawRowCount} rows before dedupe)`
    }
    console.log(logMsg)
    return normalized
  }
}
