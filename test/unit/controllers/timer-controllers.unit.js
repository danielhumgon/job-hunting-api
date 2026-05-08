/*
  Unit tests for the timer-controller.js Controller library
*/

// Public npm libraries
import { assert } from 'chai'
import sinon from 'sinon'

// Local libraries
import TimerControllers from '../../../src/controllers/timer-controllers.js'
import config from '../../../config/index.js'
import adapters from '../mocks/adapters/index.js'
import UseCasesMock from '../mocks/use-cases/index.js'

describe('#Timer-Controllers', () => {
  let uut
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()

    const useCases = new UseCasesMock()
    uut = new TimerControllers({ adapters, useCases })
  })

  afterEach(() => {
    sandbox.restore()

    uut.stopTimers()
  })

  describe('#constructor', () => {
    it('should throw an error if adapters are not passed in', () => {
      try {
        uut = new TimerControllers()

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(
          err.message,
          'Instance of Adapters library required when instantiating Timer Controller libraries.'
        )
      }
    })

    it('should throw an error if useCases are not passed in', () => {
      try {
        uut = new TimerControllers({ adapters })

        assert.fail('Unexpected code path')
      } catch (err) {
        assert.include(
          err.message,
          'Instance of Use Cases library required when instantiating Timer Controller libraries.'
        )
      }
    })

    it('should honor injected ingestIntervalMs', () => {
      const useCases = new UseCasesMock()
      const t = new TimerControllers({
        adapters,
        useCases,
        ingestIntervalMs: 4242
      })
      assert.strictEqual(t.ingestVacanciesInterval, 4242)
    })

    it('falls back when merged config lacks ingestIntervalMs', () => {
      const prev = config.ingestIntervalMs
      try {
        Reflect.deleteProperty(config, 'ingestIntervalMs')

        const useCases = new UseCasesMock()
        const t = new TimerControllers({
          adapters,
          useCases
        })

        assert.strictEqual(t.ingestVacanciesInterval, 1000 * 60 * 60 * 3)
      } finally {
        config.ingestIntervalMs = prev
      }
    })
  })

  describe('#startTimers', () => {
    it('should start the timers', () => {
      const result = uut.startTimers()

      uut.stopTimers()

      assert.equal(result, true)
    })

    it('should invoke ingestVacancies when ingestOnBoot is enabled outside test env', () => {
      sandbox.stub(uut.config, 'ingestOnBoot').value(true)
      sandbox.stub(uut.config, 'env').value('prod')
      const spy = sandbox.stub(uut, 'ingestVacancies').resolves(true)

      try {
        uut.startTimers()
        assert.strictEqual(spy.callCount, 1)
      } finally {
        spy.restore()
      }
    })
  })

  // describe('#exampleTimerFunc', () => {
  //   it('should kick off the Use Case', async () => {
  //     const result = await uut.exampleTimerFunc()

  //     assert.equal(result, true)
  //   })

  //   it('should return false on error', async () => {
  //     const result = await uut.exampleTimerFunc(true)

  //     assert.equal(result, false)
  //   })
  // })

  describe('#cleanUsage', () => {
    it('should kick off the Use Case', async () => {
      const result = await uut.cleanUsage()

      assert.equal(result, true)
    })

    it('should return false on error', async () => {
      sandbox.stub(uut.useCases.usage, 'cleanUsage').throws(new Error('test error'))
      const result = await uut.cleanUsage()

      assert.equal(result, false)
    })
  })

  describe('#backupUsage', () => {
    it('should kick off the Use Case', async () => {
      const result = await uut.backupUsage()

      assert.equal(result, true)
    })

    it('should return false on error', async () => {
      sandbox.stub(uut.useCases.usage, 'clearUsage').throws(new Error('test error'))
      // sandbox.stub(uut.useCases.usage, 'saveUsage').throws(new Error('test error'))

      const result = await uut.backupUsage()

      assert.equal(result, false)
    })
  })

  describe('#ingestVacancies', () => {
    it('should return true on successful ingestion tick', async () => {
      sandbox.stub(console, 'log')
      uut.ingestVacanciesHandle = setInterval(() => {}, 999999)
      const ok = await uut.ingestVacancies()
      assert.strictEqual(ok, true)
    })

    it('should return false when ingestion throws', async () => {
      sandbox.stub(console, 'log')
      sandbox.stub(console, 'error')
      sandbox.stub(uut.useCases.ingestion, 'ingestVacancies').rejects(new Error('surprise'))

      uut.ingestVacanciesHandle = setInterval(() => {}, 999999)
      const ok = await uut.ingestVacancies()

      assert.strictEqual(ok, false)
    })
  })
})
