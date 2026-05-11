/*
  Unit tests for VacantesDigitales job source.
*/

import axios from 'axios'
import { assert } from 'chai'
import sinon from 'sinon'

import VacantesDigitales from '../../../../src/adapters/job-sources/vacantesdigitales.js'

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
    it('should page until totalPages consumed', async () => {
      const uut = new VacantesDigitales({ config: {} })
      sandbox.stub(uut, '_getJson').callsFake((_path, query) => {
        if (query.page === 1) {
          return Promise.resolve({
            data: [{ id: 1 }],
            pagination: { pages: 2 }
          })
        }
        return Promise.resolve({
          data: [{ id: 2 }],
          pagination: { pages: 2 }
        })
      })

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 2)
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
        ],
        pagination: { pages: 1 }
      })

      const [row] = await uut.fetchVacancies()
      assert.strictEqual(row.ingestionVersion, '9')
      assert.deepEqual(row.skills, [])
      assert.include(row.summary, '…')
    })

    it('should treat missing data array as empty', async () => {
      const uut = new VacantesDigitales({ config: {} })
      sandbox.stub(uut, '_getJson').resolves({
        pagination: { pages: 1 }
      })
      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 0)
    })

    it('should default totalPages when pagination.pages is absent', async () => {
      const uut = new VacantesDigitales({ config: {} })
      sandbox.stub(uut, '_getJson').callsFake((_path, query) => {
        assert.strictEqual(_path, 'vacancies')
        assert.strictEqual(query.page, 1)
        return Promise.resolve({
          data: [{ id: 1 }],
          pagination: {}
        })
      })

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
    })

    it('should treat non-numeric pagination.pages as single-page', async () => {
      const uut = new VacantesDigitales({ config: {} })
      sandbox.stub(uut, '_getJson').resolves({
        data: [{ id: 1 }],
        pagination: { pages: 'many' }
      })

      const rows = await uut.fetchVacancies()
      assert.strictEqual(rows.length, 1)
    })
  })

  describe('normalize', () => {
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
