/*
  Unit tests for Vacancy use cases (VacancyLib).
*/

import { assert } from 'chai'
import mongoose from 'mongoose'
import sinon from 'sinon'

import VacancyLib, {
  parseVacancyFilterOptions,
  VACANCIES_FILTER_MAX_PER_PAGE,
  VACANCIES_LIST_PAGE_SIZE
} from '../../../src/use-cases/vacancy.js'
import Vacancy from '../../../src/adapters/localdb/models/vacancy.js'

describe('#VacancyLib', () => {
  let sandbox
  let adapters
  let uut

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    adapters = {
      localdb: {
        Vacancy
      }
    }
    uut = new VacancyLib({ adapters })
  })

  afterEach(() => sandbox.restore())

  function chainFindLean (rows) {
    return {
      sort: sandbox.stub().returnsThis(),
      skip: sandbox.stub().returnsThis(),
      limit: sandbox.stub().returnsThis(),
      lean: sandbox.stub().resolves(rows)
    }
  }

  describe('constructor', () => {
    it('should require adapters', () => {
      assert.throws(
        () => new VacancyLib({}),
        /Instance of adapters must be passed in when instantiating Vacancy Use Cases library/
      )
    })
  })

  describe('listVacancies', () => {
    it('should apply pagination defaults', async () => {
      const findStub = sandbox.stub(Vacancy, 'find').returns(chainFindLean([]))
      sandbox.stub(Vacancy, 'countDocuments').resolves(0)

      const out = await uut.listVacancies()

      assert.deepStrictEqual(findStub.firstCall.args[0], {})
      assert.strictEqual(out.pagination.page, 1)
      assert.strictEqual(out.pagination.limit, 10)
      assert.strictEqual(out.pagination.pages, 1)
    })

    it('should apply page and skip from path-style value', async () => {
      sandbox.stub(Vacancy, 'find').returns(chainFindLean([]))
      sandbox.stub(Vacancy, 'countDocuments').resolves(0)

      const out = await uut.listVacancies('2')

      assert.strictEqual(out.pagination.page, 2)
      assert.strictEqual(Vacancy.find.firstCall.returnValue.limit.firstCall.args[0], 10)
      assert.strictEqual(Vacancy.find.firstCall.returnValue.skip.firstCall.args[0], 10)
    })

    it('should propagate errors from the database layer', async () => {
      sandbox.stub(Vacancy, 'find').returns(chainFindLean([]))
      sandbox.stub(Vacancy, 'countDocuments').rejects(new Error('db'))

      try {
        await uut.listVacancies(1)
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, 'db')
      }
    })
  })

  describe('parseVacancyFilterOptions', () => {
    it('should build filter and cap perPage', () => {
      const out = parseVacancyFilterOptions({
        minScore: '7',
        sinceDate: '2026-03-01T00:00:00.000Z',
        source: 'src',
        category: 'cat',
        LocationType: 'hybrid',
        experienceLevel: 'mid',
        page: '2',
        perPage: String(VACANCIES_FILTER_MAX_PER_PAGE + 50)
      })
      assert.deepStrictEqual(out.filter, {
        llmScore: { $gte: 7 },
        datePosted: { $gte: new Date('2026-03-01T00:00:00.000Z') },
        source: 'src',
        category: 'cat',
        locationType: 'hybrid',
        experienceLevel: 'mid'
      })
      assert.strictEqual(out.page, 2)
      assert.strictEqual(out.perPage, VACANCIES_FILTER_MAX_PER_PAGE)
    })

    it('should default page and perPage', () => {
      const out = parseVacancyFilterOptions({})
      assert.deepStrictEqual(out.filter, {})
      assert.strictEqual(out.page, 1)
      assert.strictEqual(out.perPage, VACANCIES_LIST_PAGE_SIZE)
    })

    it('should reject invalid minScore', () => {
      try {
        parseVacancyFilterOptions({ minScore: 'nope' })
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 400)
      }
    })

    it('should reject invalid since', () => {
      try {
        parseVacancyFilterOptions({ since: 'not-a-date' })
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 400)
      }
    })
  })

  describe('filterVacancies', () => {
    it('should query with built filter and pagination', async () => {
      const findStub = sandbox.stub(Vacancy, 'find').returns(chainFindLean([]))
      sandbox.stub(Vacancy, 'countDocuments').resolves(3)

      const out = await uut.filterVacancies({
        minScore: '1',
        source: 'x',
        perPage: '2',
        page: '2'
      })

      assert.deepStrictEqual(findStub.firstCall.args[0], {
        llmScore: { $gte: 1 },
        source: 'x'
      })
      assert.strictEqual(out.pagination.page, 2)
      assert.strictEqual(out.pagination.limit, 2)
      assert.strictEqual(out.pagination.total, 3)
      assert.strictEqual(out.pagination.pages, 2)
      assert.strictEqual(Vacancy.find.firstCall.returnValue.skip.firstCall.args[0], 2)
      assert.strictEqual(Vacancy.find.firstCall.returnValue.limit.firstCall.args[0], 2)
    })

    it('should propagate 400 from parser', async () => {
      try {
        await uut.filterVacancies({ minScore: 'bad' })
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 400)
      }
    })

    it('should propagate non-400 database errors', async () => {
      sandbox.stub(Vacancy, 'find').returns(chainFindLean([]))
      sandbox.stub(Vacancy, 'countDocuments').rejects(new Error('db'))

      try {
        await uut.filterVacancies({ source: 'x' })
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, 'db')
      }
    })
  })

  describe('listAppliedVacancies', () => {
    it('should return applied vacancies sorted query', async () => {
      const chain = {
        sort: sandbox.stub().returnsThis(),
        lean: sandbox.stub().resolves([{ _id: 'a', applied: true }])
      }
      const findStub = sandbox.stub(Vacancy, 'find').returns(chain)
      const out = await uut.listAppliedVacancies()
      assert.deepStrictEqual(findStub.firstCall.args[0], { applied: true })
      assert.isTrue(chain.sort.calledOnceWith({ appliedAt: -1 }))
      assert.deepStrictEqual(out.data, [{ _id: 'a', applied: true }])
    })

    it('should propagate database errors', async () => {
      sandbox.stub(Vacancy, 'find').returns({
        sort: sandbox.stub().returnsThis(),
        lean: sandbox.stub().rejects(new Error('db'))
      })
      try {
        await uut.listAppliedVacancies()
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, 'db')
      }
    })
  })

  describe('markVacancyApplied', () => {
    it('should set applied and appliedAt', async () => {
      const id = '507f191e810c19729de860ea'
      const updated = {
        _id: id,
        applied: true,
        title: 't'
      }
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      const leanStub = sandbox.stub().resolves(updated)
      const updateStub = sandbox.stub(Vacancy, 'findByIdAndUpdate').returns({
        lean: leanStub
      })

      const out = await uut.markVacancyApplied(id)

      assert.deepStrictEqual(out, updated)
      assert.strictEqual(updateStub.firstCall.args[0], id)
      const setPatch = updateStub.firstCall.args[1].$set
      assert.strictEqual(setPatch.applied, true)
      assert.instanceOf(setPatch.appliedAt, Date)
    })

    it('should throw 404 for invalid id', async () => {
      try {
        await uut.markVacancyApplied('bad')
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 404)
      }
    })

    it('should throw 404 when not found', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      sandbox.stub(Vacancy, 'findByIdAndUpdate').returns({
        lean: sandbox.stub().resolves(null)
      })
      try {
        await uut.markVacancyApplied('507f191e810c19729de860ea')
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 404)
      }
    })

    it('should propagate non-404 errors from findByIdAndUpdate', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      sandbox.stub(Vacancy, 'findByIdAndUpdate').returns({
        lean: sandbox.stub().rejects(new Error('cast failed'))
      })
      try {
        await uut.markVacancyApplied('507f191e810c19729de860ea')
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, 'cast failed')
        assert.isUndefined(err.status)
      }
    })
  })

  describe('getVacancy', () => {
    it('should throw 404 for invalid ids', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(false)

      try {
        await uut.getVacancy({ id: 'bad' })
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 404)
        assert.include(err.message, 'not found')
      }
    })

    it('should throw 404 when document missing', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      sandbox.stub(Vacancy, 'findById').returns({
        lean: sandbox.stub().resolves(null)
      })

      try {
        await uut.getVacancy({ id: '507f191e810c19729de860ea' })
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 404)
      }
    })

    it('should return lean document', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      const leanStub = sandbox.stub().resolves({ title: 't' })
      sandbox.stub(Vacancy, 'findById').returns({ lean: leanStub })

      const row = await uut.getVacancy({ id: '507f191e810c19729de860ea' })

      assert.deepStrictEqual(row, { title: 't' })
      assert.isTrue(Vacancy.findById.calledOnceWith('507f191e810c19729de860ea'))
    })

    it('should remap non-404 errors to 422', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      sandbox.stub(Vacancy, 'findById').returns({
        lean: sandbox.stub().rejects(new Error('db'))
      })

      try {
        await uut.getVacancy({ id: '507f191e810c19729de860ea' })
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 422)
        assert.strictEqual(err.message, 'Unprocessable Entity')
      }
    })
  })

  describe('updateVacancy', () => {
    const existing = {
      _id: '507f191e810c19729de860ea',
      source: 's',
      externalId: '1',
      title: 'Old'
    }

    it('should accept null newData as empty patch', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      sandbox.stub(Vacancy, 'findById').returns({
        lean: sandbox.stub().resolves(existing)
      })

      const out = await uut.updateVacancy(existing, null)
      assert.deepStrictEqual(out, existing)
    })

    it('should return current doc when patch is empty object', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      sandbox.stub(Vacancy, 'findById').returns({
        lean: sandbox.stub().resolves(existing)
      })

      const out = await uut.updateVacancy(existing, {})
      assert.deepStrictEqual(out, existing)
    })

    it('should throw 404 when patch empty but document missing', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      sandbox.stub(Vacancy, 'findById').returns({
        lean: sandbox.stub().resolves(null)
      })

      try {
        await uut.updateVacancy(existing, {})
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 404)
      }
    })

    it('should apply $set and return updated lean doc', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      const updated = { ...existing, title: 'New' }
      const leanStub = sandbox.stub().resolves(updated)
      sandbox.stub(Vacancy, 'findByIdAndUpdate').returns({ lean: leanStub })

      const out = await uut.updateVacancy(existing, { title: 'New' })

      assert.deepStrictEqual(out, updated)
      assert.deepStrictEqual(
        Vacancy.findByIdAndUpdate.firstCall.args[1],
        { $set: { title: 'New' } }
      )
    })

    it('should throw 404 when id invalid', async () => {
      const bad = { ...existing, _id: 'nope' }
      try {
        await uut.updateVacancy(bad, { title: 'x' })
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 404)
      }
    })

    it('should throw 404 when findByIdAndUpdate returns null', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      sandbox.stub(Vacancy, 'findByIdAndUpdate').returns({
        lean: sandbox.stub().resolves(null)
      })

      try {
        await uut.updateVacancy(existing, { title: 'N' })
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 404)
      }
    })

    it('should map duplicate key to 409', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      sandbox.stub(Vacancy, 'findByIdAndUpdate').returns({
        lean: sandbox.stub().rejects({ code: 11000 })
      })

      try {
        await uut.updateVacancy(existing, { source: 'other' })
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 409)
      }
    })

    it('should propagate other errors from findByIdAndUpdate', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      sandbox.stub(Vacancy, 'findByIdAndUpdate').returns({
        lean: sandbox.stub().rejects(new Error('cast failed'))
      })

      try {
        await uut.updateVacancy(existing, { title: 'X' })
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, 'cast failed')
      }
    })

    it('should reject invalid merged entity', async () => {
      try {
        await uut.updateVacancy(existing, { title: '' })
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, 'title')
      }
    })
  })

  describe('deleteVacancy', () => {
    it('should delete by id', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      const leanStub = sandbox.stub().resolves({ _id: '507f191e810c19729de860ea' })
      sandbox.stub(Vacancy, 'findByIdAndDelete').returns({ lean: leanStub })

      await uut.deleteVacancy({ _id: '507f191e810c19729de860ea' })

      assert(Vacancy.findByIdAndDelete.calledOnceWith('507f191e810c19729de860ea'))
    })

    it('should accept ObjectId _id', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      const oid = new mongoose.Types.ObjectId('507f191e810c19729de860ea')
      const leanStub = sandbox.stub().resolves({ _id: oid })
      sandbox.stub(Vacancy, 'findByIdAndDelete').returns({ lean: leanStub })

      await uut.deleteVacancy({ _id: oid })

      assert(Vacancy.findByIdAndDelete.calledOnceWith(oid.toString()))
    })

    it('should throw 404 when id invalid', async () => {
      try {
        await uut.deleteVacancy({ _id: 'bad' })
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 404)
      }
    })

    it('should throw 404 when already gone', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      sandbox.stub(Vacancy, 'findByIdAndDelete').returns({
        lean: sandbox.stub().resolves(null)
      })

      try {
        await uut.deleteVacancy({ _id: '507f191e810c19729de860ea' })
        assert.fail('expected throw')
      } catch (err) {
        assert.strictEqual(err.status, 404)
      }
    })

    it('should propagate database errors', async () => {
      sandbox.stub(mongoose.Types.ObjectId, 'isValid').returns(true)
      sandbox.stub(Vacancy, 'findByIdAndDelete').returns({
        lean: sandbox.stub().rejects(new Error('network'))
      })

      try {
        await uut.deleteVacancy({ _id: '507f191e810c19729de860ea' })
        assert.fail('expected throw')
      } catch (err) {
        assert.include(err.message, 'network')
      }
    })
  })
})
