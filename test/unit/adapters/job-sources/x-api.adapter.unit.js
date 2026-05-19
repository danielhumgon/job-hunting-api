/*
  Unit tests for X (Twitter API v2) job source.
*/

import axios from 'axios'
import { assert } from 'chai'
import sinon from 'sinon'

import XApiJobSource, {
  PROFILE_STACK_SEARCH_QUERIES,
  X_API_DEFAULT_MAX_RESULTS,
  X_RECENT_SEARCH_QUERY,
  normalizeXTweet
} from '../../../../src/adapters/job-sources/x-api.js'

describe('#XApiJobSource', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  describe('normalizeXTweet', () => {
    it('should map tweet and author to canonical vacancy fields', () => {
      const tweet = {
        id: '123',
        text: 'We are hiring a Node developer\nRemote OK',
        created_at: '2026-01-15T10:00:00.000Z',
        author_id: '99',
        entities: { hashtags: [{ tag: 'hiring' }] }
      }
      const author = { id: '99', name: 'Acme Corp', username: 'acmecorp' }

      const row = normalizeXTweet(tweet, author, 'x', '7')

      assert.strictEqual(row.source, 'x')
      assert.strictEqual(row.externalId, '123')
      assert.include(row.title, 'hiring')
      assert.strictEqual(row.company, 'Acme Corp')
      assert.strictEqual(row.locationType, 'remoto')
      assert.deepEqual(row.keywords, ['hiring'])
      assert.strictEqual(row.sourceUrl, 'https://x.com/acmecorp/status/123')
      assert.strictEqual(row.ingestionVersion, '7')
      assert.strictEqual(row.llmStatus, 'pending')
    })

    it('should use web status URL when username is missing', () => {
      const tweet = { id: '42', text: 'Job post', created_at: '2026-05-01T00:00:00.000Z' }
      const row = normalizeXTweet(tweet, null, 'x', '1')
      assert.strictEqual(row.sourceUrl, 'https://x.com/i/web/status/42')
      assert.strictEqual(row.company, null)
    })

    it('should classify hybrid / híbrido as hibrido', () => {
      const row = normalizeXTweet(
        { id: '1', text: 'Engineer — trabajo híbrido CDMX', created_at: '2026-01-01T00:00:00.000Z' },
        null,
        'x',
        '1'
      )
      assert.strictEqual(row.locationType, 'hibrido')
    })

    it('should use (no text) title when tweet body is empty', () => {
      const row = normalizeXTweet({ id: '9', text: '', created_at: '2026-01-01T00:00:00.000Z' }, null, 'x', '1')
      assert.strictEqual(row.title, '(no text)')
    })

    it('should truncate long first line for title', () => {
      const long = `a${'b'.repeat(150)}`
      const row = normalizeXTweet({ id: '1', text: long, created_at: '2026-01-01T00:00:00.000Z' }, null, 'x', '1')
      assert.ok(row.title.endsWith('…'))
      assert.strictEqual(row.title.length, 138)
    })

    it('should omit datePosted when created_at is invalid', () => {
      const row = normalizeXTweet(
        { id: '1', text: 'x', created_at: 'not-a-date' },
        null,
        'x',
        '1'
      )
      assert.strictEqual(row.datePosted, undefined)
    })

    it('should coerce non-string hashtags and skip null tags', () => {
      const row = normalizeXTweet(
        {
          id: '1',
          text: 'x',
          created_at: '2026-01-01T00:00:00.000Z',
          entities: { hashtags: [{ tag: 99 }, { tag: null }, { no: 'pe' }] }
        },
        null,
        'x',
        '1'
      )
      assert.deepEqual(row.keywords, ['99'])
    })

    it('should set company to @username when author name is blank', () => {
      const row = normalizeXTweet(
        { id: '1', text: 'job', created_at: '2026-01-01T00:00:00.000Z' },
        { id: '9', name: '   ', username: 'jobsbot' },
        'x',
        '1'
      )
      assert.strictEqual(row.company, '@jobsbot')
    })

    it('should treat non-string tweet text as empty', () => {
      const row = normalizeXTweet({ id: '1', text: 42, created_at: '2026-01-01T00:00:00.000Z' }, null, 'x', '1')
      assert.strictEqual(row.content, '')
      assert.strictEqual(row.title, '(no text)')
    })

    it('should use non-array entities hashtags as empty keywords', () => {
      const row = normalizeXTweet(
        {
          id: '1',
          text: 'x',
          created_at: '2026-01-01T00:00:00.000Z',
          entities: { hashtags: 'nope' }
        },
        null,
        'x',
        '1'
      )
      assert.deepEqual(row.keywords, [])
    })

    it('should ellipsis summary when tweet exceeds 480 chars', () => {
      const body = `z${'y'.repeat(500)}`
      const row = normalizeXTweet({ id: '1', text: body, created_at: '2026-01-01T00:00:00.000Z' }, null, 'x', '1')
      assert.ok(row.summary.endsWith('…'))
      assert.strictEqual(row.summary.length, 478)
    })

    it('should allow vacant external id when id is null', () => {
      const row = normalizeXTweet({ id: null, text: 'hello', created_at: '2026-01-01T00:00:00.000Z' }, null, 'x', '1')
      assert.strictEqual(row.externalId, '')
      assert.strictEqual(row.sourceUrl, 'https://x.com/i/web/status/')
    })
  })

  describe('constructor', () => {
    it('should use default max results regardless of config xApiMaxResults', () => {
      const low = new XApiJobSource({
        config: {
          xApiBearerToken: 't',
          xApiMaxResults: 3
        }
      })
      assert.strictEqual(low._maxResults, X_API_DEFAULT_MAX_RESULTS)

      const high = new XApiJobSource({
        config: {
          xApiBearerToken: 't',
          xApiMaxResults: 500
        }
      })
      assert.strictEqual(high._maxResults, X_API_DEFAULT_MAX_RESULTS)
    })

    it('should coerce non-string bearer token and use profile stack search queries', () => {
      const uut = new XApiJobSource({
        config: {
          xApiBearerToken: 12345
        }
      })
      assert.strictEqual(uut._authToken, '12345')
      assert.deepEqual(uut._searchQueries, PROFILE_STACK_SEARCH_QUERIES)
    })

    it('should ignore X_API_MAX_RESULTS env and use default max results', () => {
      const prevM = process.env.X_API_MAX_RESULTS
      process.env.X_API_MAX_RESULTS = '88'
      try {
        const uut = new XApiJobSource({ config: { xApiBearerToken: 't' } })
        assert.deepEqual(uut._searchQueries, PROFILE_STACK_SEARCH_QUERIES)
        assert.strictEqual(uut._maxResults, X_API_DEFAULT_MAX_RESULTS)
      } finally {
        if (prevM === undefined) delete process.env.X_API_MAX_RESULTS
        else process.env.X_API_MAX_RESULTS = prevM
      }
    })

    it('should default config when config property is null', () => {
      const uut = new XApiJobSource({ config: null })
      assert.deepEqual(uut.config, {})
    })
  })

  describe('fetchVacancies', () => {
    it('should return empty when bearer token is missing', async () => {
      sandbox.stub(console, 'log')
      const uut = new XApiJobSource({ config: {} })
      const rows = await uut.fetchVacancies()
      assert.deepEqual(rows, [])
    })

    it('should request recent search and normalize tweets', async () => {
      sandbox.stub(console, 'log')
      const searchPayload = {
        data: [
          {
            id: '1',
            text: 'Hiring backend engineer presencial',
            created_at: '2026-01-01T12:00:00.000Z',
            author_id: '9',
            entities: {}
          }
        ],
        includes: { users: [{ id: '9', name: 'Co', username: 'co' }] }
      }
      sandbox.stub(axios, 'get').resolves({ data: searchPayload })

      const uut = new XApiJobSource({
        config: {
          xApiBearerToken: 'secret',
          jobIngestionVersion: '2'
        }
      })

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].externalId, '1')
      assert.strictEqual(rows[0].locationType, 'presencial')
      assert.strictEqual(axios.get.callCount, PROFILE_STACK_SEARCH_QUERIES.length)
      const [url, opts] = axios.get.firstCall.args
      assert.strictEqual(url, 'https://api.x.com/2/tweets/search/recent')
      assert.strictEqual(opts.headers.Authorization, 'Bearer secret')
      assert.strictEqual(opts.params.max_results, X_API_DEFAULT_MAX_RESULTS)
      assert.strictEqual(opts.params.query, PROFILE_STACK_SEARCH_QUERIES[0])
      assert.strictEqual(X_RECENT_SEARCH_QUERY, PROFILE_STACK_SEARCH_QUERIES[0])
    })

    it('should merge and dedupe tweets across profile stack queries', async () => {
      sandbox.stub(console, 'log')
      sandbox.stub(axios, 'get')
        .onFirstCall()
        .resolves({
          data: {
            data: [
              {
                id: '1',
                text: 'Node hiring',
                created_at: '2026-01-01T12:00:00.000Z',
                author_id: '9'
              }
            ],
            includes: { users: [{ id: '9', name: 'Co', username: 'co' }] }
          }
        })
        .onSecondCall()
        .resolves({
          data: {
            data: [
              {
                id: '1',
                text: 'dup',
                created_at: '2026-01-01T12:00:00.000Z',
                author_id: '9'
              },
              {
                id: '2',
                text: 'React hiring',
                created_at: '2026-01-02T12:00:00.000Z',
                author_id: '9'
              }
            ],
            includes: { users: [{ id: '9', name: 'Co', username: 'co' }] }
          }
        })
        .resolves({ data: { data: [], includes: { users: [] } } })

      const uut = new XApiJobSource({ config: { xApiBearerToken: 't' } })
      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 2)
      assert.strictEqual(axios.get.callCount, PROFILE_STACK_SEARCH_QUERIES.length)
    })

    it('should dedupe tweets by id', async () => {
      sandbox.stub(console, 'log')
      sandbox.stub(axios, 'get').resolves({
        data: {
          data: [
            { id: '1', text: 'a', created_at: '2026-01-01T12:00:00.000Z', author_id: '9' },
            { id: '1', text: 'dup', created_at: '2026-01-01T12:00:00.000Z', author_id: '9' }
          ],
          includes: { users: [{ id: '9', name: 'Co', username: 'co' }] }
        }
      })

      const uut = new XApiJobSource({ config: { xApiBearerToken: 't' } })
      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
    })

    it('should wrap HTTP errors', async () => {
      sandbox.stub(axios, 'get').rejects({
        response: { status: 429, statusText: 'Too Many', data: { errors: [{ message: 'rate' }] } },
        message: 'ignored'
      })

      const uut = new XApiJobSource({ config: { xApiBearerToken: 't' } })
      try {
        await uut.fetchVacancies()
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, '429')
        assert.include(err.message, 'Too Many')
      }
    })

    it('should treat non-array data as empty and skip tweets without id', async () => {
      sandbox.stub(console, 'log')
      sandbox.stub(axios, 'get').resolves({
        data: {
          data: { notArray: true },
          includes: { users: [{ id: '9', name: 'Co', username: 'co' }] }
        }
      })
      const uut = new XApiJobSource({ config: { xApiBearerToken: 't' } })
      const rows = await uut.fetchVacancies()
      assert.deepEqual(rows, [])
    })

    it('should normalize when author is missing from includes', async () => {
      sandbox.stub(console, 'log')
      sandbox.stub(axios, 'get').resolves({
        data: {
          data: [
            {
              id: '77',
              text: 'Open role',
              created_at: '2026-02-02T00:00:00.000Z',
              author_id: 'missing-user'
            }
          ],
          includes: { users: [] }
        }
      })
      const uut = new XApiJobSource({ config: { xApiBearerToken: 't' } })
      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].sourceUrl, 'https://x.com/i/web/status/77')
    })

    it('should skip null tweet rows', async () => {
      sandbox.stub(console, 'log')
      sandbox.stub(axios, 'get').resolves({
        data: {
          data: [null, { id: '1', text: 'ok', created_at: '2026-01-01T00:00:00.000Z', author_id: '9' }],
          includes: { users: [{ id: '9', name: 'Co', username: 'co' }] }
        }
      })
      const uut = new XApiJobSource({ config: { xApiBearerToken: 't' } })
      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
    })

    it('should normalize when author_id is null on tweet', async () => {
      sandbox.stub(console, 'log')
      sandbox.stub(axios, 'get').resolves({
        data: {
          data: [
            {
              id: '55',
              text: 'role',
              created_at: '2026-03-03T00:00:00.000Z',
              author_id: null
            }
          ]
        }
      })
      const uut = new XApiJobSource({ config: { xApiBearerToken: 't', jobIngestionVersion: '9' } })
      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].ingestionVersion, '9')
    })
  })

  describe('normalize (instance)', () => {
    it('should delegate to normalizeXTweet with config ingestion version', () => {
      const uut = new XApiJobSource({
        config: { jobIngestionVersion: '42', xApiBearerToken: 'x' }
      })
      const row = uut.normalize(
        { id: '10', text: 'hi', created_at: '2026-01-01T00:00:00.000Z' },
        { name: 'P', username: 'p' }
      )
      assert.strictEqual(row.ingestionVersion, '42')
      assert.strictEqual(row.source, 'x')
    })
  })

  describe('_getJson', () => {
    it('should forward query params and strip nulls', async () => {
      const uut = new XApiJobSource({ config: { xApiBearerToken: 'abc' } })
      sandbox.stub(axios, 'get').resolves({ data: { ok: true } })

      const data = await uut._getJson('/tweets/search/recent', {
        query: 'q',
        max_results: 10,
        unused: null
      })
      assert.deepEqual(data, { ok: true })
      assert.strictEqual(
        axios.get.firstCall.args[0],
        'https://api.x.com/2/tweets/search/recent'
      )
      assert.deepEqual(axios.get.firstCall.args[1].params, {
        query: 'q',
        max_results: 10
      })
      assert.strictEqual(
        axios.get.firstCall.args[1].headers.Authorization,
        'Bearer abc'
      )
    })

    it('should omit JSON detail when response has no data body', async () => {
      const uut = new XApiJobSource({ config: { xApiBearerToken: 'abc' } })
      sandbox.stub(axios, 'get').rejects({
        response: { status: 503, statusText: 'Service Unavailable' },
        message: 'm'
      })
      try {
        await uut._getJson('x')
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, '503')
        assert.notInclude(err.message, '{')
      }
    })

    it('should append JSON detail when response.data is present', async () => {
      const uut = new XApiJobSource({ config: { xApiBearerToken: 'abc' } })
      sandbox.stub(axios, 'get').rejects({
        response: {
          status: 401,
          statusText: 'Unauthorized',
          data: { error: 'bad' }
        },
        message: 'm'
      })
      try {
        await uut._getJson('path')
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, '401')
        assert.include(err.message, 'bad')
      }
    })

    it('should use err.message when statusText missing', async () => {
      const uut = new XApiJobSource({ config: { xApiBearerToken: 'abc' } })
      sandbox.stub(axios, 'get').rejects({
        response: { status: 500 },
        message: 'fallback-msg'
      })
      try {
        await uut._getJson('y')
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, '500')
        assert.include(err.message, 'fallback-msg')
      }
    })

    it('should use ERR when error has no HTTP status', async () => {
      const uut = new XApiJobSource({ config: { xApiBearerToken: 'abc' } })
      sandbox.stub(axios, 'get').rejects({ message: 'network broken' })
      try {
        await uut._getJson('z')
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, 'ERR')
        assert.include(err.message, 'network broken')
      }
    })
  })
})
