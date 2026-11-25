/**
 * Client half: the pill must read the selected model's own bucket, flip when
 * the selection changes, and keep the shipped reading otherwise.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

const NS = 'dsh-tps-splitter'

/**
 * Minimal React stand-in: elements are plain objects, function components are
 * invoked by the text walker, and hook results are supplied by the caller.
 */
function createReact() {
  return {
    createElement(type, props, ...children) {
      return { type, props: { ...props, children: children.length <= 1 ? children[0] : children } }
    },
    Fragment: Symbol('Fragment'),
    useMemo: produce => produce(),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: initial => ({ current: initial ?? null }),
    useEffect: () => undefined,
    useId: () => ':r1:',
  }
}

/**
 * Load the client module and capture its plugin definition.
 * @returns {object} the plugin definition returned by the factory.
 */
function loadPlugin() {
  let registration
  const sandbox = {
    window: { __ModuleLoader__: { load: (record) => { registration = record } } },
    console,
    document: { addEventListener() {}, removeEventListener() {}, body: {} },
    ResizeObserver: undefined,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(registration !== undefined, 'client module registers through the module loader')
  assert.equal(registration.id, 'dsh-tps-splitter')
  const react = createReact()
  return registration.factory(name => {
    if (name === 'react') return react
    if (name === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`unexpected require: ${name}`)
  })
}

/**
 * Mount the client half against a fake context.
 * @returns {{plugin: object, slot: object, component: Function, locales: object}} captured registration.
 */
function mount() {
  const plugin = loadPlugin()
  const localeCalls = []
  let slot = null
  let component = null
  const ctx = {
    effect: produce => produce(),
    locale: { register: (ns, dicts) => { localeCalls.push({ ns, dicts }) } },
    configForms: { get: () => ({ getSnapshot: () => ({ value: { performanceUsage: 'detailed' } }), subscribe: () => () => {} }) },
    slots: {
      inject: (name, callback) => {
        callback()
        return () => {}
      },
      register: (options, candidate) => {
        slot = options
        component = candidate
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  return { plugin, slot, component, locales: localeCalls }
}

/**
 * Interpolate one dictionary entry like the locale service does.
 * @param {object} dict dictionary of templates.
 * @returns {Function} translate seat.
 */
function translate(dict) {
  return (key, params) => String(dict[key] ?? key)
    .replace(/\{(\w+)\}/g, (match, name) => (params !== null && params !== undefined && name in params ? String(params[name]) : match))
}

/**
 * Collect the rendered text of a fake element tree, invoking function components.
 * @param {unknown} node tree node.
 * @param {object} t translate seat forwarded to function components.
 * @returns {string} visible text.
 */
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(child => textOf(child, null)).join('')
  if (typeof node.type === 'function') {
    const props = { ...node.props }
    if (props.t === undefined) props.t = translateZh
    return textOf(node.type({ ...props, t: props.t }))
  }
  if (node.type === 'style') return ''
  return textOf(node.props?.children)
}

const zhDict = {
  tokensPerSecond: '{tps} tok/s',
  counts: '{turns} 轮 {steps} 步',
  compactSeconds: '{seconds}秒',
  compactMinutes: '{minutes}分{seconds}秒',
  dialogTitle: '会话统计',
  llmTime: '模型用时',
  toolTime: '工具调用用时',
  ttft: '首 token 平均（TTFT）',
  speed: '当前模型输出速度（TPS）',
  model: '模型',
}
const translateZh = translate(zhDict)

const routeA = { provider: 'deepseek', model: 'model-a' }
const routeB = { provider: 'deepseek', model: 'model-b' }

const sessionStats = {
  turns: 3, steps: 5, llmMs: 12_000, toolMs: 0, ttftMs: 600, ttftSteps: 3, decodeMs: 9000, decodeTokens: 4000,
}

const modelSpeed = {
  routes: {
    [JSON.stringify([routeA.provider, routeA.model])]: {
      provider: routeA.provider, model: routeA.model, outputTokens: 300, decodeMs: 1000,
    },
    [JSON.stringify([routeB.provider, routeB.model])]: {
      provider: routeB.provider, model: routeB.model, outputTokens: 100, decodeMs: 100,
    },
  },
  last: routeA,
}

/**
 * Render the pill with the given projection values.
 * @param {object} options projection values, mode and chat nodes.
 * @returns {{text: string, element: object}} rendered text and the element.
 */
function renderPill({ component, mode = 'detailed', projections = {}, nodes = [] }) {
  const useProjection = key => projections[key]
  const element = component({
    t: translateZh,
    useProjection,
    useChat: selector => selector({ legacy: { nodes } }),
    usePerformanceUsage: selector => selector(mode),
  })
  return { text: textOf(element), element }
}

test('registers the shipped activity cell at a shadowing priority', () => {
  const { slot, locales } = mount()
  assert.equal(slot.name, 'conversation.composer.dock')
  assert.equal(slot.id, 'activity')
  assert.equal(slot.order, 0)
  assert.equal(slot.priority, -1, 'a lower priority replaces the shipped pill instead of colliding')
  assert.equal(slot.locale, NS)
  assert.deepEqual(locales.map(entry => entry.ns), [NS])
  for (const key of Object.keys(zhDict)) {
    assert.ok(typeof locales[0].dicts.zh[key] === 'string', `zh dictionary carries ${key}`)
    assert.ok(typeof locales[0].dicts.en[key] === 'string', `en dictionary carries ${key}`)
  }
})

test('the selected model decides the speed, not the session total', () => {
  const { component } = mount()
  const { text } = renderPill({
    component,
    projections: {
      sessionStats,
      modelSpeed,
      modelSelection: { lastUsed: routeB, next: routeB },
    },
  })
  assert.match(text, /3 轮 5 步/)
  assert.match(text, /1000 tok\/s/, 'model-b decodes 100 tokens in 100ms')
  assert.doesNotMatch(text, /300 tok\/s/, 'model-a speed is not mixed in')
})

test('switching the selection flips the reading without new output', () => {
  const { component } = mount()
  const { text } = renderPill({
    component,
    projections: {
      sessionStats,
      modelSpeed,
      modelSelection: { lastUsed: routeA, next: routeA },
    },
  })
  assert.match(text, /300 tok\/s/)
  assert.doesNotMatch(text, /1000 tok\/s/)
})

test('a selection with no measurements yet shows no speed', () => {
  const { component } = mount()
  const { text } = renderPill({
    component,
    projections: {
      sessionStats,
      modelSpeed,
      modelSelection: { lastUsed: routeA, next: { provider: 'other', model: 'fresh' } },
    },
  })
  assert.match(text, /3 轮 5 步/)
  assert.doesNotMatch(text, /tok\/s/)
})

test('without a recorded selection the last request route is used', () => {
  const { component } = mount()
  const { text } = renderPill({
    component,
    projections: { sessionStats, modelSpeed, modelSelection: { lastUsed: null, next: null } },
  })
  assert.match(text, /300 tok\/s/, 'the last recorded request used model-a')
})

test('a selection overrides the last request route', () => {
  const { component } = mount()
  const swapped = { ...modelSpeed, last: routeB }
  const { text } = renderPill({
    component,
    projections: {
      sessionStats,
      modelSpeed: swapped,
      modelSelection: { lastUsed: routeA, next: routeA },
    },
  })
  assert.match(text, /300 tok\/s/)
  assert.doesNotMatch(text, /1000 tok\/s/)
})

test('compact mode keeps only the speed', () => {
  const { component } = mount()
  const { text } = renderPill({
    component,
    mode: 'compact',
    projections: { sessionStats, modelSpeed, modelSelection: { lastUsed: routeB, next: routeB } },
  })
  assert.equal(text, '1000 tok/s')
})

test('an absent projection falls back to the window fold for counts', () => {
  const { component } = mount()
  const nodes = [
    { kind: 'assistant', turn: 1, step: 1, time: 1600, timing: { stepStartTime: 1000, firstTokenTime: 1100, completedTime: 1600 } },
  ]
  const { text } = renderPill({ component, projections: {}, nodes })
  assert.match(text, /1 轮 1 步/)
  assert.doesNotMatch(text, /tok\/s/)
})
