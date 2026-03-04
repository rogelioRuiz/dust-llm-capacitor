<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rogelioRuiz/dust/main/assets/branding/dust_white.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/rogelioRuiz/dust/main/assets/branding/dust_black.png">
    <img alt="dust" src="https://raw.githubusercontent.com/rogelioRuiz/dust/main/assets/branding/dust_black.png" width="200">
  </picture>
</p>

<p align="center">
  <strong>Device Unified Serving Toolkit</strong><br>
  <a href="https://github.com/rogelioRuiz/dust">dust ecosystem</a> · v0.2.2 · Apache 2.0
</p>

<p align="center">
  <a href="https://github.com/rogelioRuiz/dust/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
  <img alt="Version" src="https://img.shields.io/badge/version-0.2.2-informational">
  <img alt="npm" src="https://img.shields.io/badge/npm-dust--llm--capacitor-cb3837">
  <img alt="Capacitor" src="https://img.shields.io/badge/Capacitor-7%20%7C%208-119EFF">
  <img alt="GGUF" src="https://img.shields.io/badge/GGUF-llama.cpp-blueviolet">
  <img alt="MLX" src="https://img.shields.io/badge/MLX-Apple_Silicon-green">
  <a href="https://github.com/rogelioRuiz/dust-llm-capacitor/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/rogelioRuiz/dust-llm-capacitor/actions/workflows/ci.yml/badge.svg?branch=main"></a>
</p>

---

<p align="center">
<strong>dust ecosystem</strong> —
<a href="../capacitor-core/README.md">capacitor-core</a> ·
<strong>capacitor-llm</strong> ·
<a href="../capacitor-onnx/README.md">capacitor-onnx</a> ·
<a href="../capacitor-serve/README.md">capacitor-serve</a> ·
<a href="../capacitor-embeddings/README.md">capacitor-embeddings</a>
<br>
<a href="../dust-core-kotlin/README.md">dust-core-kotlin</a> ·
<a href="../dust-llm-kotlin/README.md">dust-llm-kotlin</a> ·
<a href="../dust-onnx-kotlin/README.md">dust-onnx-kotlin</a> ·
<a href="../dust-embeddings-kotlin/README.md">dust-embeddings-kotlin</a> ·
<a href="../dust-serve-kotlin/README.md">dust-serve-kotlin</a>
<br>
<a href="../dust-core-swift/README.md">dust-core-swift</a> ·
<a href="../dust-llm-swift/README.md">dust-llm-swift</a> ·
<a href="../dust-onnx-swift/README.md">dust-onnx-swift</a> ·
<a href="../dust-embeddings-swift/README.md">dust-embeddings-swift</a> ·
<a href="../dust-serve-swift/README.md">dust-serve-swift</a>
</p>

---

# dust-llm-capacitor

Capacitor plugin for on-device LLM inference. Supports **GGUF** models via [llama.cpp](https://github.com/ggerganov/llama.cpp) on both platforms, and **MLX** models optimized for Apple Silicon on iOS.

This is the **Capacitor bridge layer** — it translates JavaScript API calls into native calls on [dust-llm-swift](https://github.com/rogelioRuiz/dust-llm-swift) (iOS) and [dust-llm-kotlin](https://github.com/rogelioRuiz/dust-llm-kotlin) (Android), which contain all model loading, inference, and session management logic. The backend is selected automatically based on model format.

## Demo

<table>
  <tr>
    <th align="center">Android</th>
    <th align="center">iOS</th>
  </tr>
  <tr>
    <td align="center">
      <a href="android-qwen-e2e-clip.mp4"><img src="android-qwen-e2e-thumb.jpg" width="320" alt="Qwen LLM on Android — click to play"></a>
    </td>
    <td align="center">
      <a href="ios-qwen-e2e-clip.mp4"><img src="ios-qwen-e2e-thumb.jpg" width="320" alt="Qwen LLM on iOS — click to play"></a>
    </td>
  </tr>
</table>

## Quickstart — Sample app

The `sample/` directory is a standalone chat app with a model download screen and streaming chat UI. It downloads Qwen 3.5 2B (~1.3 GB) on-device and runs inference locally.

```bash
git clone https://github.com/rogelioRuiz/dust-llm-capacitor && cd dust-llm-capacitor
npm install && npm run build
cd sample && npm install

# iOS — builds, installs, and launches (opens Simulator window)
node launch-ios.mjs --open-simulator

# iOS — clean start (wipes cached models first)
node launch-ios.mjs --open-simulator --clean
```

Or from the repo root:

```bash
npm run launch:ios:sample
```

The app opens on the download screen — tap **Download Model** to fetch the GGUF file, then chat.

## Install

```bash
npm install dust-llm-capacitor dust-core-capacitor
npx cap sync
```

## Project structure

```
dust-llm-capacitor/
├── package.json                 # npm package, peer deps: @capacitor/core ^7||^8, dust-core-capacitor
├── Package.swift                # SPM manifest — depends on dust-llm-swift, dust-core-capacitor
├── DustCapacitorLlm.podspec     # CocoaPods spec (production Capacitor builds)
├── src/
│   ├── definitions.ts           # LLMPlugin interface (14 methods + 3 event listeners)
│   ├── plugin.ts                # WebPlugin stub (all methods throw "unimplemented")
│   └── index.ts                 # Barrel export
├── ios/Sources/LLMPlugin/
│   └── LLMPlugin.swift          # CAPPlugin bridge — 14 @objc methods, DustCore registry, memory warnings
├── android/
│   ├── build.gradle             # depends on io.t6x.dust:dust-llm-kotlin:0.2.1
│   └── src/main/java/io/t6x/dust/capacitor/llm/
│       └── LLMPlugin.kt         # @CapacitorPlugin bridge — 14 @PluginMethod functions, coroutines, memory pressure
└── test/
    ├── generate-test-fixture.py # gguf-py script → tiny-test.gguf
    └── fixtures/tiny-test.gguf  # ~183KB valid GGUF fixture (all-zero weights)
```

## Architecture

This plugin is a **thin bridge** between JavaScript and the native dust-llm libraries:

```
┌─────────────────────────────────────────────────────────┐
│  JavaScript / TypeScript                                │
│  import { LLM } from 'dust-llm-capacitor'               │
└──────────────────────┬──────────────────────────────────┘
                       │ Capacitor bridge
┌──────────────────────┴──────────────────────────────────┐
│  LLMPlugin.swift / LLMPlugin.kt                         │
│  - Argument parsing (JSObject → native types)           │
│  - Error mapping (LlamaError/DustCoreError → JS errors) │
│  - Event emission (inferenceToken/Complete/Failed)       │
│  - DustCore registry integration                        │
│  - Memory pressure → eviction                           │
└──────────────────────┬──────────────────────────────────┘
                       │ delegates to
┌──────────────────────┴──────────────────────────────────┐
│  dust-llm-swift / dust-llm-kotlin                       │
│  - LlamaContext (llama.cpp C/JNI bindings)              │
│  - MLXEngine (Apple Silicon, iOS only)                  │
│  - LlamaSession (tokenize, generate, stream, chat)      │
│  - LLMSessionManager (dual-backend routing + cache)     │
│  - ChatTemplateEngine (Jinja2 subset renderer)          │
│  - VisionEncoder (CLIP/LLaVA multimodal)                │
└─────────────────────────────────────────────────────────┘
```

The bridge handles:
- **Argument parsing** — extracting `modelId`, `prompt`, `sampler`, `imageBase64`, etc. from `CAPPluginCall` / `PluginCall`
- **Error mapping** — converting `LlamaError` and `DustCoreError` into JS-friendly error codes (`modelNotFound`, `inferenceFailed`, `modelEvicted`, etc.)
- **Streaming events** — forwarding `onToken`, `onComplete`, `onError` callbacks as Capacitor `notifyListeners` events
- **Registry integration** — registering `LLMSessionManager` with `DustCoreRegistry` on plugin load
- **Memory pressure** — observing `UIApplication.didReceiveMemoryWarningNotification` (iOS) / `ComponentCallbacks2.onTrimMemory` (Android) and triggering session eviction

All inference logic, session management, chat templates, and vision support live in the native libraries. See [dust-llm-swift](https://github.com/rogelioRuiz/dust-llm-swift) and [dust-llm-kotlin](https://github.com/rogelioRuiz/dust-llm-kotlin) for implementation details.

## JS API

```typescript
import { LLM } from 'dust-llm-capacitor';

// Load a GGUF model
const result = await LLM.loadModel({
  descriptor: { id: 'my-model', format: 'gguf', url: '/path/to/model.gguf' },
  config: { nGpuLayers: -1, contextSize: 2048, batchSize: 512 },
  priority: 0, // 0 = interactive, 1 = background
});
// result: { modelId: string, metadata: { name?, chatTemplate?, hasVision } }

// Load an MLX model (iOS only — Apple Silicon with Metal GPU)
const mlxResult = await LLM.loadModel({
  descriptor: { id: 'my-model', format: 'mlx', url: '/path/to/Qwen3.5-2B-8bit/' },
  config: { contextSize: 2048 },
  priority: 0,
});
// Same API — backend selected automatically based on format

// Load a vision model with explicit mmproj path
const visionResult = await LLM.loadModel({
  descriptor: { id: 'gemma-3n', format: 'gguf', url: '/path/to/gemma-3n.gguf' },
  config: { nGpuLayers: -1, mmprojPath: '/path/to/gemma-3n-mmproj.gguf' },
  priority: 0,
});
// visionResult.metadata.hasVision === true

// Unload
await LLM.unloadModel({ modelId: 'my-model' });

// List loaded models
const { modelIds } = await LLM.listLoadedModels();

// Get metadata for a loaded model
const metadata = await LLM.getModelMetadata({ modelId: 'my-model' });

// Tokenize text
const { tokens } = await LLM.tokenize({
  modelId: 'my-model',
  text: 'Hello world',
  addSpecialTokens: true,
});

// Detokenize tokens back to text
const { text } = await LLM.detokenize({
  modelId: 'my-model',
  tokens: [1, 15043, 3186],
});

// Count tokens
const { count } = await LLM.countTokens({
  modelId: 'my-model',
  text: 'Hello world',
});

// Generate text (single-shot)
const gen = await LLM.generate({
  modelId: 'my-model',
  prompt: 'Once upon a time',
  maxTokens: 256,
  stopSequences: ['\n\n'],
  sampler: {
    temperature: 0.7,
    topK: 40,
    topP: 0.95,
    minP: 0.05,
    repeatPenalty: 1.1,
    seed: 42,
  },
});
// gen: { text: string, tokenCount: number, stopReason: 'max_tokens' | 'stop_sequence' | 'eos' | 'cancelled' }

// Generate with image (vision models only)
const visionGen = await LLM.generate({
  modelId: 'gemma-3n',
  prompt: 'Describe this image',
  imageBase64: '<base64-encoded-image-bytes>',
  maxTokens: 256,
});

// Stream generate (token-by-token events)
const tokenListener = await LLM.addListener('inferenceToken', (event) => {
  // event: { modelId, tokenIndex, token, rawToken }
  process.stdout.write(event.token);
});

const completeListener = await LLM.addListener('inferenceComplete', (event) => {
  // event: { modelId, text, completionTokens, promptTokens, tokensPerSecond, stopReason }
  console.log(`\n\nDone: ${event.completionTokens} tokens at ${event.tokensPerSecond.toFixed(1)} tok/s`);
});

const failedListener = await LLM.addListener('inferenceFailed', (event) => {
  // event: { modelId, error, tokenCount }
  console.error(`Failed after ${event.tokenCount} tokens: ${event.error}`);
});

await LLM.streamGenerate({
  modelId: 'my-model',
  prompt: 'Once upon a time',
  maxTokens: 256,
  stopSequences: ['\n\n'],
  sampler: { temperature: 0.7 },
});

// Stream generate with image (vision models only)
await LLM.streamGenerate({
  modelId: 'gemma-3n',
  prompt: 'What do you see?',
  imageBase64: '<base64-encoded-image-bytes>',
  maxTokens: 256,
});

// Cancel mid-stream (call from another context, e.g., a button handler)
await LLM.cancelGeneration({ modelId: 'my-model' });

// Clean up listeners
tokenListener.remove();
completeListener.remove();
failedListener.remove();

// Apply chat template (renders messages using model's Jinja2 template)
const template = await LLM.applyTemplate({
  modelId: 'my-model',
  messages: [
    { role: 'system', content: 'You are a helpful assistant' },
    { role: 'user', content: 'Hello' },
  ],
  addGenerationPrompt: true,
});
// template: { prompt: string, tokenCount: number }

// Multi-turn chat generation (stateful — session tracks history)
const chat1 = await LLM.generateChat({
  modelId: 'my-model',
  messages: [
    { role: 'system', content: 'You are a helpful assistant' },
    { role: 'user', content: 'What is 2+2?' },
  ],
  maxTokens: 256,
  sampler: { temperature: 0.7 },
});
// chat1: { text: string, tokenCount: number, stopReason, contextUsed: number }

// Follow-up turn (only send the new user message — history is in the session)
const chat2 = await LLM.generateChat({
  modelId: 'my-model',
  messages: [{ role: 'user', content: 'And what is 3+3?' }],
  maxTokens: 256,
});

// Check how much of the context window is used
const { contextUsed } = await LLM.getContextUsed({ modelId: 'my-model' });

// Clear conversation history (reset to fresh state)
await LLM.clearHistory({ modelId: 'my-model' });
```

## Development setup

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | >= 20 | `npm install` / TypeScript build |
| Xcode | with iOS Simulator SDK | iOS builds (macOS only) |
| Java JDK | 17 | Android compile (`JavaVersion.VERSION_17`) |
| Android SDK | compileSdk 36 (minSdk 28) | Android Studio or command-line SDK |

### Clone and build

```bash
git clone https://github.com/rogelioRuiz/dust-llm-capacitor.git
cd dust-llm-capacitor
npm install
npm run build   # compile TypeScript → dist/esm/
```

### iOS build

The plugin resolves all native dependencies via SPM (Package.swift). No local sibling directories needed — `dust-llm-swift`, `dust-core-swift`, and `dust-core-capacitor` are fetched from GitHub automatically.

```bash
xcodebuild build \
  -scheme DustCapacitorLlm \
  -destination 'platform=iOS Simulator,name=iPhone 16e' \
  -skipPackagePluginValidation
```

> **Note:** First build takes ~10 minutes because `dust-llm-swift` includes a [llama.cpp](https://github.com/ggerganov/llama.cpp) git submodule (~2GB) that SPM clones and compiles from source. Subsequent builds use the SPM cache.

### Android build

The Android module depends on `project(':capacitor-android')` and `project(':capacitor-core')`, which are resolved by the host Capacitor app's `settings.gradle`. This means the Android module **cannot be built standalone** — it must be built as part of a Capacitor app.

Native dependencies (`io.t6x.dust:dust-llm-kotlin:0.2.1`, `io.t6x.dust:dust-core-kotlin:0.1.0`) are fetched from Maven Central automatically.

To build in the context of a Capacitor app:

```bash
cd your-capacitor-app
npm install dust-llm-capacitor dust-core-capacitor
npx cap sync android
cd android
./gradlew assembleDebug
```

## Running tests

Tests for the inference engine, session management, chat templates, and vision support live in the native libraries:

- **iOS tests:** [dust-llm-swift](https://github.com/rogelioRuiz/dust-llm-swift) — 51 XCTests (49 passing, 2 skipped)
- **Android tests:** [dust-llm-kotlin](https://github.com/rogelioRuiz/dust-llm-kotlin) — 52 JUnit tests (50 passing, 2 skipped)

### TypeScript checks

```bash
npm run build       # tsc
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
```

## E2E testing

Two test suites validate the full stack — the **sample app** (10 in-app tests) and the **example app** (14 in-app tests covering model loading, streaming, cancellation, stop sequences, and multi-turn chat).

### Sample app tests

```bash
npm run test:ios:sample       # iOS (requires booted simulator or physical device)
npm run test:android:sample   # Android (requires connected device/emulator)
```

Or step by step:

```bash
cd sample && npm install

# iOS — downloads model, builds, runs 10 in-app tests, leaves app running
node test-e2e-ios.mjs --verbose

# iOS with pre-cached model (faster — skips in-app download)
node test-e2e-ios.mjs --verbose --skip-download

# iOS MLX (requires physical Apple Silicon device)
node test-e2e-ios.mjs --verbose --mlx
```

### Example app tests

```bash
npm run test:ios       # iOS GGUF
npm run test:android   # Android GGUF
```

Or step by step:

```bash
cd example && npm install

# iOS (GGUF)
node test-e2e-ios.mjs

# iOS (MLX — requires physical device with Metal GPU)
node test-e2e-ios.mjs --mlx

# Android
node test-e2e-android.mjs
```

> **Note:** The `--mlx` flag downloads [Qwen 3.5 2B 8-bit](https://huggingface.co/mlx-community/Qwen3.5-2B-8bit) (~2.6 GB) from the mlx-community HuggingFace repo. MLX requires Metal GPU acceleration, which is only available on physical Apple Silicon devices — it will not work on the iOS Simulator.

### What the test scripts auto-handle

- Download [Qwen 3.5 2B](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF) Q4_K_M (~1.3 GB) or [Qwen 3.5 2B 8-bit MLX](https://huggingface.co/mlx-community/Qwen3.5-2B-8bit) (~2.6 GB), cached in `test/models/`
- `cap add ios` / `cap add android` if platform directory is missing
- iOS: patch deployment target to 17.0, SPM resolution, auto-signing
- Android: patch Kotlin Gradle plugin, minSdk 28, cleartext HTTP for localhost
- `cap sync`, native build (`xcodebuild` / `gradlew assembleDebug`)
- App install, model deployment to simulator/device, HTTP result collection

### Test prerequisites

| | iOS | Android |
|---|---|---|
| **OS** | macOS | macOS / Linux / Windows |
| **Runtime** | Auto-boots simulator if needed | Auto-starts emulator if needed |
| **SDK** | Xcode with at least one iPhone simulator | JDK 17 + Android SDK + at least one AVD |
| **Node** | >= 20 | >= 20 |

### Using a different model

You can run any GGUF or MLX model — the example app is not tied to Qwen. Here's how to swap it.

#### 1. Pick a model

**GGUF**: Browse [HuggingFace GGUF models](https://huggingface.co/models?library=gguf&sort=trending). For phones, stick to **1B–3B parameters** with **Q4_K_M** quantization — this gives the best balance of quality and speed on mobile RAM. Larger quants like Q5_K_M or Q8_0 are better quality but need more memory.

**MLX** (iOS only): Browse [mlx-community on HuggingFace](https://huggingface.co/mlx-community). Look for models with 4-bit or 8-bit quantization. MLX models are directories containing `config.json` + `.safetensors` weight files.

| Parameters | Q4_K_M size | Recommended for |
|-----------|------------|-----------------|
| 0.5B–1.5B | 0.4–1.1 GB | Any phone |
| 3B | ~2 GB | Phones with 6+ GB RAM |
| 7B | ~4.5 GB | Tablets / phones with 8+ GB RAM, short bursts |

#### 2. Update the example app

Open `example/www/index.html` and change two things:

```javascript
// Point to your model file (GGUF) or directory (MLX)
var MODEL_PATH = '/data/local/tmp/your-model-name.gguf'
var MODEL_FORMAT = 'gguf'  // 'gguf' or 'mlx'

// Optionally update the descriptor ID
function defaultDescriptor() {
  return {
    id: 'your-model',       // any string — used as the session key
    format: MODEL_FORMAT,
    url: MODEL_PATH
  }
}
```

#### 3. Tune load config

In the same file, the `loadModel()` call (line 1123) passes an `LLMConfig` object:

```javascript
var result = await state.LLM.loadModel({
  descriptor: defaultDescriptor(),
  config: {
    contextSize: 512,    // raise for models that support larger contexts (e.g., 2048, 4096)
    nGpuLayers: -1       // -1 = auto GPU (Vulkan on Android, Metal on iOS), 0 = CPU-only
  }
})
```

| Config key | Default | What it does |
|-----------|---------|-------------|
| `contextSize` | 512 | Token window size. Higher = more conversation memory, but more RAM. Start low and increase. |
| `nGpuLayers` | -1 | Number of layers offloaded to GPU. `-1` = auto (Vulkan on Android, Metal on iOS). `0` = CPU-only. Devices without Vulkan 1.2+ fall back to CPU automatically. |
| `batchSize` | (engine default) | Prompt processing batch size. Larger = faster prompt eval, more memory. |
| `mmprojPath` | — | Path to a vision projector GGUF (required for multimodal models like LLaVA or Gemma 3n). |

#### 4. Deploy the model file

Follow the same steps as above — `adb push` for Android, `cp` into the simulator's Documents folder for iOS — using your new model filename.

### Caveats

**First iOS build takes ~10 minutes.** `dust-llm-swift` includes llama.cpp as a git submodule (~2 GB). SPM clones and compiles it from source on the first build. Subsequent builds use the SPM cache and are much faster.

**Clean Derived Data if Xcode acts up.** Stale SPM caches can cause resolution failures after upgrading dependencies or switching branches. In Xcode: Product → Clean Build Folder. If that's not enough, delete `~/Library/Developer/Xcode/DerivedData` and rebuild.

**Download GGUF files with `curl` or the browser, not `git clone`.** HuggingFace repos use Git LFS for large files. Cloning the repo often produces a tiny LFS pointer file instead of the actual model, which fails with a "not a GGUF file" error at load time.

**Split GGUF files are not supported.** Some HuggingFace repos offer models split into parts (`model-00001-of-00003.gguf`, etc.). These require merging with `llama-gguf-split --merge` before use. Prefer single-file quants.

**Model too large for device RAM → silent kill on iOS, crash on Android.** iOS terminates background apps without a crash log when memory pressure is critical. The plugin auto-evicts idle models under pressure, but if a single model exceeds available RAM it can't help. Rule of thumb: model file size + ~1 GB overhead should fit in the device's free memory.

**`contextSize` multiplies memory usage.** A 4096-token context uses ~4× the RAM of a 1024-token context for the KV cache. If the app is killed shortly after loading, try lowering `contextSize` before switching to a smaller model.

**MLX models require a physical Apple Silicon device.** MLX uses Metal GPU acceleration, which is not available in the iOS Simulator. On simulator, MLX models fail immediately with a clear error. Use GGUF models for simulator testing, or test MLX on a physical iPhone/iPad.

**Android GPU requires Vulkan 1.2+.** Most 2019+ Android devices (Qualcomm Adreno, ARM Mali, Samsung Xclipse, Google Tensor) support this. Older devices and emulators without Vulkan 1.2 automatically fall back to CPU — no error, no crash. Set `nGpuLayers: 0` to force CPU-only.

**`cap sync` may regenerate patched files.** If you manually patched the iOS deployment target or Android minSdk, running `cap sync` can overwrite your changes. Re-apply patches after syncing. The E2E test scripts handle this automatically, but manual runs require awareness.

## Native dependencies

| Platform | Package | Source |
|----------|---------|--------|
| iOS | [dust-llm-swift](https://github.com/rogelioRuiz/dust-llm-swift) | SPM (`branch: "main"` — unsafeFlags restriction) |
| iOS | [dust-core-swift](https://github.com/rogelioRuiz/dust-core-swift) | SPM (`from: "0.1.0"`) |
| iOS | [dust-core-capacitor](https://github.com/rogelioRuiz/dust-core-capacitor) | SPM (`from: "0.1.0"`) |
| Android | [dust-llm-kotlin](https://github.com/rogelioRuiz/dust-llm-kotlin) | Maven Central (`io.t6x.dust:dust-llm-kotlin:0.2.1`) |
| Android | dust-core-kotlin | Transitive via dust-llm-kotlin |

## Platform differences

| Aspect | iOS | Android |
|--------|-----|---------|
| Backends | GGUF (llama.cpp) + MLX (Apple Silicon) | GGUF (llama.cpp) |
| GPU | Metal (`nGpuLayers: -1` = auto) | Vulkan (`nGpuLayers: -1` = auto, CPU fallback) |
| Build system | SPM (Package.swift) or CocoaPods (podspec) | Gradle + Maven Central |
| Native library | dust-llm-swift (llama.cpp via SPM + mlx-swift-lm) | dust-llm-kotlin (llama.cpp via CMake + NDK) |
| Thread model | `DispatchQueue` | `HandlerThread` + coroutines |
| Memory pressure | `UIApplication.didReceiveMemoryWarningNotification` | `ComponentCallbacks2.onTrimMemory` |

## CocoaPods vs SPM

- **CocoaPods** (`DustCapacitorLlm.podspec`): Used in production Capacitor app builds via `cap sync`.
- **SPM** (`Package.swift`): Used for development builds and `xcodebuild` testing.

## Test fixture

The `tiny-test.gguf` file (~183KB) is a valid GGUF model generated by `test/generate-test-fixture.py`. It contains 1 transformer block, 32 tokens, 64-dim embeddings, a chat template, and a `clip.vision.image_size` marker (`hasVision: true`). All weights are zero — it loads successfully but produces meaningless output.

To regenerate:

```bash
pip install gguf numpy
python test/generate-test-fixture.py
```

## License

Copyright 2026 Rogelio Ruiz Perez. Licensed under the [Apache License 2.0](LICENSE).

---

<p align="center">
  Part of <a href="../README.md"><strong>dust</strong></a> — Device Unified Serving Toolkit
</p>
