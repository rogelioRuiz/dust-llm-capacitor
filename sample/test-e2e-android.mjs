#!/usr/bin/env node
/**
 * LLM Sample — Android E2E Test Suite
 *
 * Runs the 10-test in-app suite (model download/load + chat UI flow)
 * on an Android device/emulator via HTTP result collection.
 *
 * Auto-setup: model download, cap add android, model push to device.
 *
 * The app is NOT terminated after tests — it remains running so the
 * user can continue interacting with it.
 *
 * Prerequisites:
 *   - Android SDK with ADB (device/emulator auto-started if available)
 *   - GGUF model auto-downloaded on first run
 *
 * Usage:
 *   node test-e2e-android.mjs [--verbose] [--skip-download]
 */

import { execSync, spawn } from 'child_process'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const VERBOSE = process.argv.includes('--verbose')
const SKIP_DOWNLOAD = process.argv.includes('--skip-download')

// ─── Config ───────────────────────────────────────────────────────────────────
const BUNDLE_ID         = 'io.t6x.llmchat.sample'
const RUNNER_PORT       = 8099
const TOTAL_TESTS       = 10
const TIMEOUT_MS        = 1_200_000  // 20 min — model loading is slow on emulator
const ADB               = findAdbBinary()
const MODEL_NAME        = 'Qwen3.5-2B-Q4_K_M.gguf'
const MODEL_URL         = 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf'
const MODEL_DIR         = path.join(ROOT_DIR, 'test/models')
const LOCAL_MODEL_PATH  = path.join(MODEL_DIR, MODEL_NAME)
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ─── Shell / ADB helpers ─────────────────────────────────────────────────────
// Build a PATH that works in non-interactive SSH shells (no ~/.zprofile sourced).
function extendedPath() {
  const nodeDir = path.dirname(process.execPath)
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
    || path.join(process.env.HOME, 'Library/Android/sdk')
  const extra = [
    nodeDir,
    '/opt/homebrew/bin',       // Apple Silicon Homebrew
    '/usr/local/bin',          // Intel Homebrew / system installs
    `${process.env.HOME}/.nvm/versions/node/current/bin`, // nvm current
    path.join(androidHome, 'platform-tools'),
    path.join(androidHome, 'emulator'),
  ].filter(Boolean)
  const existing = (process.env.PATH || '').split(':')
  return [...new Set([...extra, ...existing])].join(':')
}

function run(cmd, opts = {}) {
  const result = execSync(cmd, {
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: extendedPath() },
    ...opts,
  })
  return (result || '').trim()
}

function adb(args, opts = {}) {
  const serial = process.env.ANDROID_SERIAL ? `-s ${process.env.ANDROID_SERIAL}` : ''
  return run(`${ADB} ${serial} ${args}`, { timeout: 60_000, ...opts })
}

function getConnectedDevice() {
  const out = execSync(`${ADB} devices`, { encoding: 'utf8' }).trim()
  const lines = out.split('\n').slice(1).filter(l => l.includes('\tdevice'))
  if (lines.length === 0) return null
  return lines[0].split('\t')[0].trim()
}

function findEmulatorBinary() {
  const candidates = [
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'emulator/emulator'),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'emulator/emulator'),
    path.join(process.env.HOME, 'Library/Android/sdk/emulator/emulator'),
    path.join(process.env.HOME, 'Android/Sdk/emulator/emulator'),
  ].filter(Boolean)
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  try { return execSync('which emulator', { encoding: 'utf8' }).trim() } catch {}
  return null
}

function findAdbBinary() {
  if (process.env.ADB_PATH && fs.existsSync(process.env.ADB_PATH)) return process.env.ADB_PATH
  const candidates = [
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools/adb'),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools/adb'),
    path.join(process.env.HOME, 'Library/Android/sdk/platform-tools/adb'),
    path.join(process.env.HOME, 'Android/Sdk/platform-tools/adb'),
  ].filter(Boolean)
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  try { return execSync('which adb', { encoding: 'utf8' }).trim() } catch {}
  return 'adb'
}

function getAvailableAVDs(emulatorBin) {
  try {
    const out = execSync(`${emulatorBin} -list-avds`, { encoding: 'utf8' }).trim()
    return out.split('\n').filter(l => l.length > 0)
  } catch { return [] }
}

function bootEmulator(emulatorBin, avdName) {
  console.log(`  → Starting emulator (${avdName})...`)
  const child = spawn(emulatorBin, ['-avd', avdName, '-no-window', '-no-audio', '-no-boot-anim'], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  for (let i = 0; i < 60; i++) {
    execSync('sleep 2')
    const serial = getConnectedDevice()
    if (serial) {
      try {
        const bootComplete = execSync(`${ADB} -s ${serial} shell getprop sys.boot_completed 2>/dev/null`, { encoding: 'utf8' }).trim()
        if (bootComplete === '1') return serial
      } catch {}
    }
  }
  throw new Error('Emulator failed to boot within 120s')
}

function npx(args, opts = {}) {
  return run(`npx ${args}`, opts)
}

// ─── Project setup (idempotent) ──────────────────────────────────────────────
function ensureModel() {
  if (fs.existsSync(LOCAL_MODEL_PATH)) return
  console.log(`  → Downloading model (${MODEL_NAME}, ~1.3 GB)...`)
  fs.mkdirSync(MODEL_DIR, { recursive: true })
  execSync(`curl -L --progress-bar -o "${LOCAL_MODEL_PATH}" "${MODEL_URL}"`, {
    stdio: ['ignore', process.stderr, 'pipe'],
    timeout: 600_000,
  })
}

function ensureAndroidProject() {
  const androidDir = path.join(__dirname, 'android')
  if (fs.existsSync(androidDir)) return
  console.log('  → cap add android...')
  npx('cap add android', { cwd: __dirname, stdio: VERBOSE ? [0, 1, 2] : ['ignore', 'pipe', 'pipe'], timeout: 60_000 })
}

function patchAndroidBuildGradle() {
  const buildGradle = path.join(__dirname, 'android/build.gradle')
  if (!fs.existsSync(buildGradle)) return
  let content = fs.readFileSync(buildGradle, 'utf8')
  if (content.includes('kotlin-gradle-plugin')) return
  content = content.replace(
    /classpath 'com\.android\.tools\.build:gradle:[^']+'/,
    match => `${match}\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.0'`
  )
  fs.writeFileSync(buildGradle, content)
}

function patchMinSdkVersion() {
  const varsGradle = path.join(__dirname, 'android/variables.gradle')
  if (!fs.existsSync(varsGradle)) return
  let content = fs.readFileSync(varsGradle, 'utf8')
  content = content.replace(/minSdkVersion = \d+/, 'minSdkVersion = 28')
  fs.writeFileSync(varsGradle, content)
}

function patchAndroidManifest() {
  const manifest = path.join(__dirname, 'android/app/src/main/AndroidManifest.xml')
  if (!fs.existsSync(manifest)) return
  let content = fs.readFileSync(manifest, 'utf8')
  if (content.includes('usesCleartextTraffic')) return
  content = content.replace(
    '<application',
    '<application\n        android:usesCleartextTraffic="true"'
  )
  fs.writeFileSync(manifest, content)
}

function patchWebIndexForTestMode() {
  const webIndexPath = path.join(__dirname, 'www/index.html')
  const androidAssetPath = path.join(
    __dirname,
    'android/app/src/main/assets/public/index.html',
  )
  const original = fs.readFileSync(webIndexPath, 'utf8')

  if (!/var TEST_MODE = (true|false)/.test(original)) {
    throw new Error('Could not find TEST_MODE flag in www/index.html')
  }

  let patched = original.replace(/var TEST_MODE = (true|false)/, 'var TEST_MODE = true')

  if (SKIP_DOWNLOAD) {
    patched = patched.replace(/var SKIP_DOWNLOAD = (true|false)/, 'var SKIP_DOWNLOAD = true')
    patched = patched.replace(/var MODEL_PATH = '[^']*'/, `var MODEL_PATH = '${DEVICE_MODEL_PATH}'`)
  }

  fs.writeFileSync(webIndexPath, patched)

  return function restore() {
    fs.writeFileSync(webIndexPath, original)
    if (fs.existsSync(androidAssetPath)) {
      fs.writeFileSync(androidAssetPath, original)
    }
  }
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

      // Kill any stale process holding the port before binding
      try { run(`lsof -ti:${RUNNER_PORT} | xargs kill -9`, { stdio: 'ignore' }) } catch {}

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
  console.log('\n🟢 LLM Sample Android E2E Test Suite\n')

  // ─── Section 0: Project Setup ──────────────────────────────────────────
  logSection('0 — Project Setup')

  try {
    ensureModel()
    pass('0.1 Model available', `${Math.round(fs.statSync(LOCAL_MODEL_PATH).size / 1024 / 1024)} MB`)
  } catch (err) {
    fail('0.1 Model available', err.message?.slice(0, 200) || 'download failed')
    process.exit(1)
  }

  // ─── Section 1: Android Setup ─────────────────────────────────────────────
  logSection('1 — Android Setup')

  // 1.1 Find or start device/emulator
  let deviceSerial
  try {
    deviceSerial = process.env.ANDROID_SERIAL || getConnectedDevice()
    if (!deviceSerial) {
      const emulatorBin = findEmulatorBinary()
      if (!emulatorBin) throw new Error('No device connected and emulator binary not found')
      const avds = getAvailableAVDs(emulatorBin)
      if (avds.length === 0) throw new Error('No device connected and no AVDs found')
      deviceSerial = bootEmulator(emulatorBin, avds[0])
    }
    process.env.ANDROID_SERIAL = deviceSerial
    pass('1.1 Android device ready', `serial ${deviceSerial}`)
  } catch (err) {
    fail('1.1 Android device ready', err.message)
    console.error('\nFatal: no Android device.\n')
    process.exit(1)
  }

  // 1.2 Ensure Android project + sync + build
  let restoreIndex = null
  let buildFailed = false
  const apkPath = path.join(__dirname, 'android/app/build/outputs/apk/debug/app-debug.apk')

  try {
    ensureAndroidProject()
    patchAndroidBuildGradle()
    patchMinSdkVersion()
    patchAndroidManifest()
    restoreIndex = patchWebIndexForTestMode()

    console.log('  → cap sync android...')
    npx('cap sync android', {
      cwd: __dirname,
      timeout: 300_000,
      stdio: VERBOSE ? [0, 1, 2] : ['ignore', 'pipe', 'pipe'],
    })
    pass('1.2 Android project synced')

    console.log('  → Building APK (./gradlew assembleDebug)… (use --verbose for build output)')
    run('./gradlew assembleDebug', { cwd: path.join(__dirname, 'android'), ...(VERBOSE && { stdio: [0, 1, 2] }) })
    if (!fs.existsSync(apkPath)) throw new Error('APK not found after build')
    const apkSize = Math.round(fs.statSync(apkPath).size / 1024 / 1024)
    pass('1.3 APK built', `${apkSize} MB`)
  } catch (err) {
    const msg = (err.stderr || err.stdout || err.message || '').split('\n').filter(l => l.toLowerCase().includes('error')).slice(0, 3).join(' | ') || err.message?.slice(0, 200)
    fail('1.2 Build pipeline', msg)
    buildFailed = true
  } finally {
    if (restoreIndex) restoreIndex()
  }

  if (buildFailed) process.exit(1)

  // 1.3 Install APK + ADB reverse port-forward
  try {
    adb(`reverse tcp:${RUNNER_PORT} tcp:${RUNNER_PORT}`)
    try { adb(`uninstall ${BUNDLE_ID}`) } catch { /* not installed */ }
    adb(`install -r "${apkPath}"`)
    pass('1.4 APK installed + port-forward', `${BUNDLE_ID}`)
  } catch (err) {
    fail('1.4 APK installed + port-forward', err.message?.slice(0, 200))
    process.exit(1)
  }

  // 1.4 Push model to device (when --skip-download)
  if (SKIP_DOWNLOAD) {
    try {
      const modelCheck = adb(`shell ls -la ${DEVICE_MODEL_PATH} 2>/dev/null`)
      if (!modelCheck.includes(MODEL_NAME)) throw new Error('not found')
      pass('1.5 Model on device', DEVICE_MODEL_PATH)
    } catch {
      try {
        console.log('  → Pushing model to device...')
        adb(`push "${LOCAL_MODEL_PATH}" ${DEVICE_MODEL_PATH}`, { timeout: 300_000 })
        pass('1.5 Model pushed to device', DEVICE_MODEL_PATH)
      } catch (err) {
        fail('1.5 Model on device', err.message?.slice(0, 200))
        process.exit(1)
      }
    }
  } else {
    pass('1.5 Model on device', 'skipped (in-app download)')
  }

  // ─── Section 2: HTTP E2E Test ──────────────────────────────────────────────
  logSection('2 — LLM Sample E2E')

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
