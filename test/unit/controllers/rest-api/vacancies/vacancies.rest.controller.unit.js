/*
  Unit tests for /vacancies REST controller.
*/

import { assert } from 'chai'
import sinon from 'sinon'

import VacanciesRESTControllerLib from '../../../../../src/controllers/rest-api/vacancies/controller.js'

function makeUut (sandbox, overrides = {}) {
  const useCases = {
    vacancy: {
      listVacancies: sandbox.stub().resolves({ data: [], pagination: {} }),
      listAppliedVacancies: sandbox.stub().resolves({ data: [] }),
      markVacancyApplied: sandbox.stub().resolves({ applied: true }),
      filterVacancies: sandbox.stub().resolves({ data: [], pagination: {} }),
      getVacancy: sandbox.stub().resolves(null),
      updateVacancy: sandbox.stub().resolves({}),
      deleteVacancy: sandbox.stub().resolves(),
      ...overrides.vacancy
    }
  }
  const deps = {
    adapters: {
      localdb: {},
      jobSources: { sourcesSlug: ['vacantesdigitales', 'x'] }
    },
    useCases
  }
  return { uut: new VacanciesRESTControllerLib(deps), useCases }
}

describe('#Vacancies-REST-controller', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  describe('constructor', () => {
    it('should throw when adapters is missing', () => {
      assert.throws(
        () => new VacanciesRESTControllerLib({ useCases: { vacancy: {} } }),
        /Instance of Adapters library required/
      )
    })

    it('should throw when useCases is missing', () => {
      assert.throws(
        () =>
          new VacanciesRESTControllerLib({
            adapters: { localdb: {}, jobSources: { sourcesSlug: [] } }
          }),
        /Instance of Use Cases library required/
      )
    })
  })

  describe('listVacancies()', () => {
    it('should set ctx.body from use case', async () => {
      const payload = { data: [], pagination: { page: 1 } }
      const { uut, useCases } = makeUut(sandbox, {
        vacancy: { listVacancies: sandbox.stub().resolves(payload) }
      })
      const ctx = { params: { page: '2' } }
      await uut.listVacancies(ctx)
      assert.deepStrictEqual(ctx.body, payload)
      assert(useCases.vacancy.listVacancies.calledOnceWith('2'))
    })

    it('should map errors through handleError', async () => {
      const err = new Error('db')
      err.status = 503
      const { uut } = makeUut(sandbox, {
        vacancy: { listVacancies: sandbox.stub().rejects(err) }
      })
      const ctx = { query: {}, params: { page: '1' } }
      await uut.listVacancies(ctx)
      assert.strictEqual(ctx.status, 503)
      assert.strictEqual(ctx.body, 'db')
    })

    it('should default status 422 when error has no status', async () => {
      const { uut } = makeUut(sandbox, {
        vacancy: { listVacancies: sandbox.stub().rejects(new Error('plain')) }
      })
      const ctx = { query: {}, params: { page: '1' } }
      await uut.listVacancies(ctx)
      assert.strictEqual(ctx.status, 422)
      assert.strictEqual(ctx.body, 'plain')
    })

    it('should default response text when rejecting with a bare object', async () => {
      const { uut } = makeUut(sandbox, {
        vacancy: { listVacancies: sandbox.stub().rejects({ status: 418 }) }
      })
      const ctx = { query: {}, params: { page: '1' } }
      await uut.listVacancies(ctx)
      assert.strictEqual(ctx.status, 418)
      assert.strictEqual(ctx.body, 'Error')
    })
  })

  describe('listVacancySources()', () => {
    it('should set ctx.body from adapters.jobSources.sourcesSlug', async () => {
      const { uut } = makeUut(sandbox)
      const ctx = {}
      await uut.listVacancySources(ctx)
      assert.deepStrictEqual(ctx.body, { sources: ['vacantesdigitales', 'x'] })
    })

    it('should map errors through handleError', async () => {
      const { uut } = makeUut(sandbox)
      Object.defineProperty(uut.adapters, 'jobSources', {
        get () {
          throw new Error('broken')
        }
      })
      const ctx = {}
      await uut.listVacancySources(ctx)
      assert.strictEqual(ctx.status, 422)
      assert.strictEqual(ctx.body, 'broken')
    })
  })

  describe('listAppliedVacancies()', () => {
    it('should set ctx.body from use case', async () => {
      const payload = { data: [{ _id: '1', applied: true }] }
      const { uut, useCases } = makeUut(sandbox, {
        vacancy: { listAppliedVacancies: sandbox.stub().resolves(payload) }
      })
      const ctx = {}
      await uut.listAppliedVacancies(ctx)
      assert.deepStrictEqual(ctx.body, payload)
      assert.isTrue(useCases.vacancy.listAppliedVacancies.calledOnce)
    })

    it('should map errors through handleError', async () => {
      const { uut } = makeUut(sandbox, {
        vacancy: { listAppliedVacancies: sandbox.stub().rejects(new Error('db')) }
      })
      const ctx = {}
      await uut.listAppliedVacancies(ctx)
      assert.strictEqual(ctx.status, 422)
    })
  })

  describe('postApplyVacancy()', () => {
    it('should require id in body', async () => {
      const { uut, useCases } = makeUut(sandbox)
      const ctx = { request: { body: {} } }
      await uut.postApplyVacancy(ctx)
      assert.strictEqual(ctx.status, 400)
      assert.strictEqual(ctx.body, 'Vacancy id is required')
      assert.isFalse(useCases.vacancy.markVacancyApplied.called)
    })

    it('should accept nested vacancy.id', async () => {
      const updated = { _id: '507f191e810c19729de860ea', applied: true }
      const mark = sandbox.stub().resolves(updated)
      const { uut } = makeUut(sandbox, {
        vacancy: { markVacancyApplied: mark }
      })
      const ctx = {
        request: { body: { vacancy: { id: '507f191e810c19729de860ea' } } }
      }
      await uut.postApplyVacancy(ctx)
      assert.strictEqual(ctx.status, 200)
      assert.deepStrictEqual(ctx.body, updated)
      assert(mark.calledOnceWith('507f191e810c19729de860ea'))
    })

    it('should return updated doc', async () => {
      const updated = { _id: '507f191e810c19729de860ea', applied: true }
      const { uut } = makeUut(sandbox, {
        vacancy: { markVacancyApplied: sandbox.stub().resolves(updated) }
      })
      const ctx = { request: { body: { id: '507f191e810c19729de860ea' } } }
      await uut.postApplyVacancy(ctx)
      assert.strictEqual(ctx.status, 200)
      assert.deepStrictEqual(ctx.body, updated)
    })

    it('should surface 404 from use case', async () => {
      const err = new Error('Vacancy not found')
      err.status = 404
      const { uut } = makeUut(sandbox, {
        vacancy: { markVacancyApplied: sandbox.stub().rejects(err) }
      })
      const ctx = { request: { body: { id: '507f191e810c19729de860ea' } } }
      await uut.postApplyVacancy(ctx)
      assert.strictEqual(ctx.status, 404)
    })
  })

  describe('filterVacancies()', () => {
    it('should set ctx.body from use case with ctx.query', async () => {
      const payload = { data: [{ _id: '1' }], pagination: { page: 1, limit: 5 } }
      const filterVacancies = sandbox.stub().resolves(payload)
      const { uut } = makeUut(sandbox, {
        vacancy: { filterVacancies }
      })
      const query = {
        minScore: '3',
        sinceDate: '2026-01-01',
        source: 's',
        category: 'c',
        locationType: 'remote',
        experience: 'senior',
        perPage: '5',
        page: '2'
      }
      const ctx = { query }
      await uut.filterVacancies(ctx)
      assert.deepStrictEqual(ctx.body, payload)
      assert.isTrue(filterVacancies.calledOnceWith(query))
    })

    it('should map errors through handleError', async () => {
      const err = new Error('bad filter')
      err.status = 400
      const { uut } = makeUut(sandbox, {
        vacancy: { filterVacancies: sandbox.stub().rejects(err) }
      })
      const ctx = { query: { minScore: 'x' } }
      await uut.filterVacancies(ctx)
      assert.strictEqual(ctx.status, 400)
    })

    it('should pass {} when ctx.query is missing', async () => {
      const filterVacancies = sandbox.stub().resolves({ data: [], pagination: {} })
      const { uut } = makeUut(sandbox, { vacancy: { filterVacancies } })
      const ctx = {}
      await uut.filterVacancies(ctx)
      assert.isTrue(filterVacancies.calledOnceWith({}))
    })
  })

  describe('getVacancy()', () => {
    it('should map errors through handleError', async () => {
      const err = new Error('lookup failed')
      err.status = 500
      const { uut } = makeUut(sandbox, {
        vacancy: { getVacancy: sandbox.stub().rejects(err) }
      })
      const ctx = { params: { id: '507f1f77bcf86cd799439011' } }
      await uut.getVacancy(ctx)
      assert.strictEqual(ctx.status, 500)
      assert.strictEqual(ctx.body, 'lookup failed')
    })

    it('should surface 404 from use case', async () => {
      const err = new Error('Vacancy not found')
      err.status = 404
      const { uut } = makeUut(sandbox, {
        vacancy: { getVacancy: sandbox.stub().rejects(err) }
      })
      const ctx = { params: { id: '507f1f77bcf86cd799439011' } }
      await uut.getVacancy(ctx)
      assert.strictEqual(ctx.status, 404)
      assert.strictEqual(ctx.body, 'Vacancy not found')
    })

    it('should set ctx.body when row exists', async () => {
      const row = { _id: '507f1f77bcf86cd799439011', title: 'x' }
      const { uut, useCases } = makeUut(sandbox, {
        vacancy: { getVacancy: sandbox.stub().resolves(row) }
      })
      const ctx = { params: { id: '507f1f77bcf86cd799439011' } }
      await uut.getVacancy(ctx)
      assert.deepStrictEqual(ctx.body, row)
      assert(useCases.vacancy.getVacancy.calledOnceWith(ctx.params))
    })
  })

  describe('updateVacancy()', () => {
    it('should load, patch, and return updated doc', async () => {
      const existing = {
        _id: '507f1f77bcf86cd799439011',
        source: 's',
        externalId: '1',
        title: 'Old'
      }
      const updated = { ...existing, title: 'New' }
      const getVacancy = sandbox.stub().resolves(existing)
      const updateVacancy = sandbox.stub().resolves(updated)
      const { uut, useCases } = makeUut(sandbox, {
        vacancy: { getVacancy, updateVacancy }
      })
      const ctx = {
        params: { id: '507f1f77bcf86cd799439011' },
        request: { body: { title: 'New' } }
      }
      await uut.updateVacancy(ctx)
      assert.deepStrictEqual(ctx.body, updated)
      assert.strictEqual(useCases.vacancy.getVacancy.callCount, 1)
      assert(
        useCases.vacancy.updateVacancy.calledOnceWith(existing, { title: 'New' })
      )
    })

    it('should use body.vacancy when present', async () => {
      const existing = {
        _id: '507f1f77bcf86cd799439011',
        source: 's',
        externalId: '1',
        title: 'Old'
      }
      const getVacancy = sandbox.stub().resolves(existing)
      const updateVacancy = sandbox.stub().resolves(existing)
      const { uut, useCases } = makeUut(sandbox, {
        vacancy: { getVacancy, updateVacancy }
      })
      const ctx = {
        params: { id: '507f1f77bcf86cd799439011' },
        request: { body: { vacancy: { title: 'N' } } }
      }
      await uut.updateVacancy(ctx)
      assert(useCases.vacancy.updateVacancy.calledOnceWith(existing, { title: 'N' }))
    })

    it('should map errors through handleError', async () => {
      const err = new Error('bad merge')
      err.status = 400
      const { uut } = makeUut(sandbox, {
        vacancy: {
          getVacancy: sandbox.stub().resolves({ _id: '1', source: 's', externalId: '1', title: 't' }),
          updateVacancy: sandbox.stub().rejects(err)
        }
      })
      const ctx = {
        params: { id: '507f1f77bcf86cd799439011' },
        request: { body: {} }
      }
      await uut.updateVacancy(ctx)
      assert.strictEqual(ctx.status, 400)
    })
  })

  describe('deleteVacancy()', () => {
    it('should load, delete, return success', async () => {
      const existing = {
        _id: '507f1f77bcf86cd799439011',
        source: 's',
        externalId: '1',
        title: 't'
      }
      const getVacancy = sandbox.stub().resolves(existing)
      const deleteVacancy = sandbox.stub().resolves()
      const { uut, useCases } = makeUut(sandbox, {
        vacancy: { getVacancy, deleteVacancy }
      })
      const ctx = { params: { id: '507f1f77bcf86cd799439011' } }
      await uut.deleteVacancy(ctx)
      assert.strictEqual(ctx.status, 200)
      assert.deepStrictEqual(ctx.body, { success: true })
      assert(useCases.vacancy.deleteVacancy.calledOnceWith(existing))
    })

    it('should map errors through handleError', async () => {
      const { uut } = makeUut(sandbox, {
        vacancy: {
          getVacancy: sandbox.stub().rejects(new Error('missing'))
        }
      })
      const ctx = { params: { id: '507f1f77bcf86cd799439011' } }
      await uut.deleteVacancy(ctx)
      assert.strictEqual(ctx.status, 422)
    })

    it('should map delete failures', async () => {
      const existing = {
        _id: '507f1f77bcf86cd799439011',
        source: 's',
        externalId: '1',
        title: 't'
      }
      const err = new Error('cannot remove')
      err.status = 500
      const { uut } = makeUut(sandbox, {
        vacancy: {
          getVacancy: sandbox.stub().resolves(existing),
          deleteVacancy: sandbox.stub().rejects(err)
        }
      })
      const ctx = { params: { id: '507f1f77bcf86cd799439011' } }
      await uut.deleteVacancy(ctx)
      assert.strictEqual(ctx.status, 500)
    })
  })
})
