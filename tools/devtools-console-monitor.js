const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const defaultCliPath = 'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat'
const localAutomatorPath = path.join(projectRoot, '.codex-tools', 'miniprogram-automator', 'node_modules', 'miniprogram-automator')

function loadAutomator() {
  try {
    return require(localAutomatorPath)
  } catch (error) {
    try {
      return require('miniprogram-automator')
    } catch (fallbackError) {
      throw new Error('miniprogram-automator is missing. Run: npm install --prefix .codex-tools/miniprogram-automator miniprogram-automator@0.12.1')
    }
  }
}

function stringifyValue(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch (error) {
    return String(value)
  }
}

function normalizeConsoleEvent(event) {
  const args = Array.isArray(event && event.args) ? event.args : []
  return {
    type: String(event && event.type || event && event.level || 'log'),
    text: args.length ? args.map(stringifyValue).join(' ') : stringifyValue(event),
    raw: event
  }
}

function normalizeExceptionEvent(event) {
  return {
    type: 'exception',
    text: stringifyValue(event && (event.message || event.error || event)),
    raw: event
  }
}

function isProblem(entry) {
  const type = String(entry.type || '').toLowerCase()
  const text = String(entry.text || '').toLowerCase()
  return type.indexOf('error') > -1 ||
    type.indexOf('exception') > -1 ||
    /systemerror|appservicesdkscripterror|clickchecktask|not found|timeout|typeerror|referenceerror|syntaxerror|收到错误代码|error code/.test(text)
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withTimeout(promise, ms, label) {
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({ __timeout: true, label })
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function main() {
  const automator = loadAutomator()
  const logsDir = path.join(projectRoot, 'logs')
  const reportPath = path.join(logsDir, 'devtools-console-report.json')
  const cliPath = process.env.WECHAT_DEVTOOLS_CLI || defaultCliPath
  const autoPort = Number(process.env.WECHAT_AUTOMATOR_PORT || 9420)
  const routes = [
    '/pages/session-list/session-list',
    '/pages/hand-record/hand-record',
    '/pages/review-list/review-list',
    '/pages/stats/stats',
    '/pages/profile/profile',
    '/pages/player-notes/player-notes'
  ]
  const entries = []
  let miniProgram = null

  fs.mkdirSync(logsDir, { recursive: true })

  try {
    const wsEndpoint = process.env.WECHAT_AUTOMATOR_WS || ('ws://127.0.0.1:' + autoPort)
    try {
      miniProgram = await automator.connect({ wsEndpoint })
    } catch (connectError) {
      miniProgram = await automator.launch({
        cliPath,
        projectPath: projectRoot,
        port: autoPort,
        timeout: 60000,
        trustProject: true
      })
    }

    miniProgram.on('console', event => {
      const entry = Object.assign({ at: new Date().toISOString() }, normalizeConsoleEvent(event))
      entries.push(entry)
      if (isProblem(entry)) {
        process.stderr.write('[devtools-console] ' + entry.type + ' ' + entry.text + '\n')
      }
    })

    miniProgram.on('exception', event => {
      const entry = Object.assign({ at: new Date().toISOString() }, normalizeExceptionEvent(event))
      entries.push(entry)
      process.stderr.write('[devtools-exception] ' + entry.text + '\n')
    })

    for (const route of routes) {
      process.stdout.write('[devtools-monitor] open ' + route + '\n')
      const routeResult = await withTimeout(
        miniProgram.reLaunch(route),
        Number(process.env.WECHAT_MONITOR_ROUTE_TIMEOUT_MS || 10000),
        route
      )
      if (routeResult && routeResult.__timeout) {
        entries.push({
          at: new Date().toISOString(),
          type: 'monitor-timeout',
          text: 'route timeout: ' + route
        })
        process.stderr.write('[devtools-monitor] route timeout ' + route + '\n')
      }
      await wait(2500)
    }

    await wait(Number(process.env.WECHAT_MONITOR_EXTRA_WAIT_MS || 3000))
  } finally {
    const problems = entries.filter(isProblem)
    fs.writeFileSync(reportPath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      projectRoot,
      problemCount: problems.length,
      problems,
      entries
    }, null, 2), 'utf8')

    if (miniProgram && process.env.WECHAT_MONITOR_KEEP_OPEN !== '1') {
      try {
        await miniProgram.close()
      } catch (error) {
        process.stderr.write('[devtools-monitor] close failed: ' + (error && error.message || error) + '\n')
      }
    } else if (miniProgram) {
      try {
        miniProgram.disconnect()
      } catch (error) {
        process.stderr.write('[devtools-monitor] disconnect failed: ' + (error && error.message || error) + '\n')
      }
    }

    process.stdout.write('[devtools-monitor] report ' + reportPath + '\n')
    if (problems.length) {
      process.exitCode = 1
    }
  }
}

main().catch(error => {
  process.stderr.write('[devtools-monitor] failed: ' + (error && error.stack || error) + '\n')
  process.exitCode = 1
})
