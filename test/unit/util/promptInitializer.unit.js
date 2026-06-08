/*
  Unit tests for util/promptInitializer.js
*/

import { assert } from 'chai'
import { readFileSync } from 'fs'
import path from 'path'
import sinon from 'sinon'

import Vacancy from '../../../src/adapters/localdb/models/vacancy.js'
import {
  FALLBACK_REJECT_REASONS,
  PLACEHOLDER,
  formatRejectReasons,
  injectRejectReasons,
  initializeDynamicVacancyPrompt
} from '../../../util/promptInitializer.js'

describe('#promptInitializer', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => sandbox.restore())

  describe('formatRejectReasons', () => {
    it('should return empty string when no reasons', () => {
      assert.strictEqual(formatRejectReasons([]), '')
      assert.strictEqual(formatRejectReasons([{ rejectReason: '   ' }]), '')
    })

    it('should format reasons as markdown bullets', () => {
      const out = formatRejectReasons([
        { rejectReason: 'Not remote' },
        { rejectReason: 'Says "hybrid"' }
      ])
      assert.include(out, '* **Reason:** "Not remote"')
      assert.include(out, '* **Reason:** "Says \\"hybrid\\""')
    })
  })

  describe('injectRejectReasons', () => {
    it('should replace placeholder', () => {
      const base = `Header\n${PLACEHOLDER}\nFooter`
      const out = injectRejectReasons(base, '* **Reason:** "x"')
      assert.include(out, '* **Reason:** "x"')
      assert.notInclude(out, PLACEHOLDER)
    })

    it('should append section when placeholder missing', () => {
      const out = injectRejectReasons('No placeholder here', 'note')
      assert.include(out, 'Learned Rejection Patterns')
      assert.include(out, 'note')
    })
  })

  describe('initializeDynamicVacancyPrompt', () => {
    it('should write dynamic prompt with formatted reasons', async () => {
      sandbox.stub(Vacancy, 'find').returns({
        sort: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        lean: sandbox.stub().resolves([{ rejectReason: 'Wrong stack' }])
      })

      const result = await initializeDynamicVacancyPrompt()

      assert.isTrue(result.ok)
      assert.strictEqual(result.reasonCount, 1)
      const written = readFileSync(result.outputPath, 'utf8')
      assert.include(written, '* **Reason:** "Wrong stack"')
      assert.notInclude(written, PLACEHOLDER)
    })

    it('should use fallback when query returns no reasons', async () => {
      sandbox.stub(Vacancy, 'find').returns({
        sort: sandbox.stub().returnsThis(),
        limit: sandbox.stub().returnsThis(),
        select: sandbox.stub().returnsThis(),
        lean: sandbox.stub().resolves([])
      })

      await initializeDynamicVacancyPrompt()

      const outputPath = path.join(
        process.cwd(),
        'src/adapters/llm/vacancy-scoring-prompt-dinamic.md'
      )
      const written = readFileSync(outputPath, 'utf8')
      assert.include(written, FALLBACK_REJECT_REASONS)
    })

    it('should use fallback when Vacancy.find fails', async () => {
      sandbox.stub(Vacancy, 'find').throws(new Error('db down'))

      const result = await initializeDynamicVacancyPrompt()

      assert.isTrue(result.ok)
      const written = readFileSync(result.outputPath, 'utf8')
      assert.include(written, FALLBACK_REJECT_REASONS)
    })
  })
})
