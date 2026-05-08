/*
  Unit tests for /vacancies REST router.
*/

import { assert } from 'chai'
import sinon from 'sinon'

import VacanciesRouter from '../../../../../src/controllers/rest-api/vacancies/index.js'
import adapters from '../../../mocks/adapters/index.js'

describe('#Vacancies-REST-router', () => {
  let uut
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    uut = new VacanciesRouter({ adapters })
  })

  afterEach(() => sandbox.restore())

  describe('constructor', () => {
    it('should throw when adapters is missing', () => {
      assert.throws(
        () => new VacanciesRouter({}),
        /Adapters library required when instantiating Vacancies REST router/
      )
    })
  })

  describe('attach', () => {
    it('should throw when app is missing', () => {
      assert.throws(
        () => uut.attach(),
        /Must pass app object when attaching REST API controllers/
      )
    })

    it('should register routes on the app', () => {
      const app = { use: sandbox.spy() }
      uut.attach(app)
      assert.strictEqual(app.use.callCount, 2)
    })
  })
})
