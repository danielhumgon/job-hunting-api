/*
  Unit tests for IngestionUseCases.
*/

import { assert } from 'chai'
import sinon from 'sinon'

import IngestionUseCases, {
  INGESTION_MAX_POST_AGE_DAYS,
  isVacancyTooOldForIngestion
} from '../../../src/use-cases/ingestion.js'

describe('#IngestionUseCases', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  describe('constructor', () => {
    it('should throw when adapters is missing', () => {
      assert.throws(() => new IngestionUseCases({}), /adapters must be passed/)
    })
  })

  describe('isVacancyTooOldForIngestion()', () => {
    const now = new Date('2026-06-06T12:00:00.000Z')

    it('should return false when datePosted is within max age', () => {
      const recent = new Date(now)
      recent.setDate(recent.getDate() - 10)
      assert.isFalse(
        isVacancyTooOldForIngestion({ datePosted: recent }, INGESTION_MAX_POST_AGE_DAYS, now)
      )
    })

    it('should return true when datePosted is older than max age', () => {
      const old = new Date(now)
      old.setDate(old.getDate() - (INGESTION_MAX_POST_AGE_DAYS + 1))
      assert.isTrue(
        isVacancyTooOldForIngestion({ datePosted: old }, INGESTION_MAX_POST_AGE_DAYS, now)
      )
    })

    it('should return false when datePosted is missing or invalid', () => {
      assert.isFalse(isVacancyTooOldForIngestion({}, INGESTION_MAX_POST_AGE_DAYS, now))
      assert.isFalse(
        isVacancyTooOldForIngestion({ datePosted: 'not-a-date' }, INGESTION_MAX_POST_AGE_DAYS, now)
      )
    })
  })

  describe('ingestVacancies()', () => {
    const validRow = () => ({
      source: 'src',
      externalId: 'ext-1',
      title: 'Engineer',
      company: 'Co',
      category: 'it',
      locationType: 'remote',
      experienceLevel: 'mid',
      keywords: [],
      skills: [],
      summary: '',
      content: ''
    })

    it('should return ok:false when jobSources throws', async () => {
      const jobSources = {
        ingestVacancies: sandbox.stub().rejects(new Error('network down'))
      }
      const adapters = {
        jobSources,
        llm: { score: sandbox.stub() },
        localdb: { Vacancy: { updateOne: sandbox.stub() } }
      }
      const uut = new IngestionUseCases({ adapters })
      const out = await uut.ingestVacancies()
      assert.isFalse(out.ok)
      assert.include(out.error, 'network down')
      assert.strictEqual(out.metrics.phase, 'ingestVacancies')
    })

    it('should dedupe rows, skip invalid, persist, and aggregate metrics', async () => {
      const r1 = validRow()
      const r2 = { ...validRow(), externalId: 'ext-2', title: 'Other' }
      const dup = { ...r1, title: 'Dupe override' }

      const jobSources = {
        ingestVacancies: sandbox.stub().resolves({
          vacancies: [r1, dup, r2],
          metrics: { ticks: 1 }
        })
      }
      const scoreStub = sandbox.stub()
      scoreStub.resolves({
        llmStatus: 'completed',
        llmScore: 1,
        llmReasons: [],
        llmFlags: [],
        llmModel: 'm',
        llmPromptVersion: '1',
        llmClassifiedAt: new Date(),
        llmRawOutput: {},
        belowMinScore: false
      })
      scoreStub.onSecondCall().resolves({
        llmStatus: 'failed',
        llmScore: null,
        llmReasons: [],
        llmFlags: [],
        llmModel: 'm',
        llmPromptVersion: '1',
        llmClassifiedAt: new Date(),
        llmRawOutput: {},
        belowMinScore: false
      })

      const updateOne = sandbox
        .stub()
        .onFirstCall()
        .resolves({ upsertedCount: 1, modifiedCount: 0, matchedCount: 0 })
        .onSecondCall()
        .resolves({ upsertedCount: 0, modifiedCount: 1, matchedCount: 1 })

      const adapters = {
        jobSources,
        llm: { score: scoreStub },
        localdb: { Vacancy: { updateOne } }
      }

      const uut = new IngestionUseCases({ adapters })
      const out = await uut.ingestVacancies()

      assert.isTrue(out.ok)
      const m = out.metrics
      assert.strictEqual(m.fetchedRows, 3)
      assert.strictEqual(m.dedupedRows, 2)
      assert.strictEqual(m.persisted, 2)
      assert.strictEqual(m.inserted, 1)
      assert.strictEqual(m.modified, 1)
      assert.strictEqual(m.llmFailed, 1)
      assert.strictEqual(m.persistErrors, 0)
    })

    it('should dedupe rows when externalId matches as string or number', async () => {
      const jobSources = {
        ingestVacancies: sandbox.stub().resolves({
          vacancies: [
            { ...validRow(), externalId: '9', title: 'first' },
            { ...validRow(), externalId: 9, title: 'second' }
          ],
          metrics: {}
        })
      }
      const adapters = {
        jobSources,
        llm: {
          score: sandbox.stub().resolves({
            llmStatus: 'completed',
            llmScore: 0.5,
            llmReasons: [],
            llmFlags: [],
            llmModel: 'm',
            llmPromptVersion: '1',
            llmClassifiedAt: new Date(),
            llmRawOutput: {},
            belowMinScore: false
          })
        },
        localdb: {
          Vacancy: { updateOne: sandbox.stub().resolves({ upsertedCount: 0, modifiedCount: 1, matchedCount: 0 }) }
        }
      }
      const uut = new IngestionUseCases({ adapters })
      const out = await uut.ingestVacancies()
      assert.strictEqual(out.metrics.fetchedRows, 2)
      assert.strictEqual(out.metrics.dedupedRows, 1)
      assert.strictEqual(adapters.llm.score.callCount, 1)
    })

    it('should count skippedInvalid for entity validation failures', async () => {
      const invalid = { source: '', externalId: '1', title: 't' }

      const jobSources = {
        ingestVacancies: sandbox.stub().resolves({
          vacancies: [invalid],
          metrics: {}
        })
      }
      const adapters = {
        jobSources,
        llm: { score: sandbox.stub() },
        localdb: { Vacancy: { updateOne: sandbox.stub() } }
      }
      const uut = new IngestionUseCases({ adapters })
      const out = await uut.ingestVacancies()
      assert.strictEqual(out.metrics.skippedInvalid, 1)
      assert.strictEqual(out.metrics.persisted, 0)
      assert(adapters.llm.score.notCalled)
    })

    it('should skip persistence when LLM flags unsupported language', async () => {
      const jobSources = {
        ingestVacancies: sandbox.stub().resolves({
          vacancies: [validRow()],
          metrics: {}
        })
      }
      const adapters = {
        jobSources,
        llm: {
          score: sandbox.stub().resolves({
            llmStatus: 'completed',
            llmScore: 0,
            llmReasons: ['not english or spanish'],
            llmFlags: ['unsupported_language'],
            llmModel: 'm',
            llmPromptVersion: '1',
            llmClassifiedAt: new Date(),
            llmRawOutput: {},
            belowMinScore: true
          })
        },
        localdb: { Vacancy: { updateOne: sandbox.stub() } }
      }
      sandbox.stub(console, 'log')
      const uut = new IngestionUseCases({ adapters })
      const out = await uut.ingestVacancies()

      assert.strictEqual(out.metrics.skippedUnsupportedLanguage, 1)
      assert.strictEqual(out.metrics.persisted, 0)
      assert(adapters.localdb.Vacancy.updateOne.notCalled)
    })

    it('should skip persistence when vacancy is older than max post age', async () => {
      const now = new Date('2026-06-06T12:00:00.000Z')
      const old = new Date(now)
      old.setDate(old.getDate() - (INGESTION_MAX_POST_AGE_DAYS + 1))

      const jobSources = {
        ingestVacancies: sandbox.stub().resolves({
          vacancies: [{ ...validRow(), datePosted: old }],
          metrics: {}
        })
      }
      const adapters = {
        jobSources,
        llm: { score: sandbox.stub() },
        localdb: { Vacancy: { updateOne: sandbox.stub() } }
      }
      sandbox.stub(console, 'log')
      const uut = new IngestionUseCases({ adapters })
      const clock = sandbox.useFakeTimers({ now: now.getTime(), toFake: ['Date'] })
      const out = await uut.ingestVacancies()
      clock.restore()

      assert.strictEqual(out.metrics.skippedTooOld, 1)
      assert.strictEqual(out.metrics.persisted, 0)
      assert(adapters.llm.score.notCalled)
      assert(adapters.localdb.Vacancy.updateOne.notCalled)
    })

    it('should count persistErrors when updateOne rejects', async () => {
      const jobSources = {
        ingestVacancies: sandbox.stub().resolves({
          vacancies: [validRow()],
          metrics: {}
        })
      }
      const adapters = {
        jobSources,
        llm: {
          score: sandbox.stub().resolves({
            llmStatus: 'completed',
            llmScore: 0.5,
            llmReasons: [],
            llmFlags: [],
            llmModel: '',
            llmPromptVersion: '',
            llmClassifiedAt: new Date(),
            llmRawOutput: {},
            belowMinScore: false
          })
        },
        localdb: {
          Vacancy: { updateOne: sandbox.stub().rejects(new Error('mongo')) }
        }
      }
      const uut = new IngestionUseCases({ adapters })
      const out = await uut.ingestVacancies()
      assert.strictEqual(out.metrics.persistErrors, 1)
      assert.strictEqual(out.metrics.persisted, 0)
    })

    it('should treat non-array vacancies as empty', async () => {
      const jobSources = {
        ingestVacancies: sandbox.stub().resolves({
          vacancies: null,
          metrics: { phase: 'fetch' }
        })
      }
      const adapters = {
        jobSources,
        llm: { score: sandbox.stub() },
        localdb: { Vacancy: { updateOne: sandbox.stub() } }
      }
      const uut = new IngestionUseCases({ adapters })
      const out = await uut.ingestVacancies()
      assert.strictEqual(out.metrics.fetchedRows, 0)
      assert.strictEqual(out.metrics.dedupedRows, 0)
    })
  })
})
