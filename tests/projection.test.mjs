/** Host fold: per-route decode buckets, retry handling, and view stability. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, inject } from '../index.js'

/**
 * Run the plugin's Host apply against a fake context and return the registered unit.
 * @returns {object} the registered projection definition.
 */
function registeredUnit() {
  let definition
  apply({
    sessionProjections: {
      register: (candidate) => {
        definition = candidate
        return Promise.resolve({ dispose: async () => {} })
      },
    },
  })
  assert.ok(definition !== undefined, 'apply registers one projection unit')
  return definition
}

let seq = 0
function event(type, data, time) {
  seq += 1
  return { type, seq, time, data }
}

function header(provider, model, time) {
  return event('request/header', { header: { config: { provider, model } }, reason: 'change' }, time)
}

function stepStart(turn, step, time) {
  return event('step/start', { turn, step }, time)
}

function stepEnd(turn, step, time) {
  return event('step/end', { turn, step }, time)
}

/** Packed text delta run: fragment times are time0, time0+dt[0], ... */
function textRun(time0, texts, dt) {
  return { type: 'text-chunks', time0, index: 0, dt, texts }
}

function rawChunk(time, chunk) {
  return { type: 'chunk', time, chunk }
}

function attempt(turn, step, stream, time) {
  return event('assistant/attempt', { turn, step, stream }, time)
}

function settle(turn, step, outputTokens, time, stream) {
  return event('assistant/message', {
    turn,
    step,
    message: { role: 'assistant' },
    stream: stream ?? [],
    usage: outputTokens === undefined ? undefined : { inputTokens: 100, outputTokens },
  }, time)
}

function foldAll(unit, events) {
  let state = unit.init({ id: 's' }, 0)
  for (const candidate of events) state = unit.apply(state, candidate)
  return state
}

test('inject declares sessionProjections', () => {
  assert.deepEqual(inject, ['sessionProjections'])
})

test('two models stay in separate buckets', () => {
  const unit = registeredUnit()
  const state = foldAll(unit, [
    header('deepseek', 'model-a', 1000),
    stepStart(1, 1, 1000),
    settle(1, 1, 300, 2100, [textRun(1100, ['', 'x'], [0])]),
    stepEnd(1, 1, 2100),
    header('deepseek', 'model-b', 3000),
    stepStart(2, 1, 3000),
    settle(2, 1, 100, 3200, [rawChunk(3100, { type: 'text-delta', index: 0, text: 'y' })]),
    stepEnd(2, 1, 3200),
  ])
  const bucketA = state.view.routes[JSON.stringify(['deepseek', 'model-a'])]
  const bucketB = state.view.routes[JSON.stringify(['deepseek', 'model-b'])]
  assert.equal(bucketA.outputTokens, 300)
  assert.equal(bucketA.decodeMs, 1000, 'decode starts at the packed run first non-empty fragment')
  assert.equal(bucketB.outputTokens, 100)
  assert.equal(bucketB.decodeMs, 100)
  assert.equal(state.view.last.model, 'model-b', 'last route names the newest request')
  assert.equal(Object.keys(state.view.routes).length, 2)
})

test('a retried attempt keeps the first token of the replaced attempt', () => {
  const unit = registeredUnit()
  const state = foldAll(unit, [
    header('deepseek', 'model-a', 1000),
    stepStart(1, 1, 1000),
    attempt(1, 1, [rawChunk(1200, { type: 'text-delta', index: 0, text: 'x' })], 1300),
    event('llm/retry-started', { turn: 1, step: 1 }, 1300),
    header('deepseek', 'model-a', 1400),
    settle(1, 1, 50, 1600),
  ])
  const bucket = state.view.routes[JSON.stringify(['deepseek', 'model-a'])]
  assert.equal(bucket.outputTokens, 50)
  assert.equal(bucket.decodeMs, 400, 'decode starts at the first token, across the replaced attempt')
})

test('a retried step without a new header keeps its route', () => {
  const unit = registeredUnit()
  const state = foldAll(unit, [
    header('deepseek', 'model-a', 1000),
    stepStart(1, 1, 1000),
    attempt(1, 1, [rawChunk(1200, { type: 'text-delta', index: 0, text: 'x' })], 1300),
    event('llm/retry-started', { turn: 1, step: 1 }, 1300),
    settle(1, 1, 50, 1600),
  ])
  const bucket = state.view.routes[JSON.stringify(['deepseek', 'model-a'])]
  assert.equal(bucket.outputTokens, 50, 'an unchanged route reuses the last request header')
  assert.equal(bucket.decodeMs, 400)
})

test('steps without usage or without a token delta add nothing', () => {
  const unit = registeredUnit()
  const state = foldAll(unit, [
    header('deepseek', 'model-a', 1000),
    stepStart(1, 1, 1000),
    settle(1, 1, 500, 1500),
    stepStart(2, 1, 2000),
    settle(2, 1, undefined, 2600, [rawChunk(2100, { type: 'finish', reason: { kind: 'stop' } })]),
  ])
  assert.deepEqual(state.view.routes, {})
})

test('usage may arrive as a stream usage chunk', () => {
  const unit = registeredUnit()
  const state = foldAll(unit, [
    header('deepseek', 'model-a', 1000),
    stepStart(1, 1, 1000),
    settle(1, 1, undefined, 1600, [
      rawChunk(1100, { type: 'text-delta', index: 0, text: 'x' }),
      rawChunk(1500, { type: 'usage', usage: { inputTokens: 10, outputTokens: 200 } }),
    ]),
  ])
  const bucket = state.view.routes[JSON.stringify(['deepseek', 'model-a'])]
  assert.equal(bucket.outputTokens, 200)
  assert.equal(bucket.decodeMs, 500)
})

test('a name-bearing Tool-call run starts at its first member', () => {
  const unit = registeredUnit()
  const state = foldAll(unit, [
    header('deepseek', 'model-a', 1000),
    stepStart(1, 1, 1000),
    settle(1, 1, 40, 2000, [{
      type: 'tool-call-chunks', time0: 1500, index: 0, dt: [100], id: 'call-1', name: 'read', args: ['', '{}'],
    }]),
  ])
  const bucket = state.view.routes[JSON.stringify(['deepseek', 'model-a'])]
  assert.equal(bucket.decodeMs, 500, 'a named Tool-call run starts at its run time')
})

test('an in-step event without a visible change keeps the published view reference', () => {
  const unit = registeredUnit()
  let state = foldAll(unit, [
    header('deepseek', 'model-a', 1000),
    stepStart(1, 1, 1000),
    settle(1, 1, 300, 1600, [rawChunk(1100, { type: 'text-delta', index: 0, text: 'x' })]),
  ])
  const published = state.view
  state = unit.apply(state, stepStart(2, 1, 2000))
  assert.equal(state.view, published, 'opening a step does not republish')
  state = unit.apply(state, event('tool/call', { turn: 2, step: 1, callId: 'c', name: 'x', arguments: '{}' }, 2050))
  assert.equal(state.view, published, 'an unrelated event does not republish')
})

test('a non-durable live chunk event is ignored', () => {
  const unit = registeredUnit()
  let state = foldAll(unit, [header('deepseek', 'model-a', 1000), stepStart(1, 1, 1000)])
  const before = state
  state = unit.apply(state, event('assistant/live-chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } }, 1100))
  assert.equal(state, before, 'timing comes from the durable stream, not live chunks')
})

test('the client view only names routes, never the open step', () => {
  const unit = registeredUnit()
  const state = foldAll(unit, [header('deepseek', 'model-a', 1000), stepStart(1, 1, 1000)])
  assert.deepEqual(Object.keys(state.view).sort(), ['last', 'routes'])
  assert.equal(state.view.last.model, 'model-a')
})
