/*
  Unit tests for LlmAdapter (OpenAI-compatible scoring).
*/

import { assert } from 'chai'
import sinon from 'sinon'

import wlogger from '../../../../src/adapters/wlogger.js'
import LlmAdapter from '../../../../src/adapters/llm/index.js'

function openAiResponse (content, status = 200) {
  const body = JSON.stringify({
    choices: [{ message: { content } }]
  })
  return new Response(body, {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('#LlmAdapter', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    sandbox.stub(Math, 'random').returns(0)
  })

  afterEach(() => sandbox.restore())

  describe('constructor', () => {
    it('should use fallback system prompt when prompt file is unreadable', () => {
      sandbox.stub(console, 'error')
      const uut = new LlmAdapter({
        promptPath: '/tmp/does-not-exist-vacancy-prompt-xyz.md',
        config: {}
      })
      assert.include(uut._systemPrompt, 'Reply with JSON only')
    })

    it('should trim trailing slash from baseUrl', () => {
      const uut = new LlmAdapter({
        config: { llmApiUrl: 'http://127.0.0.1:11434/v1/' }
      })
      assert.strictEqual(uut.baseUrl, 'http://127.0.0.1:11434/v1')
    })

    it('should apply defaults when config omits LLM fields', () => {
      const uut = new LlmAdapter({ config: {} })
      assert.include(uut.baseUrl, '11434')
      assert.strictEqual(uut.model, 'gemma4')
    })
  })

  describe('score()', () => {
    it('should return completed result with clamped score and deduped reasons', async () => {
      const validJson = JSON.stringify({
        score: 1.5,
        reasons: ['Remote', 'remote', ''],
        flags: ['X', 'x']
      })
      sandbox.stub(globalThis, 'fetch').resolves(openAiResponse(validJson))

      const uut = new LlmAdapter({
        config: {
          llmApiUrl: 'http://llm.test/v1',
          llmModel: 'm1',
          llmPromptVersion: '2'
        }
      })

      const out = await uut.score({
        title: 'Dev',
        company: 'ACME',
        category: 'it',
        locationType: 'remote',
        experienceLevel: 'mid',
        keywords: [],
        skills: [],
        summary: 's',
        content: 'body'
      })

      assert.strictEqual(out.llmStatus, 'completed')
      assert.strictEqual(out.llmScore, 1)
      assert.deepEqual(out.llmReasons, ['remote'])
      assert.deepEqual(out.llmFlags, ['x'])
      assert.strictEqual(out.llmModel, 'm1')
      assert.strictEqual(out.llmPromptVersion, '2')
      assert.isFalse(out.belowMinScore)
    })

    it('should set belowMinScore when score is under configured minimum', async () => {
      sandbox
        .stub(globalThis, 'fetch')
        .resolves(openAiResponse(JSON.stringify({ score: 0.3, reasons: [], flags: [] })))

      const uut = new LlmAdapter({
        config: { minVacancyLlmScore: 0.5, llmApiUrl: 'http://llm.test/v1' }
      })
      const out = await uut.score({
        source: 's',
        externalId: '1',
        title: 'T',
        company: 'C',
        category: 'c',
        locationType: 'hybrid',
        experienceLevel: 'junior',
        keywords: [],
        skills: [],
        summary: '',
        content: ''
      })
      assert.isTrue(out.belowMinScore)
    })

    it('should clamp negative score to 0', async () => {
      sandbox
        .stub(globalThis, 'fetch')
        .resolves(openAiResponse(JSON.stringify({ score: -0.5, reasons: [], flags: [] })))

      const uut = new LlmAdapter({ config: { llmApiUrl: 'http://llm.test/v1' } })
      const out = await uut.score({
        title: 'T',
        company: 'C',
        category: 'c',
        locationType: 'onsite',
        experienceLevel: 'senior',
        keywords: [],
        skills: [],
        summary: '',
        content: ''
      })
      assert.strictEqual(out.llmScore, 0)
    })

    it('should send Bearer token when apiKey is set', async () => {
      const fetchStub = sandbox
        .stub(globalThis, 'fetch')
        .resolves(openAiResponse(JSON.stringify({ score: 0.1, reasons: [], flags: [] })))

      const uut = new LlmAdapter({
        config: { llmApiUrl: 'http://llm.test/v1', llmApiKey: 'secret' }
      })
      await uut.score({
        title: 'T',
        company: 'C',
        category: 'c',
        locationType: 'remote',
        experienceLevel: 'mid',
        keywords: [],
        skills: [],
        summary: '',
        content: ''
      })

      const init = fetchStub.firstCall.args[1]
      assert.strictEqual(init.headers.Authorization, 'Bearer secret')
    })

    it('should truncate string content to 12000 chars in request body', async () => {
      const fetchStub = sandbox
        .stub(globalThis, 'fetch')
        .resolves(openAiResponse(JSON.stringify({ score: 0.5, reasons: [], flags: [] })))

      const uut = new LlmAdapter({ config: { llmApiUrl: 'http://llm.test/v1' } })
      const long = 'z'.repeat(13000)
      await uut.score({
        title: 'T',
        company: 'C',
        category: 'c',
        locationType: 'remote',
        experienceLevel: 'mid',
        keywords: [],
        skills: [],
        summary: '',
        content: long
      })

      const init = fetchStub.firstCall.args[1]
      const parsedBody = JSON.parse(init.body)
      const userRaw = parsedBody.messages.find((m) => m.role === 'user').content
      const userMsg = JSON.parse(userRaw)
      assert.strictEqual(userMsg.content.length, 12000)
    })

    it('should parse JSON embedded in assistant prose', async () => {
      const wrapped = `Here you go: ${JSON.stringify({ score: 0.2, reasons: ['ok'], flags: [] })} thanks`
      sandbox.stub(globalThis, 'fetch').resolves(openAiResponse(wrapped))

      const uut = new LlmAdapter({ config: { llmApiUrl: 'http://llm.test/v1' } })
      const out = await uut.score({
        title: 'T',
        company: 'C',
        category: 'c',
        locationType: 'remote',
        experienceLevel: 'mid',
        keywords: [],
        skills: [],
        summary: '',
        content: ''
      })
      assert.strictEqual(out.llmStatus, 'completed')
      assert.closeTo(out.llmScore, 0.2, 0.001)
    })

    it('should return failed status when assistant text is not JSON', async () => {
      sandbox.stub(globalThis, 'fetch').resolves(openAiResponse('not json'))

      const uut = new LlmAdapter({ config: { llmApiUrl: 'http://llm.test/v1' } })
      const out = await uut.score({
        title: 'T',
        company: 'C',
        category: 'c',
        locationType: 'remote',
        experienceLevel: 'mid',
        keywords: [],
        skills: [],
        summary: '',
        content: ''
      })
      assert.strictEqual(out.llmStatus, 'failed')
      assert.isNull(out.llmScore)
    })

    it('should return failed status when parsed JSON fails zod validation', async () => {
      sandbox.stub(globalThis, 'fetch').resolves(openAiResponse(JSON.stringify({ score: 'nope', reasons: [], flags: [] })))

      const uut = new LlmAdapter({ config: { llmApiUrl: 'http://llm.test/v1' } })
      const out = await uut.score({
        title: 'T',
        company: 'C',
        category: 'c',
        locationType: 'remote',
        experienceLevel: 'mid',
        keywords: [],
        skills: [],
        summary: '',
        content: ''
      })
      assert.strictEqual(out.llmStatus, 'failed')
      assert.property(out.llmRawOutput, 'parsed')
    })

    it('should return failed when HTTP layer throws', async () => {
      sandbox.stub(globalThis, 'fetch').resolves(new Response('', { status: 400 }))
      const uut = new LlmAdapter({ config: { llmApiUrl: 'http://llm.test/v1' } })
      const out = await uut.score({
        title: 'T',
        company: 'C',
        category: 'c',
        locationType: 'remote',
        experienceLevel: 'mid',
        keywords: [],
        skills: [],
        summary: '',
        content: ''
      })
      assert.strictEqual(out.llmStatus, 'failed')
      assert.strictEqual(out.llmRawOutput, 'LLM_HTTP_400')
    })

    it('should log LLM retry metadata when request recovers after 503', async () => {
      sandbox.stub(console, 'log')
      sandbox.stub(wlogger, 'warn')
      const bad = new Response('temp', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      })
      sandbox
        .stub(globalThis, 'fetch')
        .onFirstCall()
        .resolves(bad)
        .onSecondCall()
        .resolves(openAiResponse(JSON.stringify({ score: 0.1, reasons: [], flags: [] })))

      const clock = sandbox.useFakeTimers({ toFake: ['setTimeout'] })
      const uut = new LlmAdapter({ config: { llmApiUrl: 'http://llm.test/v1' } })
      const p = uut.score({
        title: 'T',
        company: 'C',
        category: 'c',
        locationType: 'remote',
        experienceLevel: 'mid',
        keywords: [],
        skills: [],
        summary: '',
        content: ''
      })
      await clock.tickAsync(2000)
      await p
      assert.isTrue(wlogger.warn.calledWith('LLM retry', sinon.match.object))
      clock.restore()
    })

    it('logs err= fragment when a network failure recovers on retry', async () => {
      sandbox.stub(console, 'log')
      sandbox.stub(wlogger, 'warn')
      sandbox
        .stub(globalThis, 'fetch')
        .onFirstCall()
        .rejects(new Error('socket hang up'))
        .onSecondCall()
        .resolves(openAiResponse(JSON.stringify({ score: 0.2, reasons: [], flags: [] })))

      const clock = sandbox.useFakeTimers({ toFake: ['setTimeout'] })
      const uut = new LlmAdapter({ config: { llmApiUrl: 'http://llm.test/v1' } })
      const p = uut.score({
        title: 'T',
        company: 'C',
        category: 'c',
        locationType: 'remote',
        experienceLevel: 'mid',
        keywords: [],
        skills: [],
        summary: '',
        content: ''
      })
      await clock.tickAsync(5000)
      await p

      const logged = console.log.getCalls().map((c) => String(c.args[0]))
      const retryLine = logged.find((s) => s.includes('[llm] retry'))
      assert.include(retryLine, 'err=socket hang up')

      clock.restore()
    })
  })
})
