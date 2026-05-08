/*
  Unit tests for fetch-with-retry helpers (LLM HTTP client).
*/

import { assert } from 'chai'
import sinon from 'sinon'

import {
  isRetryableHttpStatus,
  sleepMs,
  nextBackoffMs,
  fetchPostWithRetry
} from '../../../../src/adapters/llm/fetch-with-retry.js'

function jsonOkResponse () {
  return new Response('{}', {
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('#fetch-with-retry', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    sandbox.stub(Math, 'random').returns(0)
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('isRetryableHttpStatus', () => {
    it('should return true for common transient statuses', () => {
      assert.isTrue(isRetryableHttpStatus(429))
      assert.isTrue(isRetryableHttpStatus(503))
    })

    it('should return false for non-retryable client errors', () => {
      assert.isFalse(isRetryableHttpStatus(400))
      assert.isFalse(isRetryableHttpStatus(401))
      assert.isFalse(isRetryableHttpStatus(422))
    })
  })

  describe('nextBackoffMs', () => {
    it('should scale with attempt and multiplier (no jitter when random is 0)', () => {
      const ms = nextBackoffMs(0, 1000, 10000, 2, 0.25)
      assert.strictEqual(ms, 1000)
      const ms2 = nextBackoffMs(1, 1000, 10000, 2, 0.25)
      assert.strictEqual(ms2, 2000)
    })

    it('should cap delay at maxMs', () => {
      const ms = nextBackoffMs(10, 1000, 5000, 2, 0)
      assert.isAtMost(ms, 5000)
    })
  })

  describe('sleepMs', () => {
    it('should resolve after timeout', async () => {
      const clock = sandbox.useFakeTimers({ toFake: ['setTimeout'] })
      const p = sleepMs(5000)
      await clock.tickAsync(5000)
      await p
      clock.restore()
    })
  })

  describe('fetchPostWithRetry', () => {
    it('should return ok response on first success', async () => {
      const fetchStub = sandbox.stub(globalThis, 'fetch').resolves(jsonOkResponse())
      const res = await fetchPostWithRetry('http://example.com', { method: 'POST' })
      assert.isTrue(res.ok)
      assert.strictEqual(fetchStub.callCount, 1)
    })

    it('should retry on retryable HTTP status then succeed', async () => {
      const bad = new Response('busy', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      })
      const fetchStub = sandbox
        .stub(globalThis, 'fetch')
        .onFirstCall()
        .resolves(bad)
        .onSecondCall()
        .resolves(jsonOkResponse())

      const clock = sandbox.useFakeTimers({ toFake: ['setTimeout'] })
      const onRetry = sandbox.spy()
      const p = fetchPostWithRetry(
        'http://example.com',
        { method: 'POST' },
        {
          maxAttempts: 3,
          initialDelayMs: 500,
          maxDelayMs: 10000,
          multiplier: 2,
          jitterRatio: 0,
          onRetry
        }
      )

      await clock.tickAsync(500)
      const res = await p
      assert.isTrue(res.ok)
      assert.strictEqual(fetchStub.callCount, 2)
      assert.isTrue(onRetry.calledOnce)
      assert.strictEqual(onRetry.firstCall.args[0].reason, 'HTTP_503')
      clock.restore()
    })

    it('should return non-ok Response with replayable body on final retryable failure', async () => {
      const mk503 = () =>
        new Response('{"error":"down"}', {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      sandbox.stub(globalThis, 'fetch').onFirstCall().resolves(mk503()).onSecondCall().resolves(mk503())

      const clock = sandbox.useFakeTimers({ toFake: ['setTimeout'] })

      const p = fetchPostWithRetry('http://example.com', { method: 'POST' }, {
        maxAttempts: 2,
        initialDelayMs: 100,
        maxDelayMs: 10000,
        multiplier: 2,
        jitterRatio: 0
      })

      await clock.tickAsync(200)
      const res = await p
      assert.strictEqual(res.status, 503)
      assert.strictEqual(await res.text(), '{"error":"down"}')
      clock.restore()
    })

    it('should return immediately on non-retryable HTTP error', async () => {
      const bad = new Response('bad req', {
        status: 400,
        headers: { 'Content-Type': 'text/plain' }
      })
      const fetchStub = sandbox.stub(globalThis, 'fetch').resolves(bad)
      const res = await fetchPostWithRetry('http://example.com', { method: 'POST' })
      assert.strictEqual(res.status, 400)
      assert.strictEqual(fetchStub.callCount, 1)
      assert.strictEqual(await res.text(), 'bad req')
    })

    it('should retry on network error then succeed', async () => {
      const fetchStub = sandbox
        .stub(globalThis, 'fetch')
        .onFirstCall()
        .rejects(new Error('ENOTFOUND'))
        .onSecondCall()
        .resolves(jsonOkResponse())

      const clock = sandbox.useFakeTimers({ toFake: ['setTimeout'] })
      const onRetry = sandbox.spy()
      const p = fetchPostWithRetry(
        'http://example.com',
        { method: 'POST' },
        { maxAttempts: 2, initialDelayMs: 100, jitterRatio: 0, onRetry }
      )
      await clock.tickAsync(200)
      const res = await p
      assert.isTrue(res.ok)
      assert.strictEqual(fetchStub.callCount, 2)
      assert.isTrue(onRetry.calledOnce)
      assert.strictEqual(onRetry.firstCall.args[0].reason, 'network_error')
      assert.include(onRetry.firstCall.args[0].error, 'ENOTFOUND')
      clock.restore()
    })

    it('should throw last network error when attempts exhausted', async () => {
      const err = new Error('boom')
      sandbox.stub(globalThis, 'fetch').rejects(err)
      const clock = sandbox.useFakeTimers({ toFake: ['setTimeout'] })
      const p = fetchPostWithRetry('http://example.com', { method: 'POST' }, {
        maxAttempts: 2,
        initialDelayMs: 50,
        jitterRatio: 0
      })
      await clock.tickAsync(5000)
      try {
        await p
        assert.fail('expected throw')
      } catch (e) {
        assert.strictEqual(e, err)
      }
      clock.restore()
    })

    it('should coerce maxAttempts below 1 to 1', async () => {
      sandbox.stub(globalThis, 'fetch').rejects(new Error('solo'))
      try {
        await fetchPostWithRetry('http://example.com', { method: 'POST' }, {
          maxAttempts: 0,
          jitterRatio: 0
        })
        assert.fail('expected throw')
      } catch (e) {
        assert.include(e.message, 'solo')
      }
    })

    it('should invoke onRetry with bodySnippet when HTTP retry', async () => {
      const longBody = 'x'.repeat(600)
      const bad = new Response(longBody, { status: 502 })
      sandbox.stub(globalThis, 'fetch').onFirstCall().resolves(bad).onSecondCall().resolves(jsonOkResponse())
      const clock = sandbox.useFakeTimers({ toFake: ['setTimeout'] })
      const onRetry = sandbox.spy()
      const p = fetchPostWithRetry(
        'http://example.com',
        { method: 'POST' },
        { maxAttempts: 2, initialDelayMs: 10, jitterRatio: 0, onRetry }
      )
      await clock.tickAsync(20)
      await p
      assert.isTrue(onRetry.calledOnce)
      assert.lengthOf(onRetry.firstCall.args[0].bodySnippet, 500)
      clock.restore()
    })
  })
})
