/**
 * Client half of the per-model speed meter.
 *
 * It takes over the shipped `activity` composer pill (`conversation.composer.dock`
 * entry id `activity`, shadowed at a lower priority) and keeps its reading
 * unchanged except for one figure: the decode speed now comes from the
 * `modelSpeed` Host projection for the route the composer is currently on,
 * instead of from the whole-session `sessionStats` fold. Switching model
 * therefore re-reads the pill against the new route immediately, and counts,
 * dialog times and the compact/detailed preference stay as they were.
 */
window.__ModuleLoader__.load({
  id: 'dsh-tps-recalibrate',
  factory(require) {
    const React = require('react')
    const { createPortal } = require('react-dom')

    const NS = 'dsh-tps-recalibrate'

    const zh = {
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

    const en = {
      tokensPerSecond: '{tps} tok/s',
      counts: '{turns} turns {steps} steps',
      compactSeconds: '{seconds}s',
      compactMinutes: '{minutes}m{seconds}s',
      dialogTitle: 'Session statistics',
      llmTime: 'LLM time',
      toolTime: 'Tool time',
      ttft: 'Avg time to first token (TTFT)',
      speed: 'Current model tokens per second (TPS)',
      model: 'Model',
    }

    const CSS = `
.msp-anchor {
  display: inline-flex;
  min-width: 0;
  font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
}
.msp-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  max-width: 100%;
  padding: 1px 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-variant-numeric: tabular-nums;
  line-height: inherit;
  white-space: nowrap;
}
.msp-pill svg {
  width: 14px;
  height: 14px;
  flex: none;
}
button.msp-pill {
  cursor: pointer;
}
button.msp-pill[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
@media (hover: hover) {
  button.msp-pill:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-secondary);
  }
}
.msp-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.msp-sep {
  color: var(--dsw-alias-separator-primary);
  margin: 0 6px;
}
.msp-panel {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  width: max-content;
  min-width: min(300px, calc(100vw - 24px));
  max-width: min(440px, calc(100vw - 24px));
  padding: 16px;
  border: 0;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  cursor: default;
  max-height: calc(100dvh - 12px - max(12px, var(--dsh-frame-overlay-top, 12px)));
  overflow-x: hidden;
  overflow-y: auto;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
  position-area: none;
  top: max(12px, var(--dsh-frame-overlay-top, 12px));
  bottom: max(12px, calc(anchor(top) + 8px));
  left: max(12px, anchor(left));
  right: 12px;
  position-try-fallbacks: --msp-stat-window, --msp-stat-opposite, --msp-stat-wide-opposite, --msp-stat-tall, --msp-stat-viewport;
  align-self: end;
  justify-self: start;
  height: fit-content;
  min-height: 0;
  margin: 0;
}
.msp-title {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 8px;
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
.msp-titleRule {
  margin-bottom: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.msp-titleValue {
  font-variant-numeric: tabular-nums;
}
.msp-titleLabel {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.msp-titleLabel svg {
  width: 14px;
  height: 14px;
  flex: none;
}
.msp-details {
  display: grid;
  grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
  gap: 6px 16px;
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
}
.msp-details dt,
.msp-details dd {
  min-width: 0;
  margin: 0;
}
.msp-details dd {
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.msp-details .msp-route {
  overflow-wrap: anywhere;
}
@position-try --msp-stat-window {
  position-area: none;
  top: max(12px, var(--dsh-frame-overlay-top, 12px));
  bottom: max(12px, calc(anchor(top) + 8px));
  left: 12px;
  right: 12px;
  margin: 0;
  align-self: safe end;
  justify-self: safe end;
}
@position-try --msp-stat-opposite {
  top: max(12px, calc(anchor(bottom) + 8px));
  bottom: 12px;
  align-self: start;
}
@position-try --msp-stat-wide-opposite {
  top: max(12px, calc(anchor(bottom) + 8px));
  bottom: 12px;
  left: 12px;
  right: 12px;
  align-self: start;
  justify-self: safe end;
}
@position-try --msp-stat-tall {
  position-area: none;
  top: max(12px, var(--dsh-frame-overlay-top, 12px));
  bottom: 12px;
  left: max(12px, anchor(left));
  right: 12px;
  margin: 0;
  align-self: safe start;
  justify-self: start;
}
@position-try --msp-stat-viewport {
  position-area: none;
  inset: max(12px, var(--dsh-frame-overlay-top, 12px)) 12px 12px;
  margin: 0;
  align-self: safe start;
  justify-self: safe end;
}
`

    /**
     * Decode throughput figure, matching the shipped formatting rule.
     * @param {number} tps tokens per second.
     * @returns {string} display number without unit.
     */
    function formatTokensPerSecond(tps) {
      const clamped = Math.max(0, tps)
      return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
    }

    /**
     * Compact duration: 45.2s under a minute, 2m42s from there on.
     * @param {number} ms duration in milliseconds.
     * @param {(key: string, params?: object) => string} t translator.
     * @returns {string} display string.
     */
    function formatDuration(ms, t) {
      const total = ms / 1000
      if (total < 60) return t('compactSeconds', { seconds: Math.round(total * 10) / 10 })
      const whole = Math.round(total)
      return t('compactMinutes', { minutes: Math.floor(whole / 60), seconds: whole % 60 })
    }

    /**
     * Timing readings of one settled assistant node, mirroring the shipped fold.
     * @param {object} node settled assistant node.
     * @returns {{ttftMs: number | null, decodeMs: number | null, outputTokens: number | null}} readings.
     */
    function assistantStepReading(node) {
      const timing = node.timing
      const ttftMs = timing !== undefined && timing.stepStartTime !== null && timing.firstTokenTime !== null
        ? Math.max(0, timing.firstTokenTime - timing.stepStartTime)
        : null
      const decodeMs = timing !== undefined && timing.firstTokenTime !== null
        ? Math.max(0, timing.completedTime - timing.firstTokenTime)
        : null
      const usage = node.usage
      const outputTokens = typeof usage === 'object' && usage !== null
        && typeof usage.outputTokens === 'number' && Number.isFinite(usage.outputTokens) && usage.outputTokens >= 0
        ? usage.outputTokens
        : null
      return { ttftMs, decodeMs, outputTokens }
    }

    /**
     * Window-scoped fallback totals for an assembly without the `sessionStats` projection.
     * @param {readonly object[]} nodes chat snapshot nodes.
     * @returns {object} counts and summed wall times.
     */
    function deriveStats(nodes) {
      const turns = new Set()
      let steps = 0
      let llmMs = 0
      let toolMs = 0
      let ttftMs = 0
      let ttftSteps = 0
      let decodeMs = 0
      let decodeTokens = 0
      for (const node of nodes) {
        if (node.kind === 'tool-result') {
          if (node.callTime !== null && node.callTime !== undefined) toolMs += Math.max(0, node.time - node.callTime)
          continue
        }
        if (node.kind !== 'assistant') continue
        turns.add(node.turn)
        steps += 1
        if (node.timing !== undefined && node.timing.stepStartTime !== null) {
          llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime)
        }
        const reading = assistantStepReading(node)
        if (reading.ttftMs !== null) {
          ttftMs += reading.ttftMs
          ttftSteps += 1
        }
        if (reading.decodeMs !== null && reading.outputTokens !== null) {
          decodeMs += reading.decodeMs
          decodeTokens += reading.outputTokens
        }
      }
      return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
    }

    /**
     * Route identity of one recorded model selection.
     * @param {unknown} value projection selection value.
     * @returns {{provider: string, model: string} | null} the route, or null.
     */
    function routeOf(value) {
      if (value === null || typeof value !== 'object') return null
      const provider = value.provider
      const model = value.model
      if (typeof provider !== 'string' || typeof model !== 'string') return null
      return { provider, model }
    }

    /**
     * Speed of the route the composer is currently on.
     * @param {unknown} modelSpeed the `modelSpeed` projection value.
     * @param {unknown} selection the `modelSelection` projection value.
     * @returns {{route: {provider: string, model: string}, tps: number} | null} current route and its speed.
     */
    function currentRouteSpeed(modelSpeed, selection) {
      if (modelSpeed === null || typeof modelSpeed !== 'object') return null
      const routes = modelSpeed.routes
      if (routes === null || typeof routes !== 'object') return null
      const selected = routeOf(selection === null || typeof selection !== 'object' ? null : selection.next)
      const last = routeOf(modelSpeed.last)
      const route = selected ?? last
      if (route === null) return null
      const entry = routes[JSON.stringify([route.provider, route.model])]
      if (entry === null || typeof entry !== 'object') return { route, tps: null }
      const decodeMs = typeof entry.decodeMs === 'number' ? entry.decodeMs : 0
      const outputTokens = typeof entry.outputTokens === 'number' ? entry.outputTokens : 0
      if (!(decodeMs > 0)) return { route, tps: null }
      return { route, tps: outputTokens / (decodeMs / 1000) }
    }

    /** Gauge glyph drawn by this plugin (the shipped pill's icon is not importable). */
    function GaugeIcon() {
      return React.createElement(
        'svg',
        { viewBox: '0 0 20 20', 'aria-hidden': true, focusable: 'false' },
        React.createElement('path', {
          d: 'M3.1 15.2a8 8 0 1 1 13.8 0',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '1.3',
          'stroke-linecap': 'round',
        }),
        React.createElement('path', {
          d: 'M10 11.7 13.1 7.9',
          fill: 'none',
          stroke: 'currentColor',
          'stroke-width': '1.3',
          'stroke-linecap': 'round',
        }),
        React.createElement('circle', { cx: '10', cy: '11.7', r: '1.15', fill: 'currentColor' }),
      )
    }

    /**
     * Trigger-anchored dialog seat: open state, CSS anchor identity, outside-close.
     * @returns {object} the seat.
     */
    function useStatDialog() {
      const [open, setOpen] = React.useState(false)
      const rootRef = React.useRef(null)
      const panelRef = React.useRef(null)
      const anchorName = `--msp-stat-${React.useId().replace(/[:]/g, '')}`
      React.useEffect(() => {
        if (!open) return undefined
        const inside = target => (rootRef.current !== null && rootRef.current.contains(target))
          || (panelRef.current !== null && panelRef.current.contains(target))
        const onPointerDown = event => { if (!inside(event.target)) setOpen(false) }
        const onClick = event => { if (!inside(event.target)) setOpen(false) }
        const onKeyDown = event => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('click', onClick, true)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('click', onClick, true)
        }
      }, [open])
      return { open, setOpen, rootRef, panelRef, anchorName }
    }

    /**
     * Whether the label is cut off, so the full reading can be offered as a tooltip.
     * @param {object} ref root element ref.
     * @param {string} text full reading.
     * @returns {boolean} whether the label is clipped.
     */
    function useClipped(ref, text) {
      const [clipped, setClipped] = React.useState(false)
      React.useEffect(() => {
        const node = ref.current
        if (node === null) return undefined
        const label = node.querySelector('.msp-label')
        if (label === null) {
          setClipped(false)
          return undefined
        }
        const check = () => { setClipped(label.scrollWidth > label.clientWidth + 1) }
        check()
        if (typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(check)
        observer.observe(node)
        return () => { observer.disconnect() }
      }, [ref, text])
      return clipped
    }

    /** One or two reading segments joined by the separator glyph. */
    function reading(first, second) {
      if (second === null) return { label: first, text: first }
      return {
        label: React.createElement(React.Fragment, null,
          first,
          React.createElement('span', { className: 'msp-sep', 'aria-hidden': true }, '\u00b7'),
          second),
        text: `${first} \u00b7 ${second}`,
      }
    }

    /**
     * Static reading pill: no dialog rows to open.
     * @param {object} props stat id, label and full text.
     * @returns {object} element.
     */
    function PlainPill({ stat, label, text }) {
      const ref = React.useRef(null)
      const clipped = useClipped(ref, text)
      return React.createElement(
        'span',
        { ref, className: 'msp-anchor', 'data-composer-stat': stat },
        React.createElement(
          'span',
          { className: 'msp-pill', 'aria-label': text, title: clipped ? text : undefined },
          React.createElement(GaugeIcon, null),
          React.createElement('span', { className: 'msp-label' }, label),
        ),
      )
    }

    /**
     * Pill button opening its own portaled dialog.
     * @param {object} props stat id, label, full text, title and rows.
     * @returns {object} element.
     */
    function DialogPill({ stat, label, text, title, titleValue, rows }) {
      const { open, setOpen, rootRef, panelRef, anchorName } = useStatDialog()
      return React.createElement(
        'span',
        { ref: rootRef, className: 'msp-anchor', 'data-composer-stat': stat, style: { anchorName } },
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'msp-pill',
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-label': text,
            title: text,
            onClick: () => { setOpen(!open) },
          },
          React.createElement(GaugeIcon, null),
          React.createElement('span', { className: 'msp-label' }, label),
        ),
        open && createPortal(
          React.createElement(
            'div',
            {
              ref: panelRef,
              className: 'msp-panel',
              role: 'dialog',
              'aria-label': title,
              'data-session-stats-details': '',
              style: { positionAnchor: anchorName },
            },
            React.createElement(
              'div',
              { className: 'msp-title' },
              React.createElement(
                'span',
                { className: 'msp-titleLabel' },
                React.createElement(GaugeIcon, null),
                title,
              ),
              titleValue === undefined ? null : React.createElement('span', { className: 'msp-titleValue' }, titleValue),
            ),
            React.createElement('div', { className: 'msp-titleRule', 'aria-hidden': true }),
            React.createElement(
              'dl',
              { className: 'msp-details' },
              ...rows.map((row, index) => React.createElement(React.Fragment, { key: index },
                React.createElement('dt', null, row.name),
                React.createElement('dd', { className: row.wide ? 'msp-route' : undefined }, row.value))),
            ),
          ),
          document.body,
        ),
      )
    }

    /**
     * Replacement for the shipped `activity` pill: same reading, speed per model.
     * @param {object} props slot props (standard hooks, projector and locale seat).
     * @returns {object | null} element.
     */
    function ModelSpeedPill(props) {
      const t = props.t
      const useProjection = props.useProjection
      const useChat = props.useChat
      const usePerformanceUsage = typeof props.usePerformanceUsage === 'function'
        ? props.usePerformanceUsage
        : () => 'detailed'
      const mode = usePerformanceUsage(value => value)
      const nodes = useChat(snapshot => snapshot.legacy.nodes)
      const projected = useProjection('sessionStats')
      const stats = React.useMemo(() => projected ?? deriveStats(nodes), [projected, nodes])
      const modelSpeed = useProjection('modelSpeed')
      const selection = useProjection('modelSelection')
      const current = React.useMemo(() => currentRouteSpeed(modelSpeed, selection), [modelSpeed, selection])
      const speed = current !== null && current.tps !== null
        ? t('tokensPerSecond', { tps: formatTokensPerSecond(current.tps) })
        : null
      if (mode === 'compact') {
        return speed === null ? null : React.createElement(
          'span',
          null,
          React.createElement('style', null, CSS),
          React.createElement(PlainPill, { stat: 'activity', ...reading(speed, null) }),
        )
      }
      if (stats.steps === 0) return null
      const counts = t('counts', { turns: stats.turns, steps: stats.steps })
      const content = { stat: 'activity', ...reading(counts, speed) }
      if (stats.llmMs <= 0 && stats.toolMs <= 0 && stats.ttftSteps <= 0 && speed === null) {
        return React.createElement(
          'span',
          null,
          React.createElement('style', null, CSS),
          React.createElement(PlainPill, content),
        )
      }
      const rows = []
      if (stats.llmMs > 0) rows.push({ name: t('llmTime'), value: formatDuration(stats.llmMs, t) })
      if (stats.toolMs > 0) rows.push({ name: t('toolTime'), value: formatDuration(stats.toolMs, t) })
      if (stats.ttftSteps > 0) rows.push({ name: t('ttft'), value: formatDuration(stats.ttftMs / stats.ttftSteps, t) })
      if (speed !== null) rows.push({ name: t('speed'), value: speed })
      if (current !== null) rows.push({ name: t('model'), value: `${current.route.provider} / ${current.route.model}`, wide: true })
      return React.createElement(
        'span',
        null,
        React.createElement('style', null, CSS),
        React.createElement(DialogPill, { ...content, title: t('dialogTitle'), titleValue: counts, rows }),
      )
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-tps-recalibrate: dictionaries')
        let performanceUsage
        try {
          const form = ctx.configForms.get('ui-chat')
          performanceUsage = {
            getSnapshot: () => form.getSnapshot().value?.performanceUsage ?? 'detailed',
            subscribe: listener => form.subscribe(listener),
          }
        } catch (_error) {
          performanceUsage = { getSnapshot: () => 'detailed', subscribe: () => () => {} }
        }
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'activity',
          order: 0,
          priority: -1,
          locale: NS,
          inject: () => ({ hooks: { performanceUsage } }),
        }, ModelSpeedPill))
      },
    }
  },
})
