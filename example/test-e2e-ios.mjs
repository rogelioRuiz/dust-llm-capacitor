#!/usr/bin/env node
/**
 * capacitor-llm iOS Simulator E2E Test Suite
 *
 * Verifies true per-token streaming, cancel-mid-stream,
 * and basic load/unload on iOS Simulator.
 *
 * Approach: HTTP server on localhost:8099.
 *   - iOS Simulator shares the Mac's loopback network
 *   - index.html POSTs __llm_result and __llm_done to http://127.0.0.1:8099
 *
 * Prerequisites:
 *   - Booted iOS Simulator
 *   - GGUF model at test/models/tinyllama-1.1b-chat-v1.0.Q2_K.gguf
 *
 * Usage:
 *   node test-e2e-ios.mjs
 */

import { execSync } from 'child_process'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── Config ───────────────────────────────────────────────────────────────────
const BUNDLE_ID   = 'io.t6x.llm.test'
const RUNNER_PORT = 8099
const TOTAL_TESTS = 8
const TIMEOUT_MS  = 300_000  // 5 min — model loading + inference is slow
const MODEL_NAME  = 'tinyllama-1.1b-chat-v1.0.Q2_K.gguf'

// ─── Test runner state ────────────────────────────────────────────────────────
let passedTests = 0, failedTests = 0
const testResults = []

function logSection(title) { console.log(`\n${'═'.repeat(60)}\n  ${title}\n${'═'.repeat(60)}`) }
function pass(name, detail) {
  passedTests++
  testResults.push({ name, status: 'PASS' })
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name, error) {
  failedTests++
  testResults.push({ name, status: 'FAIL', error })
  console.log(`  ❌ ${name} — ${error}`)
}

// ─── simctl helpers ───────────────────────────────────────────────────────────
function simctl(args, opts = {}) {
  return execSync(`xcrun simctl ${args}`, { encoding: 'utf8', timeout: 30000, ...opts }).trim()
}

function getBootedUDID() {
  const json = simctl('list devices booted -j')
  const data = JSON.parse(json)
  for (const devices of Object.values(data.devices)) {
    for (const d of devices) {
      if (d.state === 'Booted') return d.udid
    }
  }
  return null
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── HTTP result collector ────────────────────────────────────────────────────
function startResultServer() {
  const received = new Map()

  const serverReady = new Promise((resolveServer, rejectServer) => {
    const allDonePromise = new Promise((resolveDone, rejectDone) => {

      const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') {
          res.writeHead(204)
          res.end()
          return
        }

        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body)
            if (req.url === '/__llm_result') {
              received.set(payload.id, payload)
              const icon = payload.status === 'pass' ? '✅' : '❌'
              console.log(`  [app] ${icon} ${payload.id}${payload.detail ? ' — ' + payload.detail : ''}${payload.error ? ' — ' + payload.error : ''}`)
              res.writeHead(200)
              res.end('ok')
            } else if (req.url === '/__llm_done') {
              res.writeHead(200)
              res.end('ok')
              server.close()
              resolveDone({ results: received, summary: payload })
            } else {
              res.writeHead(404)
              res.end()
            }
          } catch (e) {
            res.writeHead(400)
            res.end()
          }
        })
      })

      server.listen(RUNNER_PORT, '0.0.0.0', () => {
        resolveServer({ server, allDonePromise })
      })

      server.on('error', rejectServer)

      setTimeout(() => {
        server.close()
        rejectDone(new Error(`Timeout after ${TIMEOUT_MS / 1000}s — ${received.size}/${TOTAL_TESTS} results received`))
      }, TIMEOUT_MS)
    })
  })

  return serverReady
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n🔵 capacitor-llm iOS Simulator E2E Test Suite\n')

  // ─── Section 1: Simulator Setup ──────────────────────────────────────────
  logSection('1 — Simulator Setup')

  // 1.1 Find booted simulator
  let udid
  try {
    udid = getBootedUDID()
    if (!udid) throw new Error('No booted simulator found — open Simulator.app first')
    pass('1.1 Booted simulator found', `UDID ${udid}`)
  } catch (err) {
    fail('1.1 Booted simulator found', err.message)
    console.error('\nFatal: no booted simulator.\n')
    process.exit(1)
  }

  // 1.2 First pass: cap sync + build + install to get app container path
  //     We need the container path to know where to copy the model,
  //     and we need the model path to inject into the HTML.
  try {
    console.log('  → cap sync ios...')
    const nodePath = execSync('which node', { encoding: 'utf8' }).trim()
    const npmPath = execSync('which npm', { encoding: 'utf8' }).trim()
    const npxPath = path.join(path.dirname(npmPath), 'npx')
    execSync(`${npxPath} cap sync ios`, {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${path.dirname(nodePath)}:${process.env.PATH}` }
    })
    pass('1.2 cap sync ios')
  } catch (err) {
    // Manually copy web assets as fallback
    try {
      execSync(`cp -r "${path.join(__dirname, 'www')}/." "${path.join(__dirname, 'ios/App/App/public')}/"`)
      pass('1.2 web assets copied (manual)')
    } catch (e2) {
      fail('1.2 web assets', e2.message?.slice(0, 200) || 'failed')
      process.exit(1)
    }
  }

  // 1.3 Initial build
  try {
    console.log('  → Building (xcodebuild)...')
    execSync(
      `xcodebuild -scheme App -sdk iphonesimulator ` +
      `-destination "platform=iOS Simulator,id=${udid}" -configuration Debug build`,
      {
        cwd: path.join(__dirname, 'ios/App'),
        encoding: 'utf8',
        timeout: 600_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    pass('1.3 xcodebuild succeeded')
  } catch (err) {
    const lines = (err.stderr || err.stdout || err.message || '').split('\n')
    const errorLines = lines.filter(l => l.includes('error:')).slice(0, 3).join(' | ')
    fail('1.3 xcodebuild succeeded', errorLines || 'build failed')
    process.exit(1)
  }

  // 1.4 Install to get container path
  let appPath
  try {
    const ddOut = execSync(
      `find ~/Library/Developer/Xcode/DerivedData -name "App.app" -path "*Debug-iphonesimulator*" -not -path "*PlugIns*" -exec stat -f '%m %N' {} \\; 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-`,
      { encoding: 'utf8', shell: true }
    ).trim()
    appPath = ddOut
    if (!appPath) throw new Error('App.app not found in DerivedData')
    try { simctl(`terminate ${udid} ${BUNDLE_ID}`) } catch {}
    simctl(`install ${udid} "${appPath}"`)
    pass('1.4 App installed')
  } catch (err) {
    fail('1.4 App installed', err.message?.slice(0, 200) || 'failed')
    process.exit(1)
  }

  // 1.5 Get model path from the installed app bundle
  //     The model is bundled as a resource in the .app, so the path is:
  //     <bundle_dir>/tinyllama-1.1b-chat-v1.0.Q2_K.gguf
  let modelPath
  try {
    const bundleDir = simctl(`get_app_container ${udid} ${BUNDLE_ID}`)
    modelPath = path.join(bundleDir, MODEL_NAME)
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Model not found in app bundle at ${modelPath}`)
    }
    const sizeMB = Math.round(fs.statSync(modelPath).size / 1024 / 1024)
    pass('1.5 Model bundled in app', `${sizeMB} MB`)
  } catch (err) {
    fail('1.5 Model bundled in app', err.message?.slice(0, 200) || 'failed')
    process.exit(1)
  }

  // 1.6 Patch the installed app's HTML with the bundle model path
  //     Modify index.html directly inside the installed .app bundle (no rebuild needed)
  try {
    const bundleDir = simctl(`get_app_container ${udid} ${BUNDLE_ID}`)
    const htmlInBundle = path.join(bundleDir, 'public/index.html')
    let html = fs.readFileSync(htmlInBundle, 'utf8')
    html = html.replace(
      /(?:const|let|var)\s+MODEL_PATH\s*=\s*'[^']*'/,
      `const MODEL_PATH = '${modelPath}'`
    )
    fs.writeFileSync(htmlInBundle, html)
    pass('1.6 HTML patched in bundle', modelPath.split('/').slice(-1)[0])
  } catch (err) {
    fail('1.6 HTML patched in bundle', err.message?.slice(0, 200) || 'failed')
    process.exit(1)
  }

  // ─── Section 2: HTTP E2E Test ──────────────────────────────────────────────
  logSection('2 — LLM Streaming E2E')

  // Start HTTP server BEFORE launching app
  const { server, allDonePromise } = await startResultServer()
  pass('2.0 HTTP result server started', `port ${RUNNER_PORT}`)

  // Launch app
  try {
    try { simctl(`terminate ${udid} ${BUNDLE_ID}`) } catch {}
    await sleep(500)
    simctl(`launch ${udid} ${BUNDLE_ID}`)
    console.log('  → App launched, waiting for test results...')
  } catch (err) {
    fail('2.0 App launch', err.message?.slice(0, 200) || 'failed')
    server.close()
    process.exit(1)
  }

  // Wait for all test results from the app
  let appResults
  try {
    appResults = await allDonePromise
  } catch (err) {
    fail('2.0 Test completion', err.message)
    printSummary()
    process.exit(1)
  }

  // ─── Section 3: Validate Results ──────────────────────────────────────────
  logSection('3 — Results')

  const { summary } = appResults
  const appPassed = summary.passed || 0
  const appFailed = summary.failed || 0

  passedTests += appPassed
  failedTests += appFailed

  if (summary.fatal) {
    fail('App fatal error', summary.fatal)
  }

  printSummary()

  try { simctl(`terminate ${udid} ${BUNDLE_ID}`) } catch {}

  process.exit(failedTests > 0 ? 1 : 0)
}

function printSummary() {
  logSection('Summary')
  const total = passedTests + failedTests
  if (failedTests === 0) {
    console.log(`\n  ✅ ALL ${total} TESTS PASSED\n`)
  } else {
    console.log(`\n  ❌ ${passedTests}/${total} passed, ${failedTests} FAILED\n`)
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
