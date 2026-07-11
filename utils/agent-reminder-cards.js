function cleanText(value, fallback) {
  const text = String(value || '').trim()
  return text || fallback || ''
}

function getReminderVariant(type) {
  return String(type || '').trim() === 'text_reminder' ? 'warning' : 'strong'
}

function getReminderTone(type) {
  return getReminderVariant(type) === 'warning' ? 'yellow' : 'red'
}

function normalizeMetrics(metrics) {
  if (!Array.isArray(metrics)) return []
  return metrics
    .filter(Boolean)
    .map(item => ({
      label: cleanText(item.label),
      value: cleanText(item.value)
    }))
    .filter(item => item.label || item.value)
    .slice(0, 4)
}

function buildReminderChatPayload(reminder) {
  const source = reminder || {}
  const type = cleanText(source.type)
  const title = cleanText(source.title, 'EV脑提醒')
  const message = cleanText(source.message)
  const variant = getReminderVariant(type)
  const tone = getReminderTone(type)
  const headline = cleanText(source.headline, message || title)
  const advice = cleanText(source.advice, message)
  const metrics = normalizeMetrics(source.metrics)
  const text = [title, message].filter(Boolean).join('\n')

  return {
    text,
    intent: 'ai_reminder',
    reminder: true,
    reminderType: type,
    severity: variant === 'strong' ? 'strong' : 'warning',
    reminderCard: {
      variant,
      tone,
      label: variant === 'strong' ? '强提醒' : '状态提醒',
      title,
      headline,
      advice,
      metrics,
      actionLabel: '我已知晓',
      acknowledgeRequired: true,
      acknowledged: false
    }
  }
}

function normalizeReminderCard(card, type) {
  if (!card) return null
  const variant = card.variant === 'warning' || card.variant === 'strong'
    ? card.variant
    : getReminderVariant(type)
  const tone = variant === 'warning' ? 'yellow' : 'red'
  return {
    variant,
    tone,
    label: cleanText(card.label, variant === 'strong' ? '强提醒' : '状态提醒'),
    title: cleanText(card.title, 'EV脑提醒'),
    headline: cleanText(card.headline, cleanText(card.title, 'EV脑提醒')),
    advice: cleanText(card.advice),
    metrics: normalizeMetrics(card.metrics),
    actionLabel: cleanText(card.actionLabel, '我已知晓'),
    acknowledgeRequired: card.acknowledgeRequired !== false,
    acknowledged: card.acknowledged === true
  }
}

function hasBlockingReminder(messages) {
  return (Array.isArray(messages) ? messages : []).some(item => {
    const card = item && item.reminderCard
    return !!(card && card.acknowledgeRequired !== false && card.acknowledged !== true)
  })
}

module.exports = {
  buildReminderChatPayload,
  normalizeReminderCard,
  hasBlockingReminder,
  __test: {
    getReminderVariant,
    getReminderTone,
    normalizeMetrics
  }
}
