#!/usr/bin/env node
/**
 * LLM Sample — iOS Simulator E2E Test Suite
 *
 * Runs the 10-test in-app suite (model download/load + chat UI flow)
 * on an iOS Simulator via HTTP result collection.
 *
 * Auto-setup: model download, cap add ios, deployment target fix,
 * simulator auto-boot.
 *
 * The app is NOT terminated after tests — it remains running so the
 * user can continue interacting with it.
 *
 * Prerequisites:
 *   - macOS with Xcode + at least one iPhone simulator installed
 *   - Model auto-downloaded on first run
 *
 * Usage:
 *   node test-e2e-ios.mjs [--verbose] [--skip-download]
 */

import { execSync } from 'child_process'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const VERBOSE = process.argv.includes('--verbose')
const SKIP_DOWNLOAD = process.argv.includes('--skip-download')

// ─── Config ───────────────────────────────────────────────────────────────────
const BUNDLE_ID    = 'io.t6x.llmchat.sample'
const RUNNER_PORT  = 8099
const TOTAL_TESTS  = 10
const TIMEOUT_MS   = 900_000  // 15 min — download + model loading + inference
const MODEL_DIR    = path.join(ROOT_DIR, 'test/models')

const GGUF_MODEL_NAME = 'Qwen3.5-2B-Q4_K_M.gguf'
const GGUF_MODEL_URL  = 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf'

const MODEL_PATH      = path.join(MODEL_DIR, GGUF_MODEL_NAME)
const IOS_MIN_VERSION = '17'

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
  return execSync(`xcrun simctl ${args}`, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
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

function findAvailableIPhone() {
  const json = simctl('list devices available -j')
  const data = JSON.parse(json)
  for (const [runtime, devices] of Object.entries(data.devices)) {
    if (!runtime.includes('iOS')) continue
    for (const d of devices) {
      if (d.name.includes('iPhone') && d.isAvailable) return d.udid
    }
  }
  return null
}

function bootSimulator(udid) {
  console.log(`  → Booting simulator ${udid}...`)
  simctl(`boot ${udid}`)
  for (let i = 0; i < 30; i++) {
    const booted = getBootedUDID()
    if (booted) return booted
    execSync('sleep 1')
  }
  throw new Error('Simulator failed to boot within 30s')
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Xcode version helper ────────────────────────────────────────────────────
function getXcodeMajorVersion() {
  try {
    const out = execSync('xcodebuild -version', { encoding: 'utf8' })
    const m = out.match(/Xcode (\d+)/)
    return m ? parseInt(m[1], 10) : 0
  } catch { return 0 }
}

// ─── Shell helper ────────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  const nodePath = execSync('which node', { encoding: 'utf8' }).trim()
  const result = execSync(cmd, {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path.dirname(nodePath)}:${process.env.PATH}` },
    ...opts,
  })
  return (result || '').trim()
}

function npx(args, opts = {}) {
  const npmPath = execSync('which npm', { encoding: 'utf8' }).trim()
  const npxPath = path.join(path.dirname(npmPath), 'npx')
  return run(`${npxPath} ${args}`, opts)
}

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

// ─── Project setup (idempotent) ──────────────────────────────────────────────
function ensureModel() {
  if (fs.existsSync(MODEL_PATH)) return
  fs.mkdirSync(MODEL_DIR, { recursive: true })

  console.log(`  → Downloading model (${GGUF_MODEL_NAME}, ~1.3 GB)...`)
  execSync(`curl -L --progress-bar -o "${MODEL_PATH}" "${GGUF_MODEL_URL}"`, {
    stdio: ['ignore', process.stderr, 'pipe'],
    timeout: 600_000,
  })
}

function ensureIosPlatform() {
  const iosDir = path.join(__dirname, 'ios')
  if (fs.existsSync(iosDir)) return
  console.log('  → cap add ios...')
  npx('cap add ios', { cwd: __dirname, stdio: VERBOSE ? [0, 1, 2] : ['ignore', 'pipe', 'pipe'], timeout: 60_000 })
}

function fixDeploymentTarget() {
  const pbxproj = path.join(__dirname, 'ios/App/App.xcodeproj/project.pbxproj')
  if (fs.existsSync(pbxproj)) {
    let content = fs.readFileSync(pbxproj, 'utf8')
    const re = /IPHONEOS_DEPLOYMENT_TARGET = \d+\.\d+/g
    if (content.match(re)?.[0]?.includes(`= ${IOS_MIN_VERSION}.0`)) return
    content = content.replace(re, `IPHONEOS_DEPLOYMENT_TARGET = ${IOS_MIN_VERSION}.0`)
    fs.writeFileSync(pbxproj, content)
  }
  const capSpm = path.join(__dirname, 'ios/App/CapApp-SPM/Package.swift')
  if (fs.existsSync(capSpm)) {
    let content = fs.readFileSync(capSpm, 'utf8')
    content = content.replace(/\.iOS\(\.v\d+\)/, `.iOS(.v${IOS_MIN_VERSION})`)
    fs.writeFileSync(capSpm, content)
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n🔵 LLM Sample iOS Simulator E2E Test Suite\n')

  // ─── Section 0: Project Setup ──────────────────────────────────────────
  logSection('0 — Project Setup')

  try {
    ensureModel()
    const modelSizeMB = Math.round(fs.statSync(MODEL_PATH).size / 1024 / 1024)
    pass('0.1 Model available', `${modelSizeMB} MB`)
  } catch (err) {
    fail('0.1 Model available', err.message?.slice(0, 200) || 'download failed')
    process.exit(1)
  }

  try {
    ensureIosPlatform()
    fixDeploymentTarget()
    pass('0.2 iOS platform ready')
  } catch (err) {
    fail('0.2 iOS platform ready', err.message?.slice(0, 200) || 'cap add ios failed')
    process.exit(1)
  }

  // ─── Section 1: Simulator Setup ──────────────────────────────────────────
  logSection('1 — Simulator Setup')

  let udid
  try {
    udid = getBootedUDID()
    if (!udid) {
      const available = findAvailableIPhone()
      if (!available) throw new Error('No available iPhone simulator — install one via Xcode')
      udid = bootSimulator(available)
    }
    pass('1.1 Simulator ready', `UDID ${udid}`)
  } catch (err) {
    fail('1.1 Simulator ready', err.message)
    console.error('\nFatal: no simulator available.\n')
    process.exit(1)
  }

  // 1.2 cap sync ios
  try {
    console.log('  → cap sync ios...')
    npx('cap sync ios', {
      cwd: __dirname,
      timeout: 60000,
      stdio: VERBOSE ? [0, 1, 2] : ['ignore', 'pipe', 'pipe'],
    })
    fixDeploymentTarget()
    pass('1.2 cap sync ios')
  } catch (err) {
    try {
      execSync(`cp -r "${path.join(__dirname, 'www')}/." "${path.join(__dirname, 'ios/App/App/public')}/"`)
      pass('1.2 web assets copied (manual)')
    } catch (e2) {
      fail('1.2 web assets', e2.message?.slice(0, 200) || 'failed')
      process.exit(1)
    }
  }

  // 1.3 Build
  try {
    console.log('  → Building (xcodebuild)… (use --verbose for build output)')
    const xcodeMajor = getXcodeMajorVersion()
    const explicitModulesFlag = xcodeMajor >= 26 ? ' SWIFT_ENABLE_EXPLICIT_MODULES=NO' : ''
    const derivedDataPath = path.join(__dirname, 'ios/App/DerivedData')
    const sharedOpts = {
      cwd: path.join(__dirname, 'ios/App'),
      encoding: 'utf8',
      timeout: 600_000,
      maxBuffer: 200 * 1024 * 1024,
      stdio: VERBOSE ? [0, 1, 2] : ['ignore', 'pipe', 'pipe'],
    }
    const baseFlags =
      `-scheme App -sdk iphonesimulator ` +
      `-destination "platform=iOS Simulator,id=${udid}" ` +
      `-derivedDataPath "${derivedDataPath}"`

    // Resolve SPM
    console.log('  → Resolving SPM dependencies…')
    try {
      execSync(`xcodebuild ${baseFlags} -resolvePackageDependencies`, sharedOpts)
    } catch (_resolveErr) {}

    // Init llama.cpp submodule
    const checkoutsDir = path.join(derivedDataPath, 'SourcePackages/checkouts')
    try {
      if (fs.existsSync(checkoutsDir)) {
        const entries = fs.readdirSync(checkoutsDir)
        const dustLlmDir = entries.find(e => e.startsWith('dust-llm-swift'))
        if (dustLlmDir) {
          const dustLlmPath = path.join(checkoutsDir, dustLlmDir)
          console.log('  → Initializing llama.cpp submodule…')
          execSync('git submodule update --init --recursive', {
            cwd: dustLlmPath, encoding: 'utf8', timeout: 300_000,
            stdio: VERBOSE ? [0, 1, 2] : ['ignore', 'pipe', 'pipe'],
          })
        }
      }
    } catch (_subErr) {}

    // Build
    execSync(`xcodebuild ${baseFlags} -configuration Debug build${explicitModulesFlag}`, sharedOpts)
    pass('1.3 xcodebuild succeeded')
  } catch (err) {
    const output = (err.stdout || err.stderr || err.message || '')
    const lines = output.split('\n')
    const errorLines = lines.filter(l => /error:|FAILED/.test(l)).slice(0, 5).join(' | ')
    fail('1.3 xcodebuild succeeded', errorLines || 'build failed — re-run with --verbose')
    process.exit(1)
  }

  // 1.4 Install app
  let appPath
  try {
    const fixedDerivedData = path.join(__dirname, 'ios/App/DerivedData')
    const ddOut = execSync(
      `find "${fixedDerivedData}" ~/Library/Developer/Xcode/DerivedData -name "App.app" -path "*Debug-iphonesimulator*" -not -path "*PlugIns*" -exec stat -f '%m %N' {} \\; 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-`,
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

  // 1.5 Copy model to simulator (when --skip-download)
  let modelSimPath = ''
  if (SKIP_DOWNLOAD) {
    try {
      const dataDir = simctl(`get_app_container ${udid} ${BUNDLE_ID} data`)
      const docsDir = path.join(dataDir, 'Documents')
      fs.mkdirSync(docsDir, { recursive: true })
      modelSimPath = path.join(docsDir, GGUF_MODEL_NAME)
      if (!fs.existsSync(modelSimPath)) {
        console.log('  → Copying model to simulator...')
        fs.copyFileSync(MODEL_PATH, modelSimPath)
      }
      const sizeMB = Math.round(fs.statSync(modelSimPath).size / 1024 / 1024)
      pass('1.5 Model in simulator', `${sizeMB} MB`)
    } catch (err) {
      fail('1.5 Model in simulator', err.message?.slice(0, 200) || 'failed')
      process.exit(1)
    }
  } else {
    pass('1.5 Model in simulator', 'skipped (in-app download)')
  }

  // 1.6 Patch HTML
  try {
    const bundleDir = simctl(`get_app_container ${udid} ${BUNDLE_ID}`)
    const htmlInBundle = path.join(bundleDir, 'public/index.html')
    let html = fs.readFileSync(htmlInBundle, 'utf8')
    html = html.replace(/var TEST_MODE = (true|false)/, 'var TEST_MODE = true')
    if (SKIP_DOWNLOAD && modelSimPath) {
      html = html.replace(/var SKIP_DOWNLOAD = (true|false)/, 'var SKIP_DOWNLOAD = true')
      html = html.replace(/var MODEL_PATH = '[^']*'/, `var MODEL_PATH = '${modelSimPath}'`)
    }
    fs.writeFileSync(htmlInBundle, html)
    pass('1.6 HTML patched', SKIP_DOWNLOAD ? `skip-download → ${modelSimPath.split('/').slice(-3).join('/')}` : 'in-app download mode')
  } catch (err) {
    fail('1.6 HTML patched', err.message?.slice(0, 200) || 'failed')
    process.exit(1)
  }

  // ─── Section 2: HTTP E2E Test ──────────────────────────────────────────────
  logSection('2 — LLM Sample E2E')

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

  // Wait for results
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
  passedTests += summary.passed || 0
  failedTests += summary.failed || 0

  if (summary.fatal) {
    fail('App fatal error', summary.fatal)
  }

  printSummary()

  // NOTE: App is NOT terminated — left running for manual interaction
  console.log('\n  ℹ️  App left running for manual interaction.\n')

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
