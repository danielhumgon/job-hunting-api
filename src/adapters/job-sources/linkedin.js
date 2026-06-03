/**
 * LinkedIn — job listings via Apify actor **`worldunboxer~rapid-linkedin-scraper`**.
 *
 * Starts a cloud scrape per stack query, waits for completion, then reads the run dataset.
 * Requires `APIFY_API_TOKEN` (Apify API token in query string).
 *
 * @see https://apify.com/worldunboxer/rapid-linkedin-scraper
 * @see https://docs.apify.com/api/v2
 */

import axios from 'axios'

export const APIFY_API_BASE = 'https://api.apify.com/v2'

/** Default actor id (username~name per Apify REST API). */
export const LINKEDIN_DEFAULT_ACTOR_ID = 'worldunboxer~rapid-linkedin-scraper'

/** Default jobs per Apify run (`jobs_entries`). */
export const LINKEDIN_DEFAULT_MAX_ITEMS_PER_QUERY = 20

/** Default search location passed to the actor. */
export const LINKEDIN_DEFAULT_LOCATION = 'Worldwide'

/** Max wait for `run-sync-get-dataset-items` (Apify allows up to 300s). */
export const LINKEDIN_SYNC_TIMEOUT_MS = 300000

/** Poll interval when async run does not finish within sync window. */
export const LINKEDIN_DEFAULT_POLL_INTERVAL_MS = 5000

/** Max poll rounds after async start (~5 min at 5s). */
export const LINKEDIN_DEFAULT_POLL_MAX_ATTEMPTS = 60

/** Apify actor `posted_within` — scrape only recent listings. */
export const LINKEDIN_DEFAULT_POSTED_WITHIN = 'Past Month'

/** Drop ingested rows when `datePosted` is older than this many days. */
export const LINKEDIN_MAX_POST_AGE_DAYS = 30

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

const TERMINAL_RUN_STATUSES = new Set([
  'SUCCEEDED',
  'FAILED',
  'ABORTED',
  'TIMED-OUT',
  'TIMED_OUT'
])

/**
 * @param {object} raw
 * @param {string[]} keys
 * @returns {*}
 */
export function pickLinkedInField (raw, keys) {
  if (!raw || typeof raw !== 'object') return null
  for (const key of keys) {
    const v = raw[key]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return null
}

/**
 * @param {object} raw
 * @returns {string}
 */
export function buildLinkedInBodyText (raw = {}) {
  const description = pickLinkedInField(raw, [
    'job_description',
    'jobDescription',
    'Job Description',
    'description'
  ])
  const salary = pickLinkedInField(raw, [
    'salary_range',
    'salaryRange',
    'Salary Range',
    'salary'
  ])
  const applicants = pickLinkedInField(raw, [
    'applicants',
    'Applicants'
  ])
  const parts = [description, salary, applicants]
    .filter((p) => p != null && String(p).trim().length)
    .map((p) => String(p).trim())
  return parts.join('\n\n')
}

/**
 * @param {string} text
 * @returns {string|null}
 */
export function inferLinkedInLocationType (text) {
  const t = String(text || '')
  if (/\bremote\b|\bremoto\b|\bwork from anywhere\b|\bworldwide\b/i.test(t)) {
    return 'remoto'
  }
  if (/\bhybrid\b|\bh[ií]brido\b/i.test(t)) return 'hibrido'
  if (/\bonsite\b|\bon-site\b|\bpresencial\b|\bin[- ]office\b/i.test(t)) {
    return 'presencial'
  }
  return null
}

/**
 * @param {Date} now
 * @param {number} amount
 * @param {'minute'|'hour'|'day'|'week'|'month'} unit
 * @returns {Date}
 */
export function subtractLinkedInTimeUnit (now, amount, unit) {
  const d = new Date(now)
  const n = Math.max(0, Number(amount) || 0)
  switch (unit) {
    case 'minute':
      d.setMinutes(d.getMinutes() - n)
      break
    case 'hour':
      d.setHours(d.getHours() - n)
      break
    case 'day':
      d.setDate(d.getDate() - n)
      break
    case 'week':
      d.setDate(d.getDate() - n * 7)
      break
    case 'month':
      d.setMonth(d.getMonth() - n)
      break
    default:
      break
  }
  return d
}

/**
 * Parses LinkedIn relative posting strings (e.g. `"2 days ago"`, `"hace 1 semana"`).
 *
 * @param {string|number|Date|undefined} value
 * @param {Date} [now]
 * @returns {Date|undefined}
 */
export function parseLinkedInRelativeTimePosted (value, now = new Date()) {
  const s = String(value || '').trim().toLowerCase()
  if (!s) return undefined

  if (/^(just now|today|ahora|hoy|recientemente|reposted)$/i.test(s)) {
    return new Date(now)
  }

  let m = s.match(/^(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/)
  if (m) return subtractLinkedInTimeUnit(now, parseInt(m[1], 10), m[2])

  m = s.match(/^an?\s+(minute|hour|day|week|month)\s+ago$/)
  if (m) return subtractLinkedInTimeUnit(now, 1, m[1])

  m = s.match(
    /^hace\s+(\d+)\s+(minuto|minutos|hora|horas|d[ií]a|d[ií]as|semana|semanas|mes|meses)$/
  )
  if (m) {
    const unit = m[2].startsWith('minut')
      ? 'minute'
      : m[2].startsWith('hor')
        ? 'hour'
        : m[2].startsWith('d')
          ? 'day'
          : m[2].startsWith('seman')
            ? 'week'
            : 'month'
    return subtractLinkedInTimeUnit(now, parseInt(m[1], 10), unit)
  }

  m = s.match(/^hace\s+(?:un|una)\s+(minuto|hora|d[ií]a|semana|mes)$/)
  if (m) {
    const unit = m[1].startsWith('minut')
      ? 'minute'
      : m[1].startsWith('hor')
        ? 'hour'
        : m[1].startsWith('d')
          ? 'day'
          : m[1].startsWith('seman')
            ? 'week'
            : 'month'
    return subtractLinkedInTimeUnit(now, 1, unit)
  }

  return undefined
}

/**
 * @param {string|number|Date|undefined} value
 * @param {Date} [now]
 * @returns {Date|undefined}
 */
export function parseLinkedInDatePosted (value, now = new Date()) {
  if (value === undefined || value === null || value === '') return undefined
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value

  const relative = parseLinkedInRelativeTimePosted(value, now)
  if (relative) return relative

  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/**
 * @param {object} raw
 * @returns {string}
 */
export function buildLinkedInIngestHaystack (raw = {}) {
  return [
    pickLinkedInField(raw, ['job_title', 'jobTitle', 'Job Title', 'title']),
    buildLinkedInBodyText(raw),
    pickLinkedInField(raw, ['job_function', 'jobFunction', 'Job Function'])
  ]
    .filter((p) => p != null && String(p).length)
    .map((p) => String(p))
    .join('\n')
}

/**
 * @param {object} raw
 * @param {number} [maxAgeDays]
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isLinkedInPostTooOld (
  raw,
  maxAgeDays = LINKEDIN_MAX_POST_AGE_DAYS,
  now = new Date()
) {
  const timePosted = pickLinkedInField(raw, [
    'time_posted',
    'timePosted',
    'Time Posted',
    'postedDate',
    'datePosted'
  ])
  const posted = parseLinkedInDatePosted(timePosted, now)
  if (!posted) return false

  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - maxAgeDays)
  return posted < cutoff
}

/**
 * Flatten Apify dataset payload into job row objects.
 *
 * @param {unknown} payload — array from sync endpoint or dataset items
 * @returns {object[]}
 */
export function flattenLinkedInDatasetItems (payload) {
  if (!payload) return []
  if (Array.isArray(payload)) {
    const rows = []
    for (const item of payload) {
      rows.push(...flattenLinkedInDatasetItems(item))
    }
    return rows
  }
  if (typeof payload !== 'object') return []

  const jobsField = payload.jobs
  if (Array.isArray(jobsField)) {
    return jobsField.filter((j) => j && typeof j === 'object')
  }
  if (typeof jobsField === 'string' && jobsField.trim()) {
    try {
      const parsed = JSON.parse(jobsField)
      return flattenLinkedInDatasetItems(parsed)
    } catch {
      return []
    }
  }

  const title = pickLinkedInField(payload, [
    'job_title',
    'jobTitle',
    'Job Title',
    'title'
  ])
  const id = pickLinkedInField(payload, [
    'job_id',
    'jobId',
    'Job ID',
    'id'
  ])
  if (title != null || id != null) {
    return [payload]
  }

  return []
}

/**
 * @param {object} raw
 * @param {string} sourceSlug
 * @param {string} ingestionVersion
 * @returns {object}
 */
export function normalizeLinkedInJob (raw, sourceSlug, ingestionVersion) {
  const title =
    String(
      pickLinkedInField(raw, ['job_title', 'jobTitle', 'Job Title', 'title']) ||
        ''
    )
  const location =
    pickLinkedInField(raw, [
      'job_location',
      'jobLocation',
      'Job Location',
      'location'
    ]) || ''
  const bodyText = buildLinkedInBodyText(raw)
  const haystack = [title, location, bodyText].filter(Boolean).join('\n')
  const summary =
    haystack.length > 480 ? `${haystack.slice(0, 477)}…` : haystack

  const sourceUrl = pickLinkedInField(raw, [
    'job_url',
    'jobUrl',
    'Job Url',
    'url',
    'link'
  ])
  const applyUrl = pickLinkedInField(raw, [
    'apply_url',
    'applyUrl',
    'Apply Url'
  ])
  const company = pickLinkedInField(raw, [
    'company_name',
    'companyName',
    'Company Name',
    'company'
  ])
  const salary = pickLinkedInField(raw, [
    'salary_range',
    'salaryRange',
    'Salary Range',
    'salary'
  ])
  const seniority = pickLinkedInField(raw, [
    'seniority_level',
    'seniorityLevel',
    'Seniority Level',
    'experience_level'
  ])
  const employment = pickLinkedInField(raw, [
    'employment_type',
    'employmentType',
    'Employment Type'
  ])
  const industry = pickLinkedInField(raw, [
    'industry_type',
    'industryType',
    'Industry Type'
  ])
  const jobFunction = pickLinkedInField(raw, [
    'job_function',
    'jobFunction',
    'Job Function'
  ])

  const keywords = []
  for (const k of [salary, employment, industry, jobFunction]) {
    if (k != null && String(k).trim()) keywords.push(String(k).trim())
  }

  const externalId = pickLinkedInField(raw, [
    'job_id',
    'jobId',
    'Job ID',
    'id'
  ])

  return {
    source: sourceSlug,
    externalId: externalId != null ? String(externalId) : '',
    title,
    slug: '',
    company: company != null ? String(company) : null,
    category: jobFunction != null ? String(jobFunction) : null,
    locationType: inferLinkedInLocationType(haystack),
    addressLocality: location ? String(location) : null,
    addressCountry: null,
    experienceLevel: seniority != null ? String(seniority) : null,
    datePosted: parseLinkedInDatePosted(
      pickLinkedInField(raw, [
        'time_posted',
        'timePosted',
        'Time Posted',
        'postedDate',
        'datePosted'
      ])
    ),
    validThrough: undefined,
    keywords,
    skills: [],
    summary,
    content: bodyText || haystack,
    applyUrl: applyUrl != null ? String(applyUrl) : sourceUrl,
    sourceUrl: sourceUrl != null ? String(sourceUrl) : null,
    fetchedAt: new Date(),
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
 * @param {object} raw
 * @returns {boolean}
 */
export function matchesIgnoreStackForIngest (raw) {
  if (!raw || typeof raw !== 'object') return false
  const haystack = buildLinkedInIngestHaystack(raw)
  if (!haystack.length) return false
  return IGNORE_STACK_REGEXES.some((re) => re.test(haystack))
}

/**
 * @param {object} run — Apify run object (`data` wrapper or bare)
 * @returns {object}
 */
export function unwrapApifyRun (run) {
  if (run && typeof run === 'object' && run.data && typeof run.data === 'object') {
    return run.data
  }
  return run || {}
}

export default class LinkedInJobSource {
  /**
   * @param {object} [localConfig]
   * @param {object} [localConfig.config] — **`apifyApiToken`**, **`jobIngestionVersion`**
   */
  constructor (localConfig = {}) {
    this.config = localConfig.config || {}
    this.sourceSlug = 'linkedin'
    this.normalize = this.normalize.bind(this)

    const token = this.config.apifyApiToken
    this._apiToken = token != null && token !== '' ? String(token) : ''

    this._actorId = LINKEDIN_DEFAULT_ACTOR_ID
    this._location = LINKEDIN_DEFAULT_LOCATION
    this._maxItemsPerQuery = LINKEDIN_DEFAULT_MAX_ITEMS_PER_QUERY
    this._pollIntervalMs = LINKEDIN_DEFAULT_POLL_INTERVAL_MS
    this._pollMaxAttempts = LINKEDIN_DEFAULT_POLL_MAX_ATTEMPTS
    this._postedWithin = LINKEDIN_DEFAULT_POSTED_WITHIN
    this._maxPostAgeDays = LINKEDIN_MAX_POST_AGE_DAYS
    this._searchQueries = PROFILE_STACK_SEARCH_QUERIES
    this._useApifyProxy = true
  }

  normalize (raw) {
    const ingestionVersion = this.config.jobIngestionVersion || '1'
    return normalizeLinkedInJob(raw, this.sourceSlug, ingestionVersion)
  }

  _authQuery () {
    return { token: this._apiToken }
  }

  /**
   * Actor input per Apify OpenAPI schema (`job_title`, `location`, `jobs_entries`).
   *
   * @param {string} searchKeywords
   * @returns {object}
   */
  _buildActorInput (searchKeywords) {
    const input = {
      job_title: String(searchKeywords || '').trim(),
      location: this._location,
      jobs_entries: this._maxItemsPerQuery,
      start_jobs: 0,
      posted_within: this._postedWithin
    }
    if (this._useApifyProxy) {
      input.proxyConfiguration = { useApifyProxy: true }
    }
    return input
  }

  /**
   * @param {string} method
   * @param {string} urlPath — path after `/v2/` (no leading slash)
   * @param {object} [options]
   * @param {object} [options.params]
   * @param {object} [options.data]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<object>}
   */
  async _apifyRequest (method, urlPath, options = {}) {
    const url = `${APIFY_API_BASE}/${urlPath.replace(/^\//, '')}`
    const params = { ...this._authQuery(), ...(options.params || {}) }
    console.log('apify request method', method)
    console.log('apify request url', url)
    console.log('apify request params', params)
    try {
      const res = await axios.request({
        method,
        url,
        params,
        data: options.data,
        timeout: options.timeoutMs ?? 30000,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        validateStatus: (s) => s >= 200 && s < 300
      })
      console.log('apify request data', res.data)
      return res.data
    } catch (err) {
      console.log('apify request error', err)
      const status = err.response && err.response.status
      const statusText =
        (err.response && err.response.statusText) || err.message
      const detail =
        err.response &&
        err.response.data &&
        JSON.stringify(err.response.data).slice(0, 300)
      const extra = detail ? ` ${detail}` : ''
      throw new Error(
        `LinkedInJobSource ${urlPath} failed: ${status || 'ERR'} ${statusText}${extra}`
      )
    }
  }

  /**
   * @param {object} input
   * @returns {Promise<object[]>}
   */
  async _runSyncGetDatasetItems (input) {
    const path = `acts/${this._actorId}/run-sync-get-dataset-items`
    const data = await this._apifyRequest('post', path, {
      data: input,
      timeoutMs: LINKEDIN_SYNC_TIMEOUT_MS
    })
    return flattenLinkedInDatasetItems(data)
  }

  /**
   * @param {object} input
   * @returns {Promise<object>}
   */
  async _startActorRun (input) {
    const path = `acts/${this._actorId}/runs`
    const data = await this._apifyRequest('post', path, {
      data: input,
      params: { waitForFinish: 0 }
    })
    return unwrapApifyRun(data)
  }

  /**
   * @param {string} runId
   * @param {number} [waitForFinish]
   * @returns {Promise<object>}
   */
  async _getActorRun (runId, waitForFinish = 60) {
    const path = `actor-runs/${runId}`
    const data = await this._apifyRequest('get', path, {
      params: { waitForFinish }
    })
    return unwrapApifyRun(data)
  }

  /**
   * @param {string} datasetId
   * @returns {Promise<object[]>}
   */
  async _getDatasetItems (datasetId) {
    const path = `datasets/${datasetId}/items`
    const data = await this._apifyRequest('get', path, {
      params: { clean: true }
    })
    return flattenLinkedInDatasetItems(data)
  }

  /**
   * @param {object} input
   * @returns {Promise<object[]>}
   */
  async _fetchWithAsyncPoll (input) {
    const started = await this._startActorRun(input)
    const runId = started.id
    if (!runId) {
      throw new Error('LinkedInJobSource: Apify run missing id')
    }

    let run = started
    for (let attempt = 0; attempt < this._pollMaxAttempts; attempt += 1) {
      const status = String(run.status || '')
      if (TERMINAL_RUN_STATUSES.has(status)) {
        if (status !== 'SUCCEEDED') {
          throw new Error(
            `LinkedInJobSource: Apify run ${runId} ended with status ${status}`
          )
        }
        const datasetId = run.defaultDatasetId
        if (!datasetId) {
          throw new Error('LinkedInJobSource: Apify run missing defaultDatasetId')
        }
        return this._getDatasetItems(datasetId)
      }
      await new Promise((resolve) => setTimeout(resolve, this._pollIntervalMs))
      run = await this._getActorRun(runId, 60)
    }

    throw new Error(
      `LinkedInJobSource: Apify run ${runId} did not finish within poll budget`
    )
  }

  /**
   * @param {string} searchKeywords
   * @returns {Promise<object[]>}
   */
  async _fetchForQuery (searchKeywords) {
    const input = this._buildActorInput(searchKeywords)
    try {
      return await this._runSyncGetDatasetItems(input)
    } catch (err) {
      const msg = String(err.message || '')
      const retryAsync =
        msg.includes('408') ||
        msg.includes('504') ||
        /timeout/i.test(msg) ||
        /timed[\s-]*out/i.test(msg)
      if (!retryAsync) throw err
      console.log(
        `LinkedInJobSource: sync run failed (${msg.slice(0, 120)}), falling back to async poll`
      )
      return this._fetchWithAsyncPoll(input)
    }
  }

  /**
   * @returns {Promise<object[]>}
   */
  async fetchVacancies () {
    if (!this._apiToken) {
      console.log(
        'LinkedInJobSource.fetchVacancies: no API token (set APIFY_API_TOKEN), skipping'
      )
      return []
    }

    const batches = []
    for (const query of this._searchQueries) {
      const rows = await this._fetchForQuery(query)
      batches.push(rows)
    }

    const byId = new Map()
    let rawRowCount = 0
    for (const batch of batches) {
      rawRowCount += batch.length
      for (const raw of batch) {
        const id =
          pickLinkedInField(raw, ['job_id', 'jobId', 'Job ID', 'id']) ??
          pickLinkedInField(raw, ['job_url', 'jobUrl', 'Job Url', 'url'])
        if (id == null || id === '') continue
        const key = String(id)
        if (!byId.has(key)) {
          byId.set(key, raw)
        }
      }
    }

    const deduped = [...byId.values()]
    const afterStack = deduped.filter((raw) => !matchesIgnoreStackForIngest(raw))
    const ignoredStackCount = deduped.length - afterStack.length

    const kept = afterStack.filter(
      (raw) => !isLinkedInPostTooOld(raw, this._maxPostAgeDays)
    )
    const skippedOldCount = afterStack.length - kept.length

    const normalized = kept.map(this.normalize)

    let logMsg =
      `LinkedInJobSource.fetchVacancies: ${normalized.length} unique vacancies` +
      ` (${this._searchQueries.length} Apify runs, jobs_entries=${this._maxItemsPerQuery},` +
      ` location=${this._location}, posted_within=${this._postedWithin},` +
      ` max_age_days=${this._maxPostAgeDays})`
    if (rawRowCount !== deduped.length) {
      logMsg += ` (${rawRowCount} rows before dedupe)`
    }
    if (ignoredStackCount > 0) {
      logMsg += `; skipped ${ignoredStackCount} ignored-stack match(es)`
    }
    if (skippedOldCount > 0) {
      logMsg += `; skipped ${skippedOldCount} older than ${this._maxPostAgeDays} day(s)`
    }
    console.log(logMsg)
    return normalized
  }
}
