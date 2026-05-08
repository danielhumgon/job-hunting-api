/*
  Unit tests for /vacancies REST controller.
*/

import { assert } from 'chai'
import sinon from 'sinon'

import VacanciesRESTControllerLib from '../../../../../src/controllers/rest-api/vacancies/controller.js'

describe('#Vacancies-REST-controller', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  describe('constructor', () => {
    it('should throw when adapters is missing', () => {
      assert.throws(
        () => new VacanciesRESTControllerLib({}),
        /Adapters library required/
      )
    })
  })

  describe('listVacancies()', () => {
    it('should set ctx.body from localdb', async () => {
      const payload = { data: [], pagination: { page: 1 } }
      const adapters = {
        localdb: {
          listVacancies: sandbox.stub().resolves(payload)
        }
      }
      const uut = new VacanciesRESTControllerLib({ adapters })
      const ctx = { query: { page: '2' } }
      await uut.listVacancies(ctx)
      assert.deepStrictEqual(ctx.body, payload)
      assert(adapters.localdb.listVacancies.calledOnceWith(ctx.query))
    })

    it('should map errors through handleError', async () => {
      const err = new Error('db')
      err.status = 503
      const adapters = {
        localdb: {
          listVacancies: sandbox.stub().rejects(err)
        }
      }
      const uut = new VacanciesRESTControllerLib({ adapters })
      const ctx = { query: {} }
      await uut.listVacancies(ctx)
      assert.strictEqual(ctx.status, 503)
      assert.strictEqual(ctx.body, 'db')
    })

    it('should default status 422 when error has no status', async () => {
      const adapters = {
        localdb: {
          listVacancies: sandbox.stub().rejects(new Error('plain'))
        }
      }
      const uut = new VacanciesRESTControllerLib({ adapters })
      const ctx = { query: {} }
      await uut.listVacancies(ctx)
      assert.strictEqual(ctx.status, 422)
      assert.strictEqual(ctx.body, 'plain')
    })

    it('should default response text when rejecting with a bare object', async () => {
      const adapters = {
        localdb: {
          listVacancies: sandbox.stub().rejects({ status: 418 })
        }
      }
      const uut = new VacanciesRESTControllerLib({ adapters })
      const ctx = { query: {} }
      await uut.listVacancies(ctx)
      assert.strictEqual(ctx.status, 418)
      assert.strictEqual(ctx.body, 'Error')
    })
  })

  describe('getVacancy()', () => {
    it('should map errors through handleError', async () => {
      const err = new Error('lookup failed')
      err.status = 500
      const adapters = {
        localdb: {
          getVacancyById: sandbox.stub().rejects(err)
        }
      }
      const uut = new VacanciesRESTControllerLib({ adapters })
      const ctx = { params: { id: '507f1f77bcf86cd799439011' } }
      await uut.getVacancy(ctx)
      assert.strictEqual(ctx.status, 500)
      assert.strictEqual(ctx.body, 'lookup failed')
    })

    it('should return 404 when row missing', async () => {
      const adapters = {
        localdb: {
          getVacancyById: sandbox.stub().resolves(null)
        }
      }
      const uut = new VacanciesRESTControllerLib({ adapters })
      const ctx = { params: { id: '507f1f77bcf86cd799439011' } }
      await uut.getVacancy(ctx)
      assert.strictEqual(ctx.status, 404)
      assert.strictEqual(ctx.body, 'Vacancy not found')
    })

    it('should set ctx.body when row exists', async () => {
      const row = { _id: '507f1f77bcf86cd799439011', title: 'x' }
      const adapters = {
        localdb: {
          getVacancyById: sandbox.stub().resolves(row)
        }
      }
      const uut = new VacanciesRESTControllerLib({ adapters })
      const ctx = { params: { id: '507f1f77bcf86cd799439011' } }
      await uut.getVacancy(ctx)
      assert.deepStrictEqual(ctx.body, row)
    })
  })
})
