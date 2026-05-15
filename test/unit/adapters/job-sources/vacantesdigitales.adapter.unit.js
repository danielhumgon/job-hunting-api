/*
  Unit tests for VacantesDigitales job source.
*/

import axios from 'axios'
import { assert } from 'chai'
import sinon from 'sinon'

import VacantesDigitales, {
  IGNORE_STACK_FOR_INGEST,
  PROFILE_STACK_SEARCH_QUERIES
} from '../../../../src/adapters/job-sources/vacantesdigitales.js'

describe('#VacantesDigitales', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  describe('_getJson', () => {
    it('should trim slashes and omit null query values', async () => {
      const uut = new VacantesDigitales({ config: {} })
      uut.baseUrl = 'https://example.com/api/'
      sandbox.stub(axios, 'get').resolves({ data: { ok: 1 } })

      const data = await uut._getJson('/cats', { a: 1, b: null, c: undefined })
      assert.deepEqual(data, { ok: 1 })
      assert.strictEqual(axios.get.firstCall.args[0], 'https://example.com/api/cats')
      assert.deepEqual(axios.get.firstCall.args[1].params, { a: 1 })
    })

    it('should wrap axios errors with status info', async () => {
      const uut = new VacantesDigitales({ config: {} })
      sandbox.stub(axios, 'get').rejects({
        response: { status: 502, statusText: 'Bad' },
        message: 'ignored'
      })
      sandbox.stub(console, 'log')

      try {
        await uut._getJson('list')
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, '502')
        assert.include(err.message, 'Bad')
      }
    })

    it('should use ERR when no response status', async () => {
      const uut = new VacantesDigitales({ config: {} })
      sandbox.stub(axios, 'get').rejects({ message: 'network' })
      sandbox.stub(console, 'log')

      try {
        await uut._getJson('x')
      } catch (err) {
        assert.include(err.message, 'ERR')
        assert.include(err.message, 'network')
      }
    })
  })

  describe('start', () => {
    it('should merge list pages up to targetCount', async () => {
      const uut = new VacantesDigitales({ config: {} })
      sandbox.stub(uut, '_getJson')
      uut._getJson.withArgs('categories').resolves({ dimensions: [], categories: [] })
      uut._getJson.withArgs('list', sinon.match.object).callsFake((_p, q) => {
        return Promise.resolve({
          data: Array.from({ length: 10 }, (_, i) => ({
            id: `${q.page}-${i}`
          })),
          pagination: { total: 99, pages: 5 }
        })
      })

      const out = await uut.start(25)
      assert.lengthOf(out.vacancies.data, 25)
      assert.strictEqual(out.vacancies.pagination.pagesFetched, 3)
      assert.strictEqual(out.vacancies.pagination.perRequestLimit, 10)
    })

    it('should ignore non-array list payloads', async () => {
      const uut = new VacantesDigitales({ config: {} })
      sandbox.stub(uut, '_getJson')
      uut._getJson.withArgs('categories').resolves({})
      uut._getJson.withArgs('list', sinon.match.object).resolves({ data: null })

      const out = await uut.start(5)
      assert.lengthOf(out.vacancies.data, 0)
    })
  })

  describe('fetchVacancies', () => {
    beforeEach(() => {
      sandbox.stub(console, 'log')
    })

    it('should run profile stack searches, merge pages, and dedupe by id', async () => {
      const uut = new VacantesDigitales({ config: {} })
      sandbox.stub(uut, '_getJson').callsFake((path, query) => {
        assert.strictEqual(path, 'search')
        if (query.q === PROFILE_STACK_SEARCH_QUERIES[0]) {
          return Promise.resolve({
            data: [{ id: 1, title: 'A', copy_seo_raw: 'x' }],
            total: 1
          })
        }
        return Promise.resolve({
          data: [{ id: 1, title: 'dup' }, { id: 2, title: 'B' }],
          total: 2
        })
      })

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 2)
      assert.ok(rows.some((r) => r.externalId === 1))
      assert.ok(rows.some((r) => r.externalId === 2))
    })

    it('should normalize rows with array or non-array skills', async () => {
      const uut = new VacantesDigitales({ config: { jobIngestionVersion: '9' } })
      sandbox.stub(uut, '_getJson').resolves({
        data: [
          {
            id: 'x1',
            title: 'T',
            job_category: 'cat',
            slug: 'sl',
            copy_seo_raw: 'y'.repeat(500),
            keywords: [],
            skills: {},
            date_posted_iso: '2020-01-01T00:00:00.000Z'
          }
        ]
      })

      const [row] = await uut.fetchVacancies()
      assert.strictEqual(row.ingestionVersion, '9')
      assert.deepEqual(row.skills, [])
      assert.include(row.summary, '…')
    })

    it('should treat missing data array as empty across all search calls', async () => {
      const uut = new VacantesDigitales({ config: {} })
      sandbox.stub(uut, '_getJson').resolves({})
      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 0)
    })

    it('should drop vacancies matching ignore-stack terms before normalize', async () => {
      const uut = new VacantesDigitales({ config: {} })
      sandbox.stub(uut, '_getJson').resolves({
        data: [
          { id: 1, title: 'Python developer', copy_seo_raw: 'api' },
          { id: 2, title: 'Node developer', copy_seo_raw: 'express' }
        ]
      })

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
      assert.strictEqual(rows[0].externalId, 2)
      sinon.assert.calledWithMatch(
        console.log,
        /skipped 1 ignored-stack/
      )
    })

    it('should load one merged batch when searches return rows', async () => {
      const uut = new VacantesDigitales({ config: {} })
      let n = 0
      sandbox.stub(uut, '_getJson').callsFake((path) => {
        assert.strictEqual(path, 'search')
        n += 1
        return Promise.resolve({
          data: n === 1 ? [{ id: 1, title: 'x', copy_seo_raw: '' }] : []
        })
      })

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
    })
  })

  describe('_matchesIgnoreStack', () => {
    it('should document six human-readable ignore labels', () => {
      assert.lengthOf(IGNORE_STACK_FOR_INGEST, 6)
    })

    it('should match each listed stack somewhere in title, body, keywords, or skills', () => {
      const uut = new VacantesDigitales({ config: {} })
      assert.isTrue(
        uut._matchesIgnoreStack({
          title: 'Python 3.11 backend',
          copy_seo_raw: '',
          keywords: [],
          skills: []
        })
      )
      assert.isTrue(
        uut._matchesIgnoreStack({
          title: 'Backend',
          content: 'looking for Java engineers',
          keywords: [],
          skills: []
        })
      )
      assert.isTrue(
        uut._matchesIgnoreStack({
          title: 'Web',
          copy_seo_raw: 'Laravel PHP',
          keywords: [],
          skills: []
        })
      )
      assert.isTrue(
        uut._matchesIgnoreStack({
          title: 'Senior .NET role',
          copy_seo_raw: '',
          keywords: [],
          skills: []
        })
      )
      assert.isTrue(
        uut._matchesIgnoreStack({
          title: 'Rails',
          copy_seo_raw: '',
          keywords: ['ruby'],
          skills: []
        })
      )
      assert.isTrue(
        uut._matchesIgnoreStack({
          title: 'Systems',
          copy_seo_raw: '',
          keywords: [],
          skills: ['C++']
        })
      )
      assert.isTrue(
        uut._matchesIgnoreStack({
          title: 'Win',
          copy_seo_raw: 'dotnet and azure',
          keywords: [],
          skills: []
        })
      )
      assert.isTrue(
        uut._matchesIgnoreStack({
          title: 'Mic',
          copy_seo_raw: 'ASP.NET MVC',
          keywords: [],
          skills: []
        })
      )
    })

    it('should not match JavaScript or empty payloads', () => {
      const uut = new VacantesDigitales({ config: {} })
      assert.isFalse(
        uut._matchesIgnoreStack({
          title: 'JavaScript Developer',
          copy_seo_raw: 'react node',
          keywords: [],
          skills: []
        })
      )
      assert.isFalse(uut._matchesIgnoreStack({ title: '', copy_seo_raw: '' }))
      assert.isFalse(uut._matchesIgnoreStack(null))
    })
  })

  describe('normalize', () => {
    it('should fall back to summary when copy_seo_raw and content are absent', () => {
      const uut = new VacantesDigitales({ config: {} })
      const row = uut.normalize({
        id: 1,
        title: 'T',
        slug: 's',
        summary: 'short summary only',
        keywords: [],
        skills: []
      })
      assert.strictEqual(row.content, 'short summary only')
      assert.strictEqual(row.summary, 'short summary only')
    })

    it('should map list/search API fields (content, apply_url, url, date_posted)', () => {
      const uut = new VacantesDigitales({ config: {} })
      const row = uut.normalize({
        id: 99,
        title: 'Job',
        category: 'desarrollo',
        slug: 'sl',
        content: 'full body',
        apply_url: 'https://apply.example',
        url: 'https://vacantesdigitales.com/empleo-digital/desarrollo/sl',
        date_posted: '2022-06-01T00:00:00.000Z',
        location_type: 'remoto',
        experience_level: 'senior',
        keywords: [],
        skills: ['Node.js']
      })
      assert.strictEqual(row.content, 'full body')
      assert.strictEqual(row.applyUrl, 'https://apply.example')
      assert.strictEqual(
        row.sourceUrl,
        'https://vacantesdigitales.com/empleo-digital/desarrollo/sl'
      )
      assert.strictEqual(row.datePosted?.getFullYear(), 2022)
      assert.strictEqual(row.locationType, 'remoto')
      assert.strictEqual(row.experienceLevel, 'senior')
    })

    it('should map fields and preserve short summary', () => {
      const uut = new VacantesDigitales({ config: {} })
      const row = uut.normalize({
        id: 'id1',
        title: 'Job',
        job_category: 'qa',
        slug: 'my-slug',
        company: 'Co',
        job_location_type: 'TELECOMMUTE',
        copy_seo_raw: 'short',
        keywords: ['a'],
        skills: ['s'],
        post_url: 'https://apply',
        date_posted_iso: 'invalid-date-xyz',
        valid_through: null
      })
      assert.strictEqual(row.locationType, 'remoto')
      assert.strictEqual(row.experienceLevel, null)
      assert.strictEqual(row.summary, 'short')
      assert.strictEqual(row.datePosted, undefined)
    })

    it('should map hybrid and onsite location types', () => {
      const uut = new VacantesDigitales({ config: {} })
      assert.strictEqual(
        uut._mapJobLocationType('HYBRID'),
        'hibrido'
      )
      assert.strictEqual(
        uut._mapJobLocationType('ONSITE'),
        'presencial'
      )
      assert.strictEqual(
        uut._mapJobLocationType('IN_STORE'),
        'presencial'
      )
    })

    it('should pass through unknown location types lowercased', () => {
      const uut = new VacantesDigitales({ config: {} })
      assert.strictEqual(uut._mapJobLocationType('CUSTOM'), 'custom')
    })

    it('should return null for empty location', () => {
      const uut = new VacantesDigitales({ config: {} })
      assert.isNull(uut._mapJobLocationType(null))
    })

    it('should accept valid dates in _normalizeDate', () => {
      const uut = new VacantesDigitales({ config: {} })
      const d = uut._normalizeDate('2021-06-15T12:00:00.000Z')
      assert.instanceOf(d, Date)
    })

    it('should prefer post_date when iso field is absent', () => {
      const uut = new VacantesDigitales({ config: {} })
      const row = uut.normalize({
        id: 'p',
        title: 'Job',
        post_date: '2022-01-02T00:00:00.000Z',
        copy_seo_raw: ''
      })
      assert.strictEqual(row.datePosted?.getFullYear(), 2022)
    })
  })
})
