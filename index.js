/**
 * Host half of the per-model speed meter.
 *
 * The native composer pill reads `sessionStats`, which folds decode time and
 * output tokens over the whole session log, so a mid-session model switch mixes
 * several models into one figure. This unit keeps the same measurements but
 * buckets them by the provider/model route of the request that produced them,
 * and publishes that table to the Client (`wire.view`), which renders the
 * current route's figure in place of the shipped pill.
 *
 * Measurements mirror the shipped fold exactly (first token time -> settled
 * `assistant/message`, provider-reported output tokens); only the bucket key
 * differs.
 */

/** Projection key the Client half reads. */
const KEY = 'modelSpeed'

/** State is plain JSON written by this unit only, so validation is identity. */
const plainSchema = { parse: value => value }

/**
 * Stable bucket key for one route.
 * @param route - provider/model pair.
 * @returns a collision-free identity for any provider or model id.
 */
function keyOf(route) {
  return JSON.stringify([route.provider, route.model])
}

/**
 * Whether a stream chunk carries visible model output (the shipped timing rule).
 * @param chunk - streaming chunk.
 * @returns true for a non-empty text, reasoning, or tool-call delta.
 */
function isTokenDelta(chunk) {
  if (chunk === null || typeof chunk !== 'object') return false
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}

/**
 * Provider-reported output tokens of one usage sample.
 * @param usage - recorded usage value.
 * @returns the count, or null when it was not reported.
 */
function usageOutputTokens(usage) {
  if (usage === null || typeof usage !== 'object') return null
  const value = usage.outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Last usage chunk embedded in a settled stream, used when the event itself
 * carries no usage sample (mirrors the shipped token-usage fold).
 * @param stream - recorded stream records.
 * @returns the output token count, or null.
 */
function streamOutputTokens(stream) {
  if (!Array.isArray(stream)) return null
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record === null || typeof record !== 'object') continue
    if (record.type !== 'chunk') continue
    const chunk = record.chunk
    if (chunk === null || typeof chunk !== 'object' || chunk.type !== 'usage') continue
    const tokens = usageOutputTokens(chunk.usage)
    if (tokens !== null) return tokens
  }
  return null
}

/**
 * Time of the first token among one packed delta run's fragments.
 * @param run - packed `text-chunks`, `reasoning-chunks`, or `tool-call-chunks` record.
 * @returns the first qualifying fragment's reconstructed time, or undefined.
 */
function runFirstTokenTime(run) {
  if (run.type === 'tool-call-chunks' && run.name !== undefined) return run.time0
  const fragments = run.type === 'tool-call-chunks' ? run.args : run.texts
  if (!Array.isArray(fragments) || typeof run.time0 !== 'number') return undefined
  let time = run.time0
  for (let index = 0; index < fragments.length; index += 1) {
    if (index > 0 && typeof run.dt?.[index - 1] === 'number') time += run.dt[index - 1]
    if (fragments[index] !== '') return time
  }
  return undefined
}

/**
 * Time of the stream's first token, read from the durable stream records the way
 * the shipped statistics unit reads it.
 * @param stream - compact records from one durable Assistant settlement or attempt.
 * @returns the first token's time, or undefined when the stream carries none.
 */
function streamFirstTokenTime(stream) {
  if (!Array.isArray(stream)) return undefined
  for (const record of stream) {
    if (record === null || typeof record !== 'object') continue
    const time = record.type === 'chunk'
      ? (isTokenDelta(record.chunk) ? record.time : undefined)
      : runFirstTokenTime(record)
    if (time !== undefined) return time
  }
  return undefined
}

/**
 * Route named by one recorded request header.
 * @param data - `request/header` event payload.
 * @returns the provider/model pair, or null when it is not a recorded route.
 */
function routeOfHeader(data) {
  const header = data === null || typeof data !== 'object' ? null : data.header
  if (header === null || typeof header !== 'object') return null
  const config = header.config
  if (config === null || typeof config !== 'object') return null
  if (typeof config.provider !== 'string' || typeof config.model !== 'string') return null
  return { provider: config.provider, model: config.model }
}

/**
 * Client view: the per-route table plus the route of the last recorded request.
 * @param routes - bucket table keyed by {@link keyOf}.
 * @param last - last recorded route, or null.
 * @returns the wire payload.
 */
function buildView(routes, last) {
  return { routes, last }
}

/**
 * Build the empty state.
 * @returns initial state with an empty table.
 */
function init() {
  const routes = {}
  return { routes, last: null, open: null, view: buildView(routes, null) }
}

/**
 * Accumulate one settled step into its route's bucket.
 * @param state - state before the settlement.
 * @param open - step being closed, carrying its route.
 * @param tokens - provider-reported output tokens.
 * @param decodeMs - first token -> settlement wall time.
 * @returns next state with the bucket advanced and no open step.
 */
function settle(state, open, tokens, decodeMs) {
  const route = open.route
  const key = keyOf(route)
  const previous = state.routes[key]
  const entry = previous === undefined
    ? { provider: route.provider, model: route.model, outputTokens: tokens, decodeMs }
    : {
      provider: previous.provider,
      model: previous.model,
      outputTokens: previous.outputTokens + tokens,
      decodeMs: previous.decodeMs + decodeMs,
    }
  const routes = Object.assign({}, state.routes, { [key]: entry })
  return { routes, last: state.last, open: null, view: buildView(routes, state.last) }
}

/**
 * Fold one committed event.
 * @param state - projection state.
 * @param event - committed session event.
 * @returns the next state; the same reference when the event is not ours.
 */
function fold(state, event) {
  switch (event.type) {
    case 'request/header': {
      const route = routeOfHeader(event.data)
      if (route === null) return state
      const changed = state.last === null
        || state.last.provider !== route.provider
        || state.last.model !== route.model
      const open = state.open === null || state.open.route === null
        || state.open.route.provider !== route.provider
        || state.open.route.model !== route.model
        ? (state.open === null ? null : { ...state.open, route })
        : state.open
      if (!changed && open === state.open) return state
      return {
        routes: state.routes,
        last: route,
        open,
        view: changed ? buildView(state.routes, route) : state.view,
      }
    }
    case 'step/start':
      return {
        ...state,
        open: {
          turn: event.data.turn,
          step: event.data.step,
          route: state.last,
          firstTokenTime: null,
        },
      }
    case 'assistant/attempt': {
      // A failed attempt still records its stream; its first token starts the
      // decode clock that the retried attempt inherits, as the shipped fold does.
      const open = state.open
      if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
      if (open.firstTokenTime !== null) return state
      const first = streamFirstTokenTime(event.data.stream)
      if (first === undefined) return state
      return { ...state, open: { ...open, firstTokenTime: first } }
    }
    case 'assistant/message': {
      const open = state.open
      if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
      const data = event.data
      const tokens = data.usage !== undefined ? usageOutputTokens(data.usage) : streamOutputTokens(data.stream)
      const first = open.firstTokenTime !== null ? open.firstTokenTime : (streamFirstTokenTime(data.stream) ?? null)
      if (tokens === null || open.route === null || first === null) {
        return { ...state, open: null }
      }
      return settle(state, open, tokens, Math.max(0, event.time - first))
    }
    case 'step/end': {
      const open = state.open
      if (open === null || open.turn !== event.data.turn || open.step !== event.data.step) return state
      return { ...state, open: null }
    }
    default:
      return state
  }
}

export const inject = ['sessionProjections']

/**
 * Register the per-route speed unit on the Host.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  void ctx.sessionProjections.register({
    key: KEY,
    stateVersion: 2,
    stateSchema: plainSchema,
    init,
    apply: fold,
    wire: { viewSchema: plainSchema, view: state => state.view },
  }).catch((error) => {
    console.error('dsh-tps-recalibrate: projection registration failed', error)
  })
}

