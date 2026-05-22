/*
  Unit tests for Jooble job source.
*/

import axios from 'axios'
import { assert } from 'chai'
import sinon from 'sinon'

import JoobleJobSource, {
  JOOBLE_DEFAULT_MAX_PAGES_PER_QUERY,
  JOOBLE_JOBS_PER_PAGE,
  PROFILE_STACK_SEARCH_QUERIES,
  inferJoobleLocationType,
  matchesIgnoreStackForIngest,
  normalizeJoobleJob,
  parseJoobleUpdated,
  stripJoobleHtml
} from '../../../../src/adapters/job-sources/jooble.js'

describe('#JoobleJobSource', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  describe('normalizeJoobleJob', () => {
    it('should map Jooble job to canonical vacancy fields', () => {
      const raw = {
        id: -123,
        title: 'Node Developer',
        location: 'Remote, US',
        snippet: '<b>Remote</b> role with &nbsp; Node.js',
        salary: '100k USD',
        type: 'Full-time',
        source: 'indeed.com',
        link: 'https://jooble.org/jdp/123',
        company: 'Acme Inc',
        updated: '2026-05-15T00:00:00.0000000'
      }

      const row = normalizeJoobleJob(raw, 'jooble', '2')

      assert.strictEqual(row.source, 'jooble')
      assert.strictEqual(row.externalId, '-123')
      assert.strictEqual(row.title, 'Node Developer')
      assert.strictEqual(row.company, 'Acme Inc')
      assert.strictEqual(row.locationType, 'remoto')
      assert.strictEqual(row.sourceUrl, 'https://jooble.org/jdp/123')
      assert.include(row.content, 'Node.js')
      assert.notInclude(row.content, '<b>')
      assert.deepEqual(row.keywords, ['100k USD', 'Full-time', 'indeed.com'])
      assert.strictEqual(row.ingestionVersion, '2')
    })

    it('should handle missing optional fields', () => {
      const row = normalizeJoobleJob({ id: 1, title: 'T' }, 'jooble', '1')
      assert.strictEqual(row.company, null)
      assert.strictEqual(row.sourceUrl, null)
      assert.strictEqual(row.datePosted, undefined)
    })

    it('should skip blank company and non-string keyword fields', () => {
      const row = normalizeJoobleJob(
        {
          id: 2,
          title: 99,
          company: '   ',
          salary: '  ',
          type: '',
          source: 1,
          category: null
        },
        'jooble',
        '1'
      )
      assert.strictEqual(row.title, '')
      assert.strictEqual(row.company, null)
      assert.strictEqual(row.category, null)
      assert.deepEqual(row.keywords, [])
    })

    it('should use short body as summary without ellipsis', () => {
      const row = normalizeJoobleJob(
        { id: 1, title: 'T', snippet: 'short', location: 'NY' },
        'jooble',
        '1'
      )
      assert.strictEqual(row.summary, 'short\nNY')
      assert.notInclude(row.summary, '…')
    })
  })

  describe('stripJoobleHtml', () => {
    it('should strip tags and nbsp', () => {
      assert.strictEqual(
        stripJoobleHtml('<b>Remote</b>&nbsp;job'),
        'Remote job'
      )
    })
  })

  describe('inferJoobleLocationType', () => {
    it('should detect remoto and hibrido', () => {
      assert.strictEqual(inferJoobleLocationType('fully remote'), 'remoto')
      assert.strictEqual(inferJoobleLocationType('trabajo híbrido'), 'hibrido')
      assert.strictEqual(inferJoobleLocationType('onsite only'), 'presencial')
      assert.strictEqual(inferJoobleLocationType('presencial CDMX'), 'presencial')
      assert.isNull(inferJoobleLocationType('New York'))
    })
  })

  describe('parseJoobleUpdated', () => {
    it('should parse ISO date and reject invalid', () => {
      assert.instanceOf(
        parseJoobleUpdated('2026-05-15T00:00:00.0000000'),
        Date
      )
      assert.strictEqual(parseJoobleUpdated('bad'), undefined)
    })
  })

  describe('matchesIgnoreStackForIngest', () => {
    it('should match Python and not JavaScript', () => {
      assert.isTrue(
        matchesIgnoreStackForIngest({
          title: 'Python developer',
          snippet: 'django'
        })
      )
      assert.isFalse(
        matchesIgnoreStackForIngest({
          title: 'JavaScript engineer',
          snippet: 'react'
        })
      )
      assert.isFalse(matchesIgnoreStackForIngest({ title: '', snippet: '' }))
    })
  })

  describe('constructor', () => {
    it('should no-op fetch when API key is missing', async () => {
      const uut = new JoobleJobSource({ config: {} })
      sandbox.stub(console, 'log')
      const rows = await uut.fetchVacancies()
      assert.deepEqual(rows, [])
      sinon.assert.calledWithMatch(
        console.log,
        /no API key/
      )
    })

    it('should append remote to keywords by default', () => {
      const uut = new JoobleJobSource({
        config: { joobleApiKey: 'test-key' }
      })
      assert.strictEqual(
        uut._keywordsForQuery('Node.js'),
        'Node.js remote'
      )
    })

    it('should not double-append remote', () => {
      const uut = new JoobleJobSource({ config: { joobleApiKey: 'k' } })
      assert.strictEqual(
        uut._keywordsForQuery('remote Node'),
        'remote Node'
      )
    })

    it('should return empty string for blank query', () => {
      const uut = new JoobleJobSource({ config: { joobleApiKey: 'k' } })
      assert.strictEqual(uut._keywordsForQuery('   '), '')
    })

    it('should accept numeric API key via String()', () => {
      const uut = new JoobleJobSource({ config: { joobleApiKey: 12345 } })
      assert.strictEqual(uut._apiKey, '12345')
    })

    it('should apply built-in defaults for location, remote, and max pages', () => {
      const uut = new JoobleJobSource({ config: { joobleApiKey: 'k' } })
      assert.strictEqual(uut._location, '')
      assert.isTrue(uut._appendRemote)
      assert.strictEqual(
        uut._maxPagesPerQuery,
        JOOBLE_DEFAULT_MAX_PAGES_PER_QUERY
      )
    })
  })

  describe('_postSearch', () => {
    it('should POST to jooble API URL with key', async () => {
      const uut = new JoobleJobSource({ config: { joobleApiKey: 'my-key' } })
      sandbox.stub(axios, 'post').resolves({ data: { jobs: [] } })

      await uut._postSearch({ keywords: 'node', page: '1' })
      assert.strictEqual(
        axios.post.firstCall.args[0],
        'https://jooble.org/api/my-key'
      )
      assert.deepEqual(axios.post.firstCall.args[1], {
        keywords: 'node',
        page: '1'
      })
    })

    it('should wrap axios errors', async () => {
      const uut = new JoobleJobSource({ config: { joobleApiKey: 'k' } })
      sandbox.stub(axios, 'post').rejects({
        response: { status: 403, statusText: 'Forbidden', data: { code: 'denied' } },
        message: 'x'
      })

      try {
        await uut._postSearch({})
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, '403')
        assert.include(err.message, 'denied')
      }
    })

    it('should use ERR when no response status', async () => {
      const uut = new JoobleJobSource({ config: { joobleApiKey: 'k' } })
      sandbox.stub(axios, 'post').rejects({ message: 'network' })

      try {
        await uut._postSearch({})
      } catch (err) {
        assert.include(err.message, 'ERR')
      }
    })
  })

  describe('_fetchSearchPages', () => {
    it('should stop early when page returns fewer than 20 jobs', async () => {
      const uut = new JoobleJobSource({ config: { joobleApiKey: 'k' } })
      uut._maxPagesPerQuery = 5
      sandbox.stub(uut, '_postSearch').resolves({
        jobs: Array.from({ length: 10 }, (_, i) => ({ id: i }))
      })

      const rows = await uut._fetchSearchPages('node remote')
      assert.strictEqual(rows.length, 10)
      assert.strictEqual(uut._postSearch.callCount, 1)
    })

    it('should treat non-array jobs payload as empty', async () => {
      const uut = new JoobleJobSource({ config: { joobleApiKey: 'k' } })
      sandbox.stub(uut, '_postSearch').resolves({ jobs: null })

      const rows = await uut._fetchSearchPages('node')
      assert.strictEqual(rows.length, 0)
    })

    it('should fetch multiple pages when full pages returned', async () => {
      const uut = new JoobleJobSource({ config: { joobleApiKey: 'k' } })
      uut._maxPagesPerQuery = 2
      const fullPage = Array.from({ length: JOOBLE_JOBS_PER_PAGE }, (_, i) => ({
        id: i
      }))
      sandbox.stub(uut, '_postSearch')
        .onFirstCall()
        .resolves({ jobs: fullPage })
        .onSecondCall()
        .resolves({ jobs: [{ id: 99 }] })

      const rows = await uut._fetchSearchPages('react remote')
      assert.strictEqual(rows.length, JOOBLE_JOBS_PER_PAGE + 1)
      assert.strictEqual(uut._postSearch.callCount, 2)
      assert.strictEqual(uut._postSearch.firstCall.args[0].page, '1')
      assert.strictEqual(uut._postSearch.secondCall.args[0].page, '2')
      assert.strictEqual(uut._postSearch.firstCall.args[0].companysearch, 'false')
    })
  })

  describe('fetchVacancies', () => {
    beforeEach(() => {
      sandbox.stub(console, 'log')
    })

    it('should merge queries, dedupe by id, and normalize', async () => {
      const uut = new JoobleJobSource({
        config: { joobleApiKey: 'k', jobIngestionVersion: '5' }
      })
      sandbox.stub(uut, '_fetchSearchPages').callsFake((keywords) => {
        if (keywords.includes('Node')) {
          return Promise.resolve([
            {
              id: 1,
              title: 'Node job',
              snippet: 'express',
              updated: '2026-01-01T00:00:00.0000000'
            }
          ])
        }
        return Promise.resolve([
          { id: 1, title: 'dup' },
          {
            id: 2,
            title: 'React job',
            snippet: 'vite',
            link: 'https://jooble.org/jdp/2',
            updated: '2026-01-02T00:00:00.0000000'
          }
        ])
      })

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 2)
      assert.strictEqual(rows[0].ingestionVersion, '5')
      assert.strictEqual(
        uut._fetchSearchPages.callCount,
        PROFILE_STACK_SEARCH_QUERIES.length
      )
      sinon.assert.calledWithMatch(console.log, /rows before dedupe/)
    })

    it('should skip ignore-stack jobs', async () => {
      const uut = new JoobleJobSource({ config: { joobleApiKey: 'k' } })
      sandbox.stub(uut, '_fetchSearchPages').resolves([
        { id: 1, title: 'Python dev', snippet: 'ml' },
        { id: 2, title: 'Node dev', snippet: 'api', link: 'https://x' }
      ])

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].externalId, '2')
      sinon.assert.calledWithMatch(console.log, /skipped 1 ignored-stack/)
    })

    it('should skip rows without id', async () => {
      const uut = new JoobleJobSource({ config: { joobleApiKey: 'k' } })
      sandbox.stub(uut, '_fetchSearchPages').resolves([
        { title: 'no id' },
        { id: 9, title: 'ok', snippet: 'x' }
      ])
      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
    })
  })
})
