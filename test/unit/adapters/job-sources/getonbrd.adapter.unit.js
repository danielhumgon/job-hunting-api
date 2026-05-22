/*
  Unit tests for Get on Board job source.
*/

import axios from 'axios'
import { assert } from 'chai'
import sinon from 'sinon'

import GetOnBrdJobSource, {
  GETONBRD_DEFAULT_API_BASE,
  GETONBRD_DEFAULT_PER_PAGE,
  IGNORE_STACK_FOR_INGEST,
  PROFILE_STACKS,
  PROFILE_STACK_SEARCH_QUERIES,
  buildGetOnBrdBodyText,
  profileStackSearchQueriesFromStacks,
  mapGetOnBrdLocationType,
  matchesIgnoreStackForIngest,
  normalizeGetOnBrdJob,
  parseGetOnBrdPublishedAt
} from '../../../../src/adapters/job-sources/getonbrd.js'

describe('#GetOnBrdJobSource', () => {
  let sandbox

  describe('profileStackSearchQueriesFromStacks', () => {
    it('should split each stack phrase into word queries', () => {
      const queries = profileStackSearchQueriesFromStacks(PROFILE_STACKS)
      assert.deepEqual(queries, PROFILE_STACK_SEARCH_QUERIES)
      assert.include(queries, 'Node.js')
      assert.include(queries, 'MongoDB')
      assert.include(queries, 'Next.js')
      assert.include(queries, 'web3')
      assert.strictEqual(queries.length, 11)
    })

    it('should ignore empty stacks and extra whitespace', () => {
      assert.deepEqual(
        profileStackSearchQueriesFromStacks(['  React   Next.js  ', '']),
        ['React', 'Next.js']
      )
    })
  })

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  describe('normalizeGetOnBrdJob', () => {
    it('should map job resource to canonical vacancy fields', () => {
      const raw = {
        id: '42',
        type: 'job',
        attributes: {
          title: 'Node Developer',
          description: 'Build APIs',
          functions: 'Backend work',
          remote: true,
          remote_modality: 'fully_remote',
          category_name: 'Programming',
          countries: ['Chile'],
          perks: ['flex'],
          published_at: 1700000000
        },
        links: {
          public_url: 'https://www.getonbrd.com/jobs/node-dev-co-santiago'
        }
      }

      const row = normalizeGetOnBrdJob(raw, 'getonbrd', '3')

      assert.strictEqual(row.source, 'getonbrd')
      assert.strictEqual(row.externalId, '42')
      assert.strictEqual(row.title, 'Node Developer')
      assert.strictEqual(row.slug, 'node-dev-co-santiago')
      assert.strictEqual(row.locationType, 'remoto')
      assert.strictEqual(row.category, 'Programming')
      assert.strictEqual(row.addressCountry, 'Chile')
      assert.include(row.keywords, 'Programming')
      assert.include(row.keywords, 'flex')
      assert.strictEqual(
        row.sourceUrl,
        'https://www.getonbrd.com/jobs/node-dev-co-santiago'
      )
      assert.strictEqual(row.ingestionVersion, '3')
      assert.strictEqual(row.llmStatus, 'pending')
      assert.instanceOf(row.datePosted, Date)
    })

    it('should truncate long body into summary', () => {
      const raw = {
        id: '1',
        attributes: {
          title: 'T',
          description: 'x'.repeat(500)
        }
      }
      const row = normalizeGetOnBrdJob(raw, 'getonbrd', '1')
      assert.include(row.summary, '…')
      assert.strictEqual(row.content.length, 500)
    })

    it('should handle missing attributes and links', () => {
      const row = normalizeGetOnBrdJob({ id: '9' }, 'getonbrd', '1')
      assert.strictEqual(row.title, '')
      assert.strictEqual(row.externalId, '9')
      assert.isNull(row.sourceUrl)
      assert.strictEqual(row.slug, '')
    })
  })

  describe('buildGetOnBrdBodyText', () => {
    it('should join non-empty description sections', () => {
      const text = buildGetOnBrdBodyText({
        description: 'A',
        functions: 'B',
        desirable: '',
        benefits: 'C'
      })
      assert.include(text, 'A')
      assert.include(text, 'B')
      assert.include(text, 'C')
    })
  })

  describe('mapGetOnBrdLocationType', () => {
    it('should map remote and modality values', () => {
      assert.strictEqual(mapGetOnBrdLocationType({ remote: true }), 'remoto')
      assert.strictEqual(
        mapGetOnBrdLocationType({ remote_modality: 'hybrid_partial' }),
        'hibrido'
      )
      assert.strictEqual(
        mapGetOnBrdLocationType({ remote_modality: 'no_remote' }),
        'presencial'
      )
      assert.strictEqual(
        mapGetOnBrdLocationType({ remote_modality: 'fully_remote' }),
        'remoto'
      )
      assert.isNull(mapGetOnBrdLocationType({}))
    })
  })

  describe('parseGetOnBrdPublishedAt', () => {
    it('should parse epoch seconds and milliseconds', () => {
      const sec = parseGetOnBrdPublishedAt(1700000000)
      assert.strictEqual(sec?.getUTCFullYear(), 2023)
      const ms = parseGetOnBrdPublishedAt(1700000000000)
      assert.strictEqual(ms?.getUTCFullYear(), 2023)
    })

    it('should return undefined for invalid values', () => {
      assert.strictEqual(parseGetOnBrdPublishedAt('bad'), undefined)
      assert.strictEqual(parseGetOnBrdPublishedAt(null), undefined)
    })
  })

  describe('matchesIgnoreStackForIngest', () => {
    it('should document six human-readable ignore labels', () => {
      assert.lengthOf(IGNORE_STACK_FOR_INGEST, 6)
    })

    it('should match Python in title and skip JavaScript', () => {
      assert.isTrue(
        matchesIgnoreStackForIngest({
          attributes: { title: 'Python engineer', description: 'api' }
        })
      )
      assert.isFalse(
        matchesIgnoreStackForIngest({
          attributes: { title: 'JavaScript Developer', description: 'react' }
        })
      )
      assert.isFalse(matchesIgnoreStackForIngest(null))
    })
  })

  describe('_getJson', () => {
    it('should build URL and omit null query values', async () => {
      const uut = new GetOnBrdJobSource({ config: {} })
      sandbox.stub(axios, 'get').resolves({ data: { ok: 1 } })

      const data = await uut._getJson('search/jobs', {
        query: 'node',
        page: 1,
        skip: null
      })
      assert.deepEqual(data, { ok: 1 })
      assert.strictEqual(
        axios.get.firstCall.args[0],
        `${GETONBRD_DEFAULT_API_BASE}/search/jobs`
      )
      assert.deepEqual(axios.get.firstCall.args[1].params, {
        query: 'node',
        page: 1
      })
    })

    it('should wrap axios errors with status info', async () => {
      const uut = new GetOnBrdJobSource({ config: {} })
      sandbox.stub(axios, 'get').rejects({
        response: { status: 502, statusText: 'Bad', data: { code: 'x' } },
        message: 'ignored'
      })

      try {
        await uut._getJson('search/jobs')
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, '502')
        assert.include(err.message, 'Bad')
      }
    })

    it('should use ERR when no response status', async () => {
      const uut = new GetOnBrdJobSource({ config: {} })
      sandbox.stub(axios, 'get').rejects({ message: 'network' })

      try {
        await uut._getJson('x')
      } catch (err) {
        assert.include(err.message, 'ERR')
        assert.include(err.message, 'network')
      }
    })
  })

  describe('_fetchSearchPages', () => {
    it('should paginate until total_pages', async () => {
      const uut = new GetOnBrdJobSource({ config: {} })
      uut._perPage = 2
      sandbox.stub(uut, '_getJson').callsFake((_path, q) => {
        if (q.page === 1) {
          return Promise.resolve({
            data: [{ id: '1' }, { id: '2' }],
            meta: { page: 1, per_page: 2, total_pages: 2 }
          })
        }
        return Promise.resolve({
          data: [{ id: '3' }],
          meta: { page: 2, per_page: 2, total_pages: 2 }
        })
      })

      const rows = await uut._fetchSearchPages('node')
      assert.strictEqual(rows.length, 3)
      assert.strictEqual(uut._getJson.callCount, 2)
    })

    it('should pass remote=true on search requests', async () => {
      const uut = new GetOnBrdJobSource({ config: {} })
      sandbox.stub(uut, '_getJson').resolves({
        data: [],
        meta: { total_pages: 1 }
      })

      await uut._fetchSearchPages('react')
      assert.strictEqual(uut._getJson.firstCall.args[1].remote, 'true')
    })
  })

  describe('constructor', () => {
    it('should apply built-in defaults', () => {
      const uut = new GetOnBrdJobSource({ config: {} })
      assert.strictEqual(uut.baseUrl, GETONBRD_DEFAULT_API_BASE)
      assert.strictEqual(uut._perPage, GETONBRD_DEFAULT_PER_PAGE)
      assert.strictEqual(uut._lang, 'en')
      assert.isTrue(uut._remoteOnly)
    })
  })

  describe('fetchVacancies', () => {
    beforeEach(() => {
      sandbox.stub(console, 'log')
    })

    it('should run profile stack searches, paginate, dedupe, and normalize', async () => {
      const uut = new GetOnBrdJobSource({ config: { jobIngestionVersion: '9' } })
      sandbox.stub(uut, '_fetchSearchPages').callsFake((query) => {
        if (query === PROFILE_STACK_SEARCH_QUERIES[0]) {
          return Promise.resolve([
            {
              id: '1',
              attributes: {
                title: 'Node role',
                description: 'koa',
                published_at: 1700000000
              },
              links: { public_url: 'https://www.getonbrd.com/jobs/node-1' }
            }
          ])
        }
        return Promise.resolve([
          {
            id: '1',
            attributes: { title: 'dup', description: 'x' },
            links: {}
          },
          {
            id: '2',
            attributes: {
              title: 'React role',
              description: 'vite',
              published_at: 1700000001
            },
            links: { public_url: 'https://www.getonbrd.com/jobs/react-2' }
          }
        ])
      })

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 2)
      assert.ok(rows.some((r) => r.externalId === '1'))
      assert.ok(rows.some((r) => r.externalId === '2'))
      assert.strictEqual(rows[0].ingestionVersion, '9')
      assert.strictEqual(uut._fetchSearchPages.callCount, PROFILE_STACK_SEARCH_QUERIES.length)
    })

    it('should drop vacancies matching ignore-stack terms', async () => {
      const uut = new GetOnBrdJobSource({ config: {} })
      sandbox.stub(uut, '_fetchSearchPages').resolves([
        {
          id: '1',
          attributes: { title: 'Python developer', description: 'django' }
        },
        {
          id: '2',
          attributes: { title: 'Node developer', description: 'express' },
          links: { public_url: 'https://www.getonbrd.com/jobs/n' }
        }
      ])

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].externalId, '2')
      sinon.assert.calledWithMatch(
        console.log,
        /skipped 1 ignored-stack/
      )
    })

    it('should treat missing data as empty for a query', async () => {
      const uut = new GetOnBrdJobSource({ config: {} })
      sandbox.stub(uut, '_fetchSearchPages').resolves([])
      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 0)
    })

    it('should skip rows without id', async () => {
      const uut = new GetOnBrdJobSource({ config: {} })
      sandbox.stub(uut, '_fetchSearchPages').resolves([
        { attributes: { title: 'no id' } },
        {
          id: '7',
          attributes: { title: 'ok', description: 'body' },
          links: {}
        }
      ])
      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].externalId, '7')
    })
  })
})
