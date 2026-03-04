#!/usr/bin/env node
/**
 * LLM Sample — Serve E2E Test Suite (iOS)
 *
 * Tests the full dust-serve lifecycle: register → download (with SHA-256
 * verification and progress events) → ready → load via serve path →
 * inference → unload → cold-start re-register.
 *
 * The app downloads the model itself (no --skip-download). Use --clean to
 * delete the model from the simulator container before launch, forcing a
 * fresh download every run.
 *
 * Usage:
 *   node test-e2e-serve-ios.mjs [--verbose] [--clean] [--open-simulator]
 */

import { execSync } from "child_process";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const VERBOSE = process.argv.includes("--verbose");
const CLEAN = process.argv.includes("--clean");
const OPEN_SIMULATOR = process.argv.includes("--open-simulator");

// ─── Config ───────────────────────────────────────────────────────────────────
const BUNDLE_ID = "io.t6x.llmchat.sample";
const RUNNER_PORT = 8099;
const TOTAL_TESTS = 10;
const TIMEOUT_MS = 1_200_000; // 20 min — download (1.3 GB) + all serve tests

const GGUF_MODEL_NAME = "Qwen3.5-2B-Q4_K_M.gguf";
const IOS_MIN_VERSION = "17";

// ─── Test runner state ────────────────────────────────────────────────────────
let passedTests = 0,
  failedTests = 0;
const testResults = [];

function logSection(title) {
  console.log(`\n${"═".repeat(60)}\n  ${title}\n${"═".repeat(60)}`);
}
function pass(name, detail) {
  passedTests++;
  testResults.push({ name, status: "PASS" });
  console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, error) {
  failedTests++;
  testResults.push({ name, status: "FAIL", error });
  console.log(`  ❌ ${name} — ${error}`);
}
function printSummary() {
  logSection("Summary");
  const total = passedTests + failedTests;
  if (failedTests === 0) {
    console.log(`\n  ✅ ALL ${total} TESTS PASSED\n`);
  } else {
    console.log(`\n  ❌ ${failedTests}/${total} TESTS FAILED\n`);
    for (const r of testResults) {
      if (r.status === "FAIL") console.log(`     • ${r.name}: ${r.error}`);
    }
    console.log();
  }
}

// ─── simctl helpers ───────────────────────────────────────────────────────────
function simctl(args, opts = {}) {
  return execSync(`xcrun simctl ${args}`, {
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

function getBootedUDID() {
  const json = simctl("list devices booted -j");
  const data = JSON.parse(json);
  for (const devices of Object.values(data.devices)) {
    for (const d of devices) {
      if (d.state === "Booted") return d.udid;
    }
  }
  return null;
}

function findAvailableIPhone() {
  const json = simctl("list devices available -j");
  const data = JSON.parse(json);
  for (const [runtime, devices] of Object.entries(data.devices)) {
    if (!runtime.includes("iOS")) continue;
    for (const d of devices) {
      if (d.name.includes("iPhone") && d.isAvailable) return d.udid;
    }
  }
  return null;
}

function bootSimulator(udid) {
  console.log(`  → Booting simulator ${udid}...`);
  simctl(`boot ${udid}`);
  if (OPEN_SIMULATOR) {
    try {
      execSync("open -a Simulator", { stdio: "ignore" });
    } catch (e) {}
  }
  for (let i = 0; i < 30; i++) {
    const booted = getBootedUDID();
    if (booted) return booted;
    execSync("sleep 1");
  }
  throw new Error("Simulator failed to boot within 30s");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Xcode version helper ─────────────────────────────────────────────────────
function getXcodeMajorVersion() {
  try {
    const out = execSync("xcodebuild -version", { encoding: "utf8" });
    const m = out.match(/Xcode (\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

// ─── Shell helper ─────────────────────────────────────────────────────────────

// Build a PATH that works in non-interactive SSH shells (no ~/.zprofile sourced).
// Prepend: the directory of the current node binary, common Homebrew paths,
// and common nvm paths so that `npm`, `npx`, and `cap` resolve without the
// caller needing to set PATH manually.
function extendedPath() {
  const nodeDir = path.dirname(process.execPath);
  const extra = [
    nodeDir,
    "/opt/homebrew/bin",       // Apple Silicon Homebrew
    "/usr/local/bin",          // Intel Homebrew / system installs
    `${process.env.HOME}/.nvm/versions/node/current/bin`, // nvm current (symlink)
  ].filter(Boolean);
  const existing = (process.env.PATH || "").split(":");
  const merged = [...new Set([...extra, ...existing])];
  return merged.join(":");
}

function run(cmd, opts = {}) {
  const result = execSync(cmd, {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: extendedPath(),
    },
    ...opts,
  });
  return (result || "").trim();
}

function npx(args, opts = {}) {
  return run(`npx ${args}`, opts);
}

// ─── Developer team helper ────────────────────────────────────────────────────
function getDeveloperTeamId() {
  if (process.env.DEVELOPMENT_TEAM) return process.env.DEVELOPMENT_TEAM;
  try {
    const out = execSync(
      "defaults read com.apple.dt.Xcode IDEProvisioningTeamManagerLastSelectedTeamID",
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (out && out.length === 10) return out;
  } catch (e) {}
  try {
    const out = execSync("security find-identity -v -p codesigning", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of out.split("\n")) {
      if (line.includes("Apple Development")) {
        const match = line.match(/\(([A-Z0-9]{10})\)/);
        if (match) return match[1];
      }
    }
  } catch (e) {}
  return null;
}

// ─── iOS platform helpers ─────────────────────────────────────────────────────
function ensureIosPlatform() {
  const iosDir = path.join(__dirname, "ios");
  const xcodeproj = path.join(__dirname, "ios/App/App.xcodeproj");
  // Re-add if missing entirely or xcodeproj is gone (broken state after rsync)
  if (fs.existsSync(iosDir) && !fs.existsSync(xcodeproj)) {
    console.log("  → iOS dir exists but App.xcodeproj missing — removing and re-adding...");
    execSync(`rm -rf "${iosDir}"`, { stdio: "ignore" });
  }
  if (!fs.existsSync(iosDir)) {
    console.log("  → cap add ios...");
    npx("cap add ios", {
      cwd: __dirname,
      stdio: VERBOSE ? [0, 1, 2] : ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
  }
}

function fixDeploymentTarget() {
  const pbxproj = path.join(
    __dirname,
    "ios/App/App.xcodeproj/project.pbxproj",
  );
  const teamId = getDeveloperTeamId();
  if (fs.existsSync(pbxproj)) {
    let content = fs.readFileSync(pbxproj, "utf8");
    const re = /IPHONEOS_DEPLOYMENT_TARGET = \d+\.\d+/g;
    if (!content.match(re)?.[0]?.includes(`= ${IOS_MIN_VERSION}.0`)) {
      content = content.replace(
        re,
        `IPHONEOS_DEPLOYMENT_TARGET = ${IOS_MIN_VERSION}.0`,
      );
    }
    if (teamId) {
      if (
        content.includes("DEVELOPMENT_TEAM = ") &&
        !content.includes('DEVELOPMENT_TEAM = "";')
      ) {
        if (process.env.DEVELOPMENT_TEAM) {
          content = content.replace(
            /DEVELOPMENT_TEAM = [A-Z0-9]+;/g,
            `DEVELOPMENT_TEAM = ${teamId};`,
          );
        }
      } else {
        if (content.includes('DEVELOPMENT_TEAM = "";')) {
          content = content.replace(
            /DEVELOPMENT_TEAM = "";/g,
            `DEVELOPMENT_TEAM = ${teamId};`,
          );
        } else {
          content = content.replace(
            /PRODUCT_BUNDLE_IDENTIFIER = io\.t6x\.llmchat\.sample;/g,
            `PRODUCT_BUNDLE_IDENTIFIER = io.t6x.llmchat.sample;\n\t\t\t\tDEVELOPMENT_TEAM = ${teamId};`,
          );
        }
      }
    }
    fs.writeFileSync(pbxproj, content);
  }
  const capSpm = path.join(__dirname, "ios/App/CapApp-SPM/Package.swift");
  if (fs.existsSync(capSpm)) {
    let content = fs.readFileSync(capSpm, "utf8");
    content = content.replace(
      /\.iOS\(\.v\d+\)/,
      `.iOS(.v${IOS_MIN_VERSION})`,
    );
    fs.writeFileSync(capSpm, content);
  }
}

// ─── HTTP result collector ────────────────────────────────────────────────────
function startResultServer() {
  const received = new Map();

  const serverReady = new Promise((resolveServer, rejectServer) => {
    const allDonePromise = new Promise((resolveDone, rejectDone) => {
      const server = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            if (req.url === "/__llm_result") {
              received.set(payload.id, payload);
              const icon = payload.status === "pass" ? "✅" : "❌";
              console.log(
                `  [app] ${icon} ${payload.id}${payload.detail ? " — " + payload.detail : ""}${payload.error ? " — " + payload.error : ""}`,
              );
              res.writeHead(200);
              res.end("ok");
            } else if (req.url === "/__llm_done") {
              res.writeHead(200);
              res.end("ok");
              server.close();
              resolveDone({ results: received, summary: payload });
            } else {
              res.writeHead(404);
              res.end();
            }
          } catch (e) {
            res.writeHead(400);
            res.end();
          }
        });
      });

      // Kill any stale process holding the port before binding
      try { run(`lsof -ti:${RUNNER_PORT} | xargs kill -9`, { stdio: 'ignore' }) } catch {}

      server.listen(RUNNER_PORT, "0.0.0.0", () => {
        resolveServer({ server, allDonePromise });
      });

      server.on("error", rejectServer);

      setTimeout(() => {
        server.close();
        rejectDone(
          new Error(
            `Timeout after ${TIMEOUT_MS / 1000}s — ${received.size}/${TOTAL_TESTS} results received`,
          ),
        );
      }, TIMEOUT_MS);
    });
  });

  return serverReady;
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN
// ═════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("\n🔵 LLM Sample — Serve E2E Test Suite (iOS)\n");

  const teamId = getDeveloperTeamId();
  if (!teamId) {
    console.warn(
      "\n⚠️  WARNING: No Apple Developer account found in Keychain.",
    );
    console.warn(
      "   If you plan to test on a physical iPhone, please open Xcode,",
    );
    console.warn(
      "   go to Settings -> Accounts, and sign in with your Apple ID.\n",
    );
  }

  // ─── Section 0: Project Setup ──────────────────────────────────────────
  logSection("0 — Project Setup");

  try {
    ensureIosPlatform();
    fixDeploymentTarget();
    pass("0.1 iOS platform ready");
  } catch (err) {
    fail("0.1 iOS platform ready", err.message?.slice(0, 200) || "failed");
    process.exit(1);
  }

  // ─── Section 1: Device Setup ───────────────────────────────────────────
  logSection("1 — Device Setup");

  let udid;
  try {
    udid = getBootedUDID();
    if (!udid) {
      const available = findAvailableIPhone();
      if (!available)
        throw new Error("No available iPhone simulator — install one via Xcode");
      udid = bootSimulator(available);
    } else if (OPEN_SIMULATOR) {
      try {
        execSync("open -a Simulator", { stdio: "ignore" });
      } catch (e) {}
    }
    pass("1.1 Simulator ready", `UDID ${udid}`);
  } catch (err) {
    fail("1.1 Simulator ready", err.message);
    process.exit(1);
  }

  // 1.2 cap sync ios
  try {
    console.log("  → cap sync ios...");
    npx("cap sync ios", {
      cwd: __dirname,
      timeout: 60000,
      stdio: VERBOSE ? [0, 1, 2] : ["ignore", "pipe", "pipe"],
    });
    fixDeploymentTarget();
    pass("1.2 cap sync ios");
  } catch (err) {
    fail("1.2 cap sync ios", err.message?.slice(0, 200) || "failed");
    process.exit(1);
  }

  // 1.3 Build
  try {
    console.log("  → Building (xcodebuild)…");
    const xcodeMajor = getXcodeMajorVersion();
    const explicitModulesFlag =
      xcodeMajor >= 26 ? " SWIFT_ENABLE_EXPLICIT_MODULES=NO" : "";
    const derivedDataPath = path.join(__dirname, "ios/App/DerivedData");
    const baseFlags = `-scheme App -sdk iphonesimulator -destination "platform=iOS Simulator,id=${udid}" -derivedDataPath "${derivedDataPath}"`;
    const sharedOpts = {
      cwd: path.join(__dirname, "ios/App"),
      encoding: "utf8",
      timeout: 1200_000,
      maxBuffer: 200 * 1024 * 1024,
      stdio: VERBOSE ? [0, 1, 2] : ["ignore", "pipe", "pipe"],
    };

    console.log("  → Resolving SPM dependencies…");
    try {
      execSync(`xcodebuild ${baseFlags} -resolvePackageDependencies`, sharedOpts);
    } catch (_resolveErr) {}

    // Init llama.cpp submodule
    const checkoutsDir = path.join(derivedDataPath, "SourcePackages/checkouts");
    try {
      if (fs.existsSync(checkoutsDir)) {
        const entries = fs.readdirSync(checkoutsDir);
        const dustLlmDir = entries.find((e) => e.startsWith("dust-llm-swift"));
        if (dustLlmDir) {
          console.log("  → Initializing llama.cpp submodule…");
          execSync("git submodule update --init --recursive", {
            cwd: path.join(checkoutsDir, dustLlmDir),
            encoding: "utf8",
            timeout: 300_000,
            stdio: VERBOSE ? [0, 1, 2] : ["ignore", "pipe", "pipe"],
          });
        }
      }
    } catch (_subErr) {}

    execSync(
      `xcodebuild ${baseFlags} -configuration Debug build${explicitModulesFlag}`,
      sharedOpts,
    );
    pass("1.3 xcodebuild succeeded");
  } catch (err) {
    const output = err.stdout || err.stderr || err.message || "";
    const errorLines = output
      .split("\n")
      .filter((l) => /error:|FAILED/.test(l))
      .slice(0, 5)
      .join(" | ");
    fail(
      "1.3 xcodebuild succeeded",
      errorLines || "build failed — re-run with --verbose for full output",
    );
    process.exit(1);
  }

  // 1.4 Install app
  let appPath;
  try {
    const derivedDataPath = path.join(__dirname, "ios/App/DerivedData");
    const ddOut = execSync(
      `find "${derivedDataPath}" ~/Library/Developer/Xcode/DerivedData -name "App.app" -path "*Debug-iphonesimulator*" -not -path "*PlugIns*" -exec stat -f '%m %N' {} \\; 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-`,
      { encoding: "utf8", shell: true },
    ).trim();
    appPath = ddOut;
    if (!appPath) throw new Error("App.app not found in DerivedData");
    try { simctl(`terminate ${udid} ${BUNDLE_ID}`); } catch {}
    simctl(`install ${udid} "${appPath}"`);
    pass("1.4 App installed");
  } catch (err) {
    fail("1.4 App installed", err.message?.slice(0, 200) || "failed");
    process.exit(1);
  }

  // 1.5 Clean model if --clean
  if (CLEAN) {
    try {
      const dataDir = simctl(`get_app_container ${udid} ${BUNDLE_ID} data`);
      const modelPath = path.join(dataDir, "Documents", GGUF_MODEL_NAME);
      if (fs.existsSync(modelPath)) {
        fs.unlinkSync(modelPath);
        pass("1.5 Model cleaned from simulator");
      } else {
        pass("1.5 Model cleaned from simulator", "already absent");
      }
    } catch (err) {
      fail("1.5 Model cleaned from simulator", err.message?.slice(0, 200) || "failed");
      process.exit(1);
    }
  } else {
    pass("1.5 Model clean", "--clean not set, skipping");
  }

  // 1.6 Patch HTML — set SERVE_TEST_MODE = true only
  try {
    const bundleDir = simctl(`get_app_container ${udid} ${BUNDLE_ID}`);
    const htmlInBundle = path.join(bundleDir, "public/index.html");
    let html = fs.readFileSync(htmlInBundle, "utf8");
    html = html.replace(
      /var SERVE_TEST_MODE = (true|false)/,
      "var SERVE_TEST_MODE = true",
    );
    fs.writeFileSync(htmlInBundle, html);
    pass("1.6 HTML patched", "SERVE_TEST_MODE = true");
  } catch (err) {
    fail("1.6 HTML patched", err.message?.slice(0, 200) || "failed");
    process.exit(1);
  }

  // ─── Section 2: Serve E2E ─────────────────────────────────────────────
  logSection("2 — Serve E2E");

  const { server, allDonePromise } = await startResultServer();
  pass("2.0 HTTP result server started", `port ${RUNNER_PORT}`);

  try {
    try { simctl(`terminate ${udid} ${BUNDLE_ID}`); } catch {}
    await sleep(500);
    simctl(`launch ${udid} ${BUNDLE_ID}`);
    console.log("  → App launched, waiting for serve test results…");
    console.log("  → (S.5 may take up to 15 min if model is not cached)");
  } catch (err) {
    fail("2.0 App launch", err.message?.slice(0, 200) || "failed");
    server.close();
    process.exit(1);
  }

  let appResults;
  try {
    appResults = await allDonePromise;
  } catch (err) {
    fail("2.0 Test completion", err.message);
    printSummary();
    process.exit(1);
  }

  // ─── Section 3: Results ───────────────────────────────────────────────
  logSection("3 — Results");

  const { summary } = appResults;
  passedTests += summary.passed || 0;
  failedTests += summary.failed || 0;

  if (summary.fatal) {
    fail("App fatal error", summary.fatal);
  }

  printSummary();
  console.log("  ℹ️  App left running for manual interaction.\n");
  process.exit(failedTests > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
