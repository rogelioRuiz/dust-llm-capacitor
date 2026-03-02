#!/usr/bin/env node
/**
 * capacitor-llm Android E2E Test Suite
 *
 * Verifies true per-token JNI streaming, cancel-mid-stream,
 * and basic load/unload on a real device.
 *
 * Approach: HTTP server on localhost:8099 + ADB reverse port-forward.
 *   - `adb reverse tcp:8099 tcp:8099` maps device port 8099 → host port 8099
 *   - index.html POSTs __llm_result and __llm_done to this server
 *
 * Prerequisites:
 *   - Connected arm64 Android device or emulator
 *   - GGUF model auto-downloaded on first run
 *
 * Usage:
 *   node test-e2e-android.mjs
 */

import { execSync } from 'child_process'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

// ─── Config ───────────────────────────────────────────────────────────────────
const BUNDLE_ID   = 'io.t6x.llm.test'
const RUNNER_PORT = 8099
const TOTAL_TESTS = 8
const TIMEOUT_MS  = 300_000  // 5 min — model loading is slow
const ADB         = process.env.ADB_PATH || 'adb'
const MODEL_NAME  = 'tinyllama-1.1b-chat-v1.0.Q2_K.gguf'
const MODEL_URL   = 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q2_K.gguf'
const MODEL_DIR   = path.join(ROOT_DIR, 'test/models')
const MODEL_PATH  = path.join(MODEL_DIR, MODEL_NAME)
const DEVICE_MODEL_PATH = `/data/local/tmp/${MODEL_NAME}`

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

// ─── ADB helpers ──────────────────────────────────────────────────────────────
function adb(args, opts = {}) {
  const serial = process.env.ANDROID_SERIAL ? `-s ${process.env.ANDROID_SERIAL}` : ''
  return execSync(`${ADB} ${serial} ${args}`, { encoding: 'utf8', timeout: 60000, ...opts }).trim()
}

function getConnectedDevice() {
  const out = execSync(`${ADB} devices`, { encoding: 'utf8' }).trim()
  const lines = out.split('\n').slice(1).filter(l => l.includes('\tdevice'))
  if (lines.length === 0) return null
  return lines[0].split('\t')[0].trim()
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Project setup (idempotent) ──────────────────────────────────────────────
function ensureModel() {
  if (fs.existsSync(MODEL_PATH)) return
  console.log(`  → Downloading model (${MODEL_NAME})...`)
  fs.mkdirSync(MODEL_DIR, { recursive: true })
  execSync(`curl -L -o "${MODEL_PATH}" "${MODEL_URL}"`, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 600_000,
  })
}

function ensureCapSync() {
  console.log('  → cap sync android...')
  const nodePath = execSync('which node', { encoding: 'utf8' }).trim()
  const npmPath = execSync('which npm', { encoding: 'utf8' }).trim()
  const npxPath = path.join(path.dirname(npmPath), 'npx')
  execSync(`${npxPath} cap sync android`, {
    cwd: __dirname,
    encoding: 'utf8',
    timeout: 60000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${path.dirname(nodePath)}:${process.env.PATH}` }
  })
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

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n🟢 capacitor-llm Android E2E Test Suite\n')

  // ─── Section 0: Project Setup ──────────────────────────────────────────
  logSection('0 — Project Setup')

  try {
    ensureModel()
    pass('0.1 Model available', `${Math.round(fs.statSync(MODEL_PATH).size / 1024 / 1024)} MB`)
  } catch (err) {
    fail('0.1 Model available', err.message?.slice(0, 200) || 'download failed')
    process.exit(1)
  }

  try {
    ensureCapSync()
    pass('0.2 cap sync android')
  } catch (err) {
    fail('0.2 cap sync android', err.message?.slice(0, 200) || 'failed')
    // continue — android dir already exists
  }

  // ─── Section 1: Android Setup ─────────────────────────────────────────────
  logSection('1 — Android Setup')

  // 1.1 Find connected device
  let deviceSerial
  try {
    deviceSerial = getConnectedDevice()
    if (!deviceSerial) throw new Error('No device found — connect a device or start an emulator')
    if (process.env.ANDROID_SERIAL && process.env.ANDROID_SERIAL !== deviceSerial) {
      deviceSerial = process.env.ANDROID_SERIAL
    }
    pass('1.1 Android device connected', `serial ${deviceSerial}`)
  } catch (err) {
    fail('1.1 Android device connected', err.message)
    console.error('\nFatal: no Android device.\n')
    process.exit(1)
  }

  process.env.ANDROID_SERIAL = deviceSerial

  // 1.2 Build APK
  const apkPath = path.join(__dirname, 'android/app/build/outputs/apk/debug/app-debug.apk')
  try {
    console.log('  → Building APK (./gradlew assembleDebug)...')
    execSync('./gradlew assembleDebug', {
      cwd: path.join(__dirname, 'android'),
      encoding: 'utf8',
      timeout: 600_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (!fs.existsSync(apkPath)) throw new Error('APK not found after build')
    const apkSize = Math.round(fs.statSync(apkPath).size / 1024 / 1024)
    pass('1.2 APK built', `${apkSize} MB`)
  } catch (err) {
    const msg = (err.stderr || err.stdout || err.message || '').split('\n').filter(l => l.toLowerCase().includes('error')).slice(0, 3).join(' | ') || err.message?.slice(0, 200)
    fail('1.2 APK built', msg)
    process.exit(1)
  }

  // 1.3 Install APK + ADB reverse port-forward
  try {
    adb(`reverse tcp:${RUNNER_PORT} tcp:${RUNNER_PORT}`)
    try { adb(`uninstall ${BUNDLE_ID}`) } catch { /* not installed */ }
    adb(`install -r "${apkPath}"`)
    pass('1.3 APK installed + port-forward', `${BUNDLE_ID}`)
  } catch (err) {
    fail('1.3 APK installed + port-forward', err.message?.slice(0, 200))
    process.exit(1)
  }

  // 1.4 Push model to device if not already there
  try {
    const modelCheck = adb(`shell ls -la ${DEVICE_MODEL_PATH} 2>/dev/null`)
    if (!modelCheck.includes(MODEL_NAME)) throw new Error('not found')
    pass('1.4 Model on device', DEVICE_MODEL_PATH)
  } catch {
    try {
      console.log('  → Pushing model to device...')
      adb(`push "${MODEL_PATH}" ${DEVICE_MODEL_PATH}`, { timeout: 300_000 })
      pass('1.4 Model pushed to device', DEVICE_MODEL_PATH)
    } catch (err) {
      fail('1.4 Model on device', err.message?.slice(0, 200))
      process.exit(1)
    }
  }

  // ─── Section 2: HTTP E2E Test ──────────────────────────────────────────────
  logSection('2 — LLM Streaming E2E')

  // Start HTTP server BEFORE launching app (app connects to server on startup)
  const { server, allDonePromise } = await startResultServer()
  pass('2.0 HTTP result server started', `port ${RUNNER_PORT}`)

  // Launch app
  try {
    adb(`shell am force-stop ${BUNDLE_ID}`)
    await sleep(500)
    adb(`shell am start -n ${BUNDLE_ID}/.MainActivity`)
    console.log('  → App launched, waiting for test results...')
  } catch (err) {
    fail('2.0 App launch', err.message?.slice(0, 200))
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

  // Count app results as our results
  passedTests += appPassed
  failedTests += appFailed

  if (summary.fatal) {
    fail('App fatal error', summary.fatal)
  }

  printSummary()

  // Cleanup
  try { adb(`shell am force-stop ${BUNDLE_ID}`) } catch {}

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
