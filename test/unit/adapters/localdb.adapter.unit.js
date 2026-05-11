/*
  Unit tests for LocalDB vacancy listing helpers (Mongo chain mocked).
*/

import { assert } from 'chai'
import mongoose from 'mongoose'
import sinon from 'sinon'

import LocalDB from '../../../src/adapters/localdb/index.js'
import Vacancy from '../../../src/adapters/localdb/models/vacancy.js'

describe('#LocalDB', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  function chainFindLean (rows) {
    return {
      sort: sandbox.stub().returnsThis(),
      skip: sandbox.stub().returnsThis(),
      limit: sandbox.stub().returnsThis(),
      lean: sandbox.stub().resolves(rows)
    }
  }

  describe('listVacancies', () => {
    it('should apply pagination defaults', async () => {
      sandbox.stub(Vacancy, 'find').returns(chainFindLean([]))
      sandbox.stub(Vacancy, 'countDocuments').resolves(0)

      const uut = new LocalDB()
      const out = await uut.listVacancies({})

      assert.strictEqual(out.pagination.page, 1)
      assert.strictEqual(out.pagination.limit, 20)
      assert.strictEqual(out.pagination.pages, 1)
    })

    it('should build filters from query params', async () => {
      const findStub = sandbox.stub(Vacancy, 'find').returns(chainFindLean([]))
      sandbox.stub(Vacancy, 'countDocuments').resolves(0)

      const uut = new LocalDB()
      await uut.listVacancies({
        page: '2',
        limit: '150',
        q: '  react  ',
        category: 'it',
        locationType: 'remote',
        experience: 'senior',
        source: 'src',
        since: '2024-05-01T00:00:00.000Z',
        minScore: '0.5'
      })

      const filter = findStub.firstCall.args[0]
      assert.deepEqual(filter.$text, { $search: 'react' })
      assert.strictEqual(filter.category, 'it')
      assert.strictEqual(filter.locationType, 'remote')
      assert.strictEqual(filter.experienceLevel, 'senior')
      assert.strictEqual(filter.source, 'src')
      assert.property(filter.llmScore, '$gte')
      assert.closeTo(filter.llmScore.$gte, 0.5, 0.001)
      assert.instanceOf(filter.datePosted.$gte, Date)
      assert.strictEqual(Vacancy.find.firstCall.returnValue.limit.firstCall.args[0], 100)
      assert.strictEqual(Vacancy.find.firstCall.returnValue.skip.firstCall.args[0], 100)
    })

    it('should ignore invalid since and nan minScore', async () => {
      const findStub = sandbox.stub(Vacancy, 'find').returns(chainFindLean([]))
      sandbox.stub(Vacancy, 'countDocuments').resolves(0)

      const uut = new LocalDB()
      await uut.listVacancies({ since: 'not-a-date', minScore: 'x' })

      const filter = findStub.firstCall.args[0]
      assert.notProperty(filter, 'datePosted')
      assert.notProperty(filter, 'llmScore')
    })

    it('should treat blank minScore as absent', async () => {
      const findStub = sandbox.stub(Vacancy, 'find').returns(chainFindLean([]))
      sandbox.stub(Vacancy, 'countDocuments').resolves(0)

      const uut = new LocalDB()
      await uut.listVacancies({ minScore: '' })
      assert.notProperty(findStub.firstCall.args[0], 'llmScore')
    })
  })

  describe('getVacancyById', () => {
    it('should return null for invalid ids', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(false)

      const uut = new LocalDB()
      const row = await uut.getVacancyById('bad')
      assert.isNull(row)
    })

    it('should lookup by ObjectId when valid', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      const leanStub = sandbox.stub().resolves({ title: 't' })
      sandbox.stub(Vacancy, 'findById').returns({ lean: leanStub })

      const uut = new LocalDB()
      const row = await uut.getVacancyById('507f191e810c19729de860ea')

      assert.deepStrictEqual(row, { title: 't' })
      assert.isTrue(Vacancy.findById.calledOnceWith('507f191e810c19729de860ea'))
    })
  })
})
