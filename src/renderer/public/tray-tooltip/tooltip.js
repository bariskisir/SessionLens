function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function providerIcon(iconKey, title) {
  const name = (iconKey || title || '').toLowerCase().replace(/\s+/g, '')
  const icons = {
    codex: 'openai',
    openai: 'openai',
    claude: 'claude',
    antigravity: 'antigravity',
    commandcode: 'commandcode',
    copilot: 'copilot',
    warp: 'warp',
    synthetic: 'synthetic',
    chutes: 'chutes',
    zai: 'zai',
    elevenlabs: 'elevenlabs',
    alibaba: 'alibaba',
    minimax: 'minimax',
    kilo: 'kilo',
    codebuff: 'codebuff',
  }
  const file = icons[name]
  if (!file) return null
  return iconImage(`./${file}.svg`, name)
}

function iconImage(src, label) {
  const image = el('img', 'card__provider-icon')
  image.src = src
  image.alt = label
  image.decoding = 'async'
  return image
}

function levelOf(remainPct) {
  if (remainPct <= 5) return 'critical'
  if (remainPct <= 20) return 'high'
  if (remainPct <= 50) return 'medium'
  return 'low'
}

function resetText(detail) {
  const value = (detail || '').trim()
  if (!value) return ''
  if (value === 'now') return 'Resets now'
  return 'Resets in ' + value
}

function metricRow(metric, showLabel) {
  const percent = Number.isFinite(metric.percent) ? Math.min(100, Math.max(0, metric.percent)) : 0
  const wrap = el('div', 'metric')
  const label = (metric.label || '').trim()
  const sub = (metric.sub || '').trim()
  if (sub || (showLabel && label)) {
    if (showLabel && label) {
      const titleGroup = el('div', 'metric__title-group')
      titleGroup.appendChild(el('span', 'metric__title', label))
      if (sub) titleGroup.appendChild(el('span', 'metric__sub', sub))
      wrap.appendChild(titleGroup)
    } else if (sub) {
      wrap.appendChild(el('span', 'metric__sub', sub))
    }
  }
  const bar = el('div', 'metric__bar')
  const fill = el('div', 'metric__bar-fill')
  fill.dataset.level = levelOf(100 - percent)
  fill.style.width = percent + '%'
  bar.appendChild(fill)
  wrap.appendChild(bar)
  const row = el('div', 'metric__row')
  row.appendChild(el('span', 'metric__pct', Math.round(percent) + '% used'))
  const reset = resetText(metric.detail)
  if (reset) row.appendChild(el('span', 'metric__reset', reset))
  wrap.appendChild(row)
  return wrap
}

function renderCard(card) {
  const hasMetrics = card.metrics && card.metrics.length > 0
  const isBalance = !hasMetrics && card.lines && card.lines.length > 0
  const article = el(
    'article',
    [
      'card',
      hasMetrics ? 'card--with-details' : 'card--header-only',
      isBalance ? 'card--balance' : '',
    ]
      .filter(Boolean)
      .join(' '),
  )
  const header = el('header', 'card__header')
  const titleRow = el('div', 'card__title-row')
  const nameGroup = el('div', 'card__name-group')
  nameGroup.appendChild(el('span', 'card__name', card.title))
  if (isBalance) nameGroup.appendChild(el('span', 'card__value', card.lines[0]))
  else if (card.plan) nameGroup.appendChild(el('span', 'card__plan', card.plan))
  titleRow.appendChild(nameGroup)
  if (card.notice) titleRow.appendChild(el('span', 'card__plan', card.notice))
  const icon = hasMetrics ? providerIcon(card.icon, card.title) : null
  if (icon) titleRow.appendChild(icon)
  header.appendChild(titleRow)
  article.appendChild(header)
  if (hasMetrics) {
    article.appendChild(el('div', 'card__divider'))
    const content = el('div', 'card__content')
    const metrics = el('section', 'card__metrics')
    const subCounts = {}
    card.metrics.forEach((metric) => {
      const sub = (metric.sub || '').trim() || '__none__'
      subCounts[sub] = (subCounts[sub] || 0) + 1
    })
    card.metrics.forEach((metric) => {
      const sub = (metric.sub || '').trim() || '__none__'
      metrics.appendChild(metricRow(metric, subCounts[sub] > 1))
    })
    content.appendChild(metrics)
    article.appendChild(content)
  }
  return article
}

window.setTooltip = (data) => {
  const app = document.getElementById('app')
  app.innerHTML = ''
  app.style.zoom = ''
  const userScale = data.scale && data.scale > 0 ? data.scale / 100 : 1
  const panel = el('div', 'panel panel--tray')
  const body = el('div', 'panel__body')
  const stack = el('div', 'stack')
  const cards = (data.cards || []).filter((card) => !card.hide)
  const total = cards.length
  const maxPerCol = Math.max(6, Math.floor(window.screen.availHeight / 70))
  const cols = total <= maxPerCol ? 1 : Math.ceil(total / maxPerCol)
  if (cols > 1) {
    stack.classList.add('stack--multi')
    stack.style.gridTemplateColumns = `repeat(${cols}, 1fr)`
  }
  cards.forEach((card, index) => {
    if (index > 0 && cols === 1) stack.appendChild(el('div', 'stack__sep'))
    const item = el('div', 'stack__item')
    item.appendChild(renderCard(card))
    stack.appendChild(item)
  })
  body.appendChild(stack)
  panel.appendChild(body)
  app.style.width = 'max-content'
  app.appendChild(panel)
  const contentWidth = panel.offsetWidth
  if (cols > 1) {
    const colWidth = 150
    const desiredWidth = Math.min(120 + cols * colWidth, 900)
    app.style.width = `${desiredWidth}px`
  } else {
    app.style.width = `${contentWidth}px`
  }
  if (userScale !== 1) {
    app.style.zoom = userScale
    panel.style.setProperty('--panel-radius', `${9 / userScale}px`)
    panel.style.setProperty('--panel-stroke', `${1 / userScale}px`)
    panel.style.setProperty('--panel-stroke-inset', `${1 / userScale}px`)
  } else {
    app.style.zoom = ''
    panel.style.removeProperty('--panel-radius')
    panel.style.removeProperty('--panel-stroke')
    panel.style.removeProperty('--panel-stroke-inset')
  }
}
