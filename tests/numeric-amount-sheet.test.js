const assert = require('assert')
const path = require('path')

function event(dataset, detail) {
  return {
    currentTarget: { dataset: dataset || {} },
    detail: detail || {}
  }
}

function loadComponent() {
  const file = path.resolve(__dirname, '../components/numeric-amount-sheet/index.js')
  delete require.cache[file]
  let definition = null
  global.Component = config => { definition = config }
  require(file)
  delete global.Component
  assert(definition, 'component definition should be registered')
  return definition
}

function createInstance(definition, propertyValues) {
  const properties = {}
  Object.keys(definition.properties || {}).forEach(key => {
    const source = definition.properties[key]
    if (source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, 'value')) {
      properties[key] = source.value
    } else if (source === Boolean) properties[key] = false
    else if (source === Number) properties[key] = 0
    else if (source === String) properties[key] = ''
  })
  Object.assign(properties, propertyValues || {})

  const events = {}
  const instance = {
    properties,
    data: Object.assign({}, definition.data || {}, properties),
    setData(patch) {
      Object.assign(this.data, patch)
    },
    triggerEvent(name, detail) {
      events[name] = detail || {}
    }
  }
  Object.keys(definition.methods || {}).forEach(key => {
    instance[key] = definition.methods[key].bind(instance)
  })
  return { instance, events }
}

function testKeypadStartsFromProvidedZeroAndAcceptsImmediateDigits() {
  const definition = loadComponent()
  const { instance } = createInstance(definition, { value: 0, max: 200000 })
  instance.syncDraft(0)
  assert.strictEqual(instance.data.draft, '0')
  instance.appendDigit(event({ digit: '2' }))
  instance.appendDigit(event({ digit: '0' }))
  assert.strictEqual(instance.data.draft, '20')
}

function testPresetClearBackspaceAndSliderStayInSync() {
  const definition = loadComponent()
  const { instance } = createInstance(definition, { value: 40000, max: 200000 })
  instance.syncDraft(40000)
  instance.applyPreset(event({ value: 80000 }))
  assert.strictEqual(instance.data.draft, '80000')
  assert.strictEqual(instance.data.activePresetValue, 80000)
  instance.backspaceDraft()
  assert.strictEqual(instance.data.draft, '8000')
  assert.strictEqual(instance.data.activePresetValue, 0)
  instance.clearDraft()
  assert.strictEqual(instance.data.draft, '0')
  instance.onSliderChange(event({}, { value: 120000 }))
  assert.strictEqual(instance.data.draft, '120000')
}

function testConfirmAndSecondaryEmitValidatedAmount() {
  const definition = loadComponent()
  const { instance, events } = createInstance(definition, { value: 60000, max: 180000 })
  instance.syncDraft(60000)
  instance.confirm()
  assert.deepStrictEqual(events.confirm, { value: 60000 })
  instance.applyPreset(event({ value: 120000 }))
  instance.secondary()
  assert.deepStrictEqual(events.secondary, { value: 120000 })
}

function testInvalidAmountDoesNotEmitConfirm() {
  const definition = loadComponent()
  const { instance, events } = createInstance(definition, { value: 0, max: 100000 })
  instance.syncDraft(0)
  instance.confirm()
  assert.strictEqual(events.confirm, undefined)
  instance.syncDraft(120000)
  instance.confirm()
  assert.strictEqual(events.confirm, undefined)
}

const tests = [
  testKeypadStartsFromProvidedZeroAndAcceptsImmediateDigits,
  testPresetClearBackspaceAndSliderStayInSync,
  testConfirmAndSecondaryEmitValidatedAmount,
  testInvalidAmountDoesNotEmitConfirm
]

for (const test of tests) {
  test()
  console.log('PASS', test.name)
}
