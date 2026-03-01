<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/branding/dust_white.png">
    <source media="(prefers-color-scheme: light)" srcset="../assets/branding/dust_black.png">
    <img alt="dust" src="../assets/branding/dust_black.png" width="200">
  </picture>
</p>

<p align="center"><strong>Device Unified Serving Toolkit</strong></p>

# capacitor-llm

Capacitor plugin for on-device LLM inference via [llama.cpp](https://github.com/ggerganov/llama.cpp) over GGUF model files.

**Current stage: L7** — model loading/unloading + tokenization + single-shot generation + true streaming generation with cancellation on both platforms + chat templates & conversation history + DustCore registry integration & session lifecycle (ref counting, eviction, memory-pressure cleanup) + vision/multimodal input (CLIP/LLaVA) + sampler nullability hardening.

## Project structure

```
capacitor-llm/
├── package.json                     # v0.1.0, peer deps: @capacitor/core ^7||^8, @dust/capacitor-core >=0.1.0
├── Package.swift                    # SPM manifest — llama C target + llava C target + LLMPlugin Swift target
├── DustCapacitorLlm.podspec             # CocoaPods spec (production Capacitor builds via Xcode)
├── src/
│   ├── definitions.ts               # LLMPlugin (14 methods + 3 event listeners), types, StopReason, ChatMessage, streaming events, imageBase64, promptTokens
│   ├── plugin.ts                    # WebPlugin stub (all methods throw "unimplemented")
│   └── index.ts                     # Barrel export
├── ios/
│   ├── Sources/LLMPlugin/
│   │   ├── LLMPlugin.swift          # CAPPlugin bridge (14 @objc methods), DustCoreRegistry registration, memory warning eviction, imageBase64 decode
│   │   ├── LlamaContext.swift       # Wraps llama_model* + llama_context*, reads GGUF metadata, conforms to LlamaEngine, LlamaError enum, withContext() for vision eval
│   │   ├── LlamaEngine.swift        # LlamaEngine protocol + SamplerConfig/StopReason/GenerateResult types + LlamaContext extension + generateWithVision/generateStreamingWithVision
│   │   ├── LlamaSession.swift       # DustModelSession impl — tokenize, generate, streamGenerate, cancelGeneration, generateChat, history, eviction, vision-aware generate/streamGenerate
│   │   ├── ChatTemplateEngine.swift # Jinja2 subset renderer — lexer/parser/evaluator, ChatML fallback
│   │   ├── LLMSessionManager.swift  # DustModelServer — ref-counted session cache, descriptor/status tracking, eviction, VisionEncoderFactory integration
│   │   ├── LLMConfig.swift          # nGpuLayers (-1=auto), contextSize (2048), batchSize (512), mmprojPath
│   │   └── VisionEncoder.swift      # VisionEncoderProtocol + ImageEmbedding + VisionEncoder (CLIP/LLaVA wrapper)
│   └── Tests/LLMPluginTests/
│       ├── LLMSessionManagerTests.swift  # 8 XCTest tests (L1-T1 through L1-T8)
│       ├── LLMGenerationTests.swift      # 8 XCTest tests (L2-T1 through L2-T8) with MockLlamaEngine
│       ├── LLMStreamingTests.swift       # 9 XCTest tests (L3-T1 through L3-T9) with MockLlamaEngine
│       ├── LLMChatTemplateTests.swift    # 8 XCTest tests (L4-T1 through L4-T8) with ChatTemplateMockLlamaEngine
│       ├── LLMRegistryTests.swift        # 9 XCTest tests (L5-T1 through L5-T9) — registry, ref counting, eviction
│       ├── LLMVisionTests.swift          # 8 XCTest tests (L6-T1 through L6-T8) — vision encoder, image embedding, mock + real CLIP
│       └── Fixtures/tiny-test.gguf       # ~183KB valid GGUF fixture
├── android/
│   ├── build.gradle                 # externalNativeBuild cmake, @dust/capacitor-core dep
│   ├── src/main/cpp/
│   │   ├── CMakeLists.txt           # add_subdirectory(llama.cpp), llava OBJECT library, llama_jni shared lib
│   │   └── llama_jni.cpp            # JNI: load/free, tokenize/detokenize, single-shot + streaming generation (text + vision), nativeClip* (6 vision functions)
│   ├── src/main/java/com/t6x/plugins/llm/
│   │   ├── LLMPlugin.kt             # @CapacitorPlugin(name="LLM"), HandlerThread dispatcher, 14 @PluginMethod functions, DustCoreRegistry registration, imageBase64 decode
│   │   ├── LlamaJNI.kt              # System.loadLibrary("llama_jni"), 15 external fun declarations (single-shot + streaming + vision)
│   │   ├── LlamaEngine.kt           # LlamaEngine interface + SamplerConfig/StopReason/GenerateResult types + LlamaError sealed class (incl. UnsupportedOperation) + generateWithVision/generateStreamingWithVision
│   │   ├── LlamaContextWrapper.kt   # Kotlin wrapper implementing LlamaEngine: load, tokenize, detokenize, generate, generateStreaming, generateWithVision, close
│   │   ├── LlamaSession.kt          # ModelSession impl — tokenize, generate, streamGenerate, cancelGeneration, generateChat, history, eviction, vision-aware generate/streamGenerate
│   │   ├── ChatTemplateEngine.kt    # Jinja2 subset renderer — lexer/parser/evaluator, ChatML fallback
│   │   ├── LLMSessionManager.kt     # ModelServer — ref-counted session cache, descriptor/status tracking, eviction, VisionEncoderFactory integration
│   │   ├── LLMConfig.kt             # data class (nGpuLayers=0, contextSize=2048, batchSize=512, mmprojPath)
│   │   └── VisionEncoder.kt         # VisionEncoderEngine interface + ImageEmbedding + VisionEncoder (JNI CLIP/LLaVA wrapper)
│   └── src/test/java/com/t6x/plugins/llm/
│       ├── LLMSessionManagerTest.kt  # 10 JUnit local tests (L1-T1..T8, L7-T1..T2; mock factories, no JNI)
│       ├── LLMGenerationTest.kt      # 8 JUnit local tests (L2-T1..T8, MockLlamaEngine)
│       ├── LLMStreamingTest.kt       # 9 JUnit local tests (L3-T1..T9, StreamingMockLlamaEngine)
│       ├── LLMChatTemplateTest.kt    # 8 JUnit local tests (L4-T1..T8, ChatTemplateMockLlamaEngine)
│       ├── LLMRegistryTest.kt        # 9 JUnit local tests (L5-T1..T9) — registry, ref counting, eviction
│       └── LLMVisionTest.kt          # 8 JUnit local tests (L6-T1..T8) — vision encoder, image embedding, mock + real CLIP
├── native/
│   ├── llama.cpp/                   # Git submodule pinned to tag b4569
│   ├── llama-spm-headers/           # SPM module shim (symlinks + module.modulemap) for llama core
│   └── llava-spm-headers/           # SPM module shim (clip-shim.h + llava.h symlink + module.modulemap) for CLIP/LLaVA
└── test/
    ├── generate-test-fixture.py     # gguf-py script -> tiny-test.gguf
    └── fixtures/tiny-test.gguf      # Master copy of test fixture
```

## Architecture

### LlamaEngine protocol/interface

The `LlamaEngine` abstraction sits between `LlamaSession` and the raw llama.cpp C calls. This is the key testability seam:

- **Production**: `LlamaContext` (iOS) / `LlamaContextWrapper` (Android) implements `LlamaEngine`, delegating to llama.cpp C/JNI calls
- **Tests**: `MockLlamaEngine` returns scripted token sequences — no C library, no JNI, no model file needed

The engine provides: `tokenize`, `detokenize`, `generate` (prompt-in, tokens-out), `generateStreaming` (prompt-in, token-by-token callbacks), `generateWithVision` / `generateStreamingWithVision` (prompt + image embedding), `nCtx` (context size).

### Vision / multimodal input (L6)

Vision-capable models (Gemma-3n, Qwen2.5-Omni, LLaVA) can accept image input alongside text prompts. The pipeline:

1. **Detection**: GGUF metadata contains `clip.vision.image_size` → `hasVision: true` in `LLMModelMetadata`
2. **mmproj loading**: Convention-based path (`model-mmproj.gguf` alongside `model.gguf`) with explicit `mmprojPath` override in `LLMConfig`
3. **Encoding**: `VisionEncoder` wraps `clip_model_load()` + `llava_image_embed_make_with_bytes()` to convert image bytes → embedding
4. **Injection**: `llava_eval_image_embed()` injects the embedding into the llama context after prompt tokens, before the sampling loop
5. **API**: `generate()` and `streamGenerate()` accept optional `imageBase64` parameter. `InferenceCompleteEvent` reports `promptTokens` (includes image embedding length)

The `VisionEncoderProtocol` (iOS) / `VisionEncoderEngine` (Android) interface enables testing with `MockVisionEncoder` — no real CLIP model needed.

### Separate llava build target

The llama.cpp maintainers keep clip/llava outside the core library (unstable API). A separate target:
- **iOS**: `llava` SPM C target compiling `clip.cpp` + `llava.cpp` with `publicHeadersPath: "llava-spm-headers"`
- **Android**: `llava` CMake OBJECT library linked into `llama_jni`

Apps that only use text models don't pay the binary size cost. The separation also avoids merge conflicts when pulling upstream changes.

### Stop-sequence detection

Done in the **session layer** (Swift/Kotlin), not in the engine. The engine returns raw tokens + a raw stop reason (`max_tokens`, `eos`, or `cancelled`). The session detokenizes the output, scans for stop sequences in the assembled text, and overrides the stop reason to `stop_sequence` if found. During streaming, stop-sequence detection triggers an internal cancel-abort to cleanly stop the engine loop, then maps the result to `stop_sequence` (not `cancelled`).

### Streaming generation

`streamGenerate()` provides token-by-token delivery via callbacks:

1. The session calls `engine.generateStreaming()`, which invokes `onToken(tokenId)` after each sampled token and checks `isCancelled()` before each decode step
2. On each token, the session accumulates all generated token IDs and detokenizes the **entire array** — then diffs against the previously emitted text to extract the new characters
3. This full-array-detokenize-and-diff strategy handles multi-byte UTF-8 codepoints correctly (e.g., emoji split across tokens). Partial sequences are buffered (emitted as empty string) until the full codepoint is complete
4. Events are delivered via Capacitor's `notifyListeners`: `inferenceToken` (per token), `inferenceComplete` (on finish), `inferenceFailed` (on error)
5. The promise resolves after completion/failure — it never rejects. Errors are reported via the `inferenceFailed` event

### Cancellation

`cancelGeneration()` sets an `AtomicBoolean` (Android) / lock-guarded `Bool` (iOS) flag that is checked by `isCancelled()` inside the engine's decode loop. Cancelling while idle is a no-op. After cancellation, the session resets to `ready` and can be reused for new generations.

### Generation guard

`LlamaSession` enforces single-concurrent-generation via `beginGeneration()`/`endGeneration()`. Attempting a second concurrent `generate()` or `streamGenerate()` on the same session throws `modelNotReady`.

### Sampler chain

Built per-call in the engine layer. The chain is configured via `SamplerConfig`:

| Parameter | Default | Effect |
|-----------|---------|--------|
| `temperature` | 0.8 | 0 = greedy sampling |
| `topK` | 40 | 0 = disabled |
| `topP` | 0.95 | 1.0 = disabled |
| `minP` | 0.05 | 0.0 = disabled |
| `repeatPenalty` | 1.1 | 1.0 = disabled |
| `repeatLastN` | 64 | 0 = disabled |
| `seed` | 0 | 0 = random |

KV cache is cleared on each `generate()` call (single-shot, no conversation state).

### Chat template engine

`ChatTemplateEngine` (Swift + Kotlin) implements a Jinja2 subset renderer that converts an array of `ChatMessage` objects into a formatted prompt string using the model's embedded `tokenizer.chat_template` from GGUF metadata. If the model has no template, it falls back to **ChatML** (`<|im_start|>role\ncontent<|im_end|>`).

The renderer is a three-phase pipeline: **Lexer** (template string → token stream) → **Parser** (recursive descent → AST) → **Evaluator** (AST walk with scoped variable context → output string).

Supported Jinja2 features:
- Output tags: `{{ expr }}` / `{{- expr -}}` (whitespace trim)
- Statement tags: `{% for/endfor %}`, `{% if/elif/else/endif %}`, `{% set %}` (including namespace attribute assignment)
- Expressions: string/integer/boolean literals, variable references, subscript (`message['role']`), attribute (`loop.index0`), slicing (`messages[1:]`), negative indexing, string concatenation (`+`), comparisons (`==`, `!=`), boolean ops (`and`, `or`, `not`), `is defined`/`is not defined`, `in` operator
- Loop variables: `loop.index0`, `loop.first`, `loop.last`, `loop.length`
- Filters: `| trim`, `| length`
- Methods: `.strip()`, `.title()`
- Built-in functions: `raise_exception()`, `namespace()`, `range()`
- Context variables: `messages`, `add_generation_prompt`, `bos_token`, `eos_token`

### Conversation history & generateChat()

`generateChat()` is the stateful multi-turn generation path. Unlike `generate()` (stateless, prompt-in text-out), `generateChat()` manages conversation history in the session:

1. **Merge** incoming messages with session's stored history
2. **Trim** if the full conversation exceeds `nCtx - maxTokens` — evicts oldest non-system user/assistant pairs while preserving system messages
3. **Apply template** — renders the merged messages through `ChatTemplateEngine` with `addGenerationPrompt: true`
4. **Generate** — calls the existing `generate()` path (includes beginGeneration guard, tokenization, engine.generate, stop-sequence detection)
5. **Update history** — appends the assistant response to session state
6. **Update `contextUsed`** — applies template to full history (without generation prompt) and counts tokens

`clearHistory()` resets both `chatMessages` and `contextUsed` to zero. `getContextUsed()` returns the current token count of the full conversation history.

### History trimming

When `promptTokens + maxTokens > contextSize`, `trimHistory()` evicts the oldest non-system messages in pairs of 2 (user + assistant) from the front. System messages are always preserved. If even a single non-system message overflows, it throws `contextOverflow`. The trimming uses actual template rendering + tokenization for accurate token counts (not estimates).

### DustCore registry integration

`LLMSessionManager` conforms to `DustModelServer` (iOS) / implements `ModelServer` (Android), making the LLM plugin a proper DustCore citizen. On plugin `load()`, the session manager registers itself with `DustCoreRegistry`, enabling other plugins to discover and interact with LLM sessions through the service-locator pattern.

The manager tracks three maps:
- **descriptors** (`[String: DustModelDescriptor]`) — registered model metadata (id, name, format, size, URL)
- **statuses** (`[String: DustModelStatus]`) — per-model status (`.notLoaded` / `.ready`), determined from file existence at registration time
- **cachedSessions** (`[String: CachedSession]`) — ref-counted loaded sessions

### Ref-counted session caching

`CachedSession` tracks `session`, `priority`, `refCount`, and `lastAccessTime`. The protocol's `loadModel(descriptor:priority:)` increments refCount (or creates a new session with refCount=1). The protocol's `unloadModel(id:)` decrements refCount but keeps the session cached — enabling shared access across multiple consumers. `forceUnloadModel(id:)` (used by the JS bridge's `unloadModel` method) removes the session entirely and calls `close()`.

A double-check locking pattern handles concurrent `loadModel` calls for the same ID: the session is created outside the lock, then re-checked inside the lock. If another thread won the race, the loser's session is discarded via `evict()`.

### Eviction

`LlamaSession.evict()` sets an `evicted` flag, clears all state (history, context, engine reference), and releases the native llama.cpp resources. Once evicted, any subsequent operation on the session (tokenize, generate, etc.) throws `LlamaError.modelEvicted` via the `activeEngine()` guard.

Two eviction paths:
- **`evict(modelId:)`** — removes a specific session from the cache and evicts it
- **`evictUnderPressure(level:)`** — evicts all sessions with refCount=0, filtered by priority level:
  - `.standard` — only background-priority sessions (least disruptive)
  - `.critical` — all idle sessions regardless of priority

On iOS, `LLMPlugin` observes `UIApplication.didReceiveMemoryWarningNotification` and triggers `.critical` eviction. Sessions are evicted in LRU order (oldest `lastAccessTime` first).

## llama.cpp submodule

Pinned to tag **b4569** (commit `2b8525d`). Compiled from source on both platforms:

- **iOS**: Metal GPU acceleration via SPM (see Package.swift)
- **Android**: CPU-only via CMake + NDK (arm64-v8a). Vulkan planned for later.

## Development setup

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | >= 20 | Required for `npm install` / TypeScript build |
| Java JDK | 17 | Android compile/test (`sourceCompatibility JavaVersion.VERSION_17`) |
| Android SDK | compileSdk 36 (minSdk 26) | Android Studio or command-line SDK |
| Android NDK | 23.1+ | Required by CMake 3.22.1 for llama.cpp native build |
| Xcode | with iOS Simulator SDK | iOS tests only (macOS required) |
| Python 3 | + `gguf`, `numpy` | Only needed to regenerate the test fixture |

### Clone and initialize

```bash
# Clone with submodules (llama.cpp)
git clone --recursive <repo-url>
cd capacitor-llm

# If already cloned without --recursive:
git submodule update --init --recursive
```

### Required sibling packages

`capacitor-llm` depends on two sibling directories at the same level:

```
parent-dir/
├── capacitor-llm/          # this package
├── @dust/capacitor-core/        # peer dependency (registry, ModelServer interface)
└── mobile-claw/
    └── examples/
        └── reference-app/   # host Capacitor project for Android Gradle tests
            └── android/
                └── settings.gradle  # includes :capacitor-llm and :capacitor-core
```

- **`@dust/capacitor-core`** — required at `../capacitor-core` for both npm (TypeScript types) and Gradle (`:capacitor-core` project dependency). Without it, `npm install` will fail (`@dust/capacitor-core` is listed as a `file:../capacitor-core` devDependency) and Android Gradle builds will fail.
- **`mobile-claw/examples/reference-app`** — required at `../mobile-claw/examples/reference-app` as the host Capacitor project for running Android unit tests. Its `settings.gradle` already includes `:capacitor-llm` and `:capacitor-core` as Gradle project references pointing to `../../../../capacitor-llm/android` and `../../../../capacitor-core/android`.

### Install dependencies

```bash
cd capacitor-llm
npm install
npm run build   # compile TypeScript → dist/esm/
```

## JS API

```typescript
import { LLM } from 'capacitor-llm';

// Load a model
const result = await LLM.loadModel({
  descriptor: { id: 'my-model', format: 'gguf', url: '/path/to/model.gguf' },
  config: { nGpuLayers: -1, contextSize: 2048, batchSize: 512 },
  priority: 0, // 0 = interactive, 1 = background
});
// result: { modelId: string, metadata: { name?, chatTemplate?, hasVision } }

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

## Test matrix

### L1 — Model Loading (8 tests)

| ID | Test | What it verifies |
|----|------|------------------|
| L1-T1 | Load valid GGUF | Session created, metadata readable, status == ready |
| L1-T2 | Load missing file | Throws with file path in error message |
| L1-T3 | Load corrupt GGUF | Throws InferenceFailed / loadFailed |
| L1-T4 | Wrong format (non-gguf) | Plugin layer rejects before reaching llama.cpp |
| L1-T5 | Unload loaded model | Session map empty, sessionCount == 0 |
| L1-T6 | Unload unknown ID | Throws ModelNotFound |
| L1-T7 | Load same ID twice | Reuses session (identity check), sessionCount == 1 |
| L1-T8 | Concurrent load two models | Both present, no deadlock |

L1 tests use **injectable session factories** — mock factories return lightweight `LlamaSession` objects without touching llama.cpp. Android unit tests run without JNI; iOS tests run without loading a real model.

### L2 — Tokenization & Generation (8 tests)

| ID | Test | What it verifies |
|----|------|------------------|
| L2-T1 | Tokenize known string | Returns expected token array from MockLlamaEngine |
| L2-T2 | Round-trip tokenize/detokenize | tokenize -> detokenize recovers original text |
| L2-T3 | Generate returns non-empty string | text, tokenCount, stopReason all populated |
| L2-T4 | Temperature=0 forwards greedy | SamplerConfig.temperature == 0 passed to engine |
| L2-T5 | maxTokens forwarded | Engine receives correct maxTokens, result.tokenCount matches |
| L2-T6 | Stop sequence truncates text | Text before stop sequence returned, stopReason == "stop_sequence" |
| L2-T7 | EOS stop reason passes through | Engine returns .eos, session preserves it |
| L2-T8 | Prompt overflows context | Throws contextOverflow when promptTokens > nCtx |

L2 tests use **MockLlamaEngine** injected directly into `LlamaSession` — scripted token sequences, no C library, no JNI, no model file.

### L3 — Streaming Generation & Cancellation (9 tests)

| ID | Test | What it verifies |
|----|------|------------------|
| L3-T1 | Stream emits incrementing token indexes | `onToken` called N times with tokenIndex = 0,1,2,...,N-1 |
| L3-T2 | Completion reports correct token count | `onComplete` fires once after all tokens; `tokenCount` matches |
| L3-T3 | Completion reports positive tokens/sec | `tokensPerSecond > 0` |
| L3-T4 | Cancel mid-stream stops with cancelled reason | Cancel at tokenIndex 2; `stopReason == cancelled`; token events <= 4 |
| L3-T5 | Cancel while idle is a no-op | No crash; status == ready; subsequent L2 generate works |
| L3-T6 | Second stream while busy reports modelNotReady | Second `streamGenerate` fires `onError` with `modelNotReady` |
| L3-T7 | Mid-stream error reports failure, session reusable | `onError` with tokenCount == 3; subsequent L2 generate succeeds |
| L3-T8 | Second stream after cancel succeeds | First cancelled, second completes normally |
| L3-T9 | Multi-byte emoji assembles without U+FFFD | Partial tokens buffer as empty string; concatenation = "Hello 😀!" |

L3 tests use a separate **MockLlamaEngine** (iOS) / **StreamingMockLlamaEngine** (Android) with `generateStreaming()` support: pre-scripted token sequences, injectable errors, and a `detokenizeHandler` closure for per-array detokenization.

### L4 — Chat Templates & Conversation History (8 tests)

| ID | Test | What it verifies |
|----|------|------------------|
| L4-T1 | ChatML template renders 3-message conversation | Exact output match against llama.cpp reference string |
| L4-T2 | Nil template falls back to ChatML | No crash; output contains `<\|im_start\|>` markers |
| L4-T3 | History trimming preserves system, evicts oldest pair | System message retained; oldest user+assistant pair removed; newest context preserved |
| L4-T4 | Single message exactly fits context | `promptTokens + maxTokens == nCtx` succeeds without trim |
| L4-T5 | Single message overflows context | Throws `contextOverflow` when prompt alone exceeds context |
| L4-T6 | clearHistory() resets contextUsed | `contextUsed > 0` before clear, `== 0` after, fresh generate works |
| L4-T7 | Multi-turn contextUsed increases | `contextUsed` after turn 2 > after turn 1 |
| L4-T8 | addGenerationPrompt adds assistant prefix | `true` → ends with `<\|im_start\|>assistant\n`; `false` → does not |

L4 tests use **ChatTemplateMockLlamaEngine** (separate class name per platform to avoid Kotlin compiler conflicts). The mock supports `tokenizeHandler`, `detokenizeHandler`, and `generateHandler` closures for multi-turn scenarios where each call returns different text. Template tests (L4-T1, T2, T8) test `ChatTemplateEngine` directly without a mock engine.

### L5 — DustCore Registry Integration & Session Lifecycle (9 tests)

| ID | Test | What it verifies |
|----|------|------------------|
| L5-T1 | Registry registration makes manager resolvable | `DustCoreRegistry.register(modelServer:)` → `resolveModelServer()` returns same instance |
| L5-T2 | loadModel for Ready descriptor → session, refCount=1 | Session status == ready, `refCount("model-a") == 1` |
| L5-T3 | loadModel for NotLoaded descriptor → modelNotReady | File doesn't exist → status stays `.notLoaded` → throws `modelNotReady` |
| L5-T4 | loadModel for unregistered ID → modelNotFound | Never registered → throws `modelNotFound` |
| L5-T5 | unloadModel decrements refCount, keeps session cached | `refCount == 0`, `hasCachedSession == true` |
| L5-T6 | loadModel twice reuses session, refCount=2 | Same identity, `refCount == 2` |
| L5-T7 | evict on refCount=0 session → session invalidated | `isModelEvicted == true`, `hasCachedSession == false` |
| L5-T8 | generate() on evicted session → modelEvicted | Throws `LlamaError.modelEvicted` |
| L5-T9 | allModelIds after eviction returns only live sessions | Before: `["model-a", "model-b"]`, after evicting a: `["model-b"]` |

L5 tests use **no-engine sessions** (T1–T7, T9) or **mock engine sessions** (T8). T8 creates a session with a real engine reference so `generate()` reaches the `activeEngine()` guard, which throws `modelEvicted` because the session was evicted. Registry state is cleaned via `resetForTesting()` in setUp/tearDown. iOS uses `RegistryMockLlamaEngine`, Android uses `registryFakeWrapper()`.

### L6 — Vision / Multimodal Input (8 tests)

| ID | Test | Mock/Real | What it verifies |
|----|------|-----------|------------------|
| L6-T1 | Load vision-capable model → VisionEncoder initialised | Mock | `session.metadata.hasVision == true`, `session.visionEncoder != nil` |
| L6-T2 | Load text-only model → VisionEncoder nil | Mock | `session.metadata.hasVision == false`, `session.visionEncoder == nil` |
| L6-T3 | Image to text-only model → unsupportedOperation | Mock | Throws `LlamaError.unsupportedOperation` before any inference call |
| L6-T4 | Valid image to vision model → encodeImage returns embedding | Real (skip) | `embedding.tokenCount > 0`, gated by `LLAVA_MMPROJ_PATH` env var |
| L6-T5 | Invalid image → encoder failure propagates | Mock | MockVisionEncoder configured to throw on bad data |
| L6-T6 | Image embedding injected at correct position | Mock | MockVisionEncoder records `evalImageEmbed` call, verifies `nPast` matches prompt token count |
| L6-T7 | Oversized image → auto-resized, no crash | Mock | MockVisionEncoder accepts any size, returns fixed embedding. Verifies session doesn't throw |
| L6-T8 | streamGenerate with image → tokens fire, promptTokens in complete event | Real (skip) | Token events fire, `inferenceComplete.promptTokens` includes image embedding length. Gated by `LLAVA_MMPROJ_PATH` |

L6 tests use **VisionMockLlamaEngine** (with `generateWithVision`/`generateStreamingWithVision` support) and **MockVisionEncoder** (configurable `imageTokenCount`, injectable errors, records `evalImageEmbed` calls). T4 and T8 are gated by the `LLAVA_MMPROJ_PATH` environment variable and skip cleanly when not set:
- iOS: `throw XCTSkip("LLAVA_MMPROJ_PATH is not set")`
- Android: `assumeTrue(mmprojPath != null)` (graceful JUnit skip)

### L7 — Android Native Streaming / Memory Pressure Wiring (2 Android tests)

| ID | Test | Platform | What it verifies |
|----|------|----------|------------------|
| L7-T1 | `evictUnderPressure(STANDARD)` evicts only background idle sessions | Android | Interactive idle sessions stay cached; background idle sessions are evicted |
| L7-T2 | `evictUnderPressure(CRITICAL)` evicts all idle sessions | Android | All refCount=0 sessions are evicted; `sessionCount == 0` |

L7 adds no new iOS tests. Android total rises to **52 tests** (50 passing, 2 skipped: L6-T4 and L6-T8). iOS remains **50 tests** (48 passing, 2 skipped).

---

## Running tests

### TypeScript

```bash
cd capacitor-llm
npm install
npm run build       # tsc
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
```

### Android unit tests

Android unit tests are **local JUnit** (no emulator needed), but they require a **host Capacitor project** to resolve `:capacitor-android` and `:capacitor-core` Gradle project dependencies. The reference-app acts as host and already includes `:capacitor-llm` and `:capacitor-core` in its `settings.gradle`.

**Prerequisites**: Java 17, Android SDK (compileSdk 36), NDK 23.1+, and the sibling directory layout described in [Development setup](#development-setup). You must also run `npm install` in `capacitor-llm/` first so that the `node_modules/` directory exists (Gradle resolves Capacitor Android library from it).

```bash
# 1. Install JS dependencies (required before Gradle can resolve capacitor-android)
cd capacitor-llm
npm install

# 2. Run tests from the reference-app android directory
cd ../mobile-claw/examples/reference-app/android
./gradlew :capacitor-llm:testDebugUnitTest
```

Expected output: `52 tests, 0 failures, 2 skipped` (10 LLMSessionManager + 8 L2 + 9 L3 + 8 L4 + 9 L5 + 8 L6, with L6-T4 and L6-T8 skipped)

#### Android gotchas

- The `kotlinx.coroutines.android.asCoroutineDispatcher` import (not `kotlinx.coroutines.asCoroutineDispatcher`) is required for the `Handler` extension. The non-android version is for `ExecutorService`.
- JUnit's `fail()` returns `Unit`, not `Nothing`. Use `error("message")` instead in lambdas that must return a typed value (e.g., session factory lambdas).
- The test uses mock session factories that never call JNI — `System.loadLibrary("llama_jni")` is never reached, so the tests run on any host without the native `.so`.
- Private mock classes in different test files within the same package must have distinct names in Kotlin. L2 uses `MockLlamaEngine`, L3 uses `StreamingMockLlamaEngine`, L4 uses `ChatTemplateMockLlamaEngine`, L6 uses `VisionTestMockLlamaEngine` to avoid compiler conflicts.

### iOS unit tests

iOS tests **must run on a macOS machine** with Xcode. They cannot run on Linux. The test binary is built for iOS Simulator and must be executed via `xcodebuild`, not `swift test`.

#### Prerequisites

- macOS with Xcode (tested on macOS 26.3 / Xcode with iOS 26.2 SDK)
- The sibling directory layout described in [Development setup](#development-setup) — specifically, `@dust/capacitor-core` must be at `../capacitor-core` relative to `capacitor-llm/`
- llama.cpp submodule initialized: `git submodule update --init --recursive`

#### Running via xcodebuild

```bash
cd capacitor-llm

xcodebuild test \
  -scheme DustCapacitorLlm \
  -destination 'platform=iOS Simulator,name=iPhone 16e' \
  -skipPackagePluginValidation
```

Expected output: `Executed 50 tests, with 2 tests skipped and 0 failures` (8 L1 + 8 L2 + 9 L3 + 8 L4 + 9 L5 + 8 L6, with L6-T4 and L6-T8 skipped)

You can substitute any iOS Simulator device name (e.g., `iPhone 16`, `iPhone SE`).

### Vision tests (L6-T4, L6-T8)

Two vision tests (L6-T4 and L6-T8) require a real CLIP mmproj GGUF model file and are **skipped by default**. To run them, set the `LLAVA_MMPROJ_PATH` environment variable to the absolute path of a compatible mmproj file:

```bash
# Android (pass as Gradle system property)
cd mobile-claw/examples/reference-app/android
./gradlew :capacitor-llm:testDebugUnitTest -DLLAVA_MMPROJ_PATH=/path/to/model-mmproj.gguf

# iOS (pass as environment variable)
LLAVA_MMPROJ_PATH=/path/to/model-mmproj.gguf xcodebuild test \
  -scheme DustCapacitorLlm \
  -destination 'platform=iOS Simulator,name=iPhone 16e' \
  -skipPackagePluginValidation
```

Without this variable, the 2 tests are gracefully skipped (iOS: `XCTSkip`, Android: `assumeTrue`). All other tests pass without any model files.

#### Why not `swift test`?

`swift test` compiles for the host platform (macOS) but the Capacitor xcframeworks from `capacitor-swift-pm` only contain iOS slices. The build succeeds (the llama C target compiles fine for macOS) but fails at the Swift target level with `no such module 'Capacitor'`. Even if you build for iOS simulator via `swift test --sdk $(xcrun --sdk iphonesimulator --show-sdk-path) --triple arm64-apple-ios16.0-simulator`, the test binary is an iOS binary that macOS can't dlopen (`incompatible platform`).

`xcodebuild test` handles this correctly by launching an iOS Simulator to run the tests.

#### SPM Package.swift — how llama.cpp is compiled

The SPM manifest solves several non-obvious problems to compile llama.cpp from source. Understanding these is critical if you update the llama.cpp submodule:

**1. Target path is `native/` (not `native/llama.cpp/`)**

The `llama` target's `path` is set to `native/` so that `publicHeadersPath` can point to `llama-spm-headers/` — a sibling directory outside the submodule. This is necessary because `llama.h` includes `"ggml.h"`, but those headers live in separate directories (`include/` vs `ggml/include/`). SPM only supports a single `publicHeadersPath`, so we created a shim directory with symlinks to all public headers from both locations plus a custom `module.modulemap`.

All `exclude` and `sources` paths are prefixed with `llama.cpp/` accordingly.

**2. llava target (CLIP/LLaVA vision)**

A separate `llava` C target compiles `clip.cpp` + `llava.cpp` from `examples/llava/`. It uses `llava-spm-headers/` for its public headers, which contains:
- `clip-shim.h` — wrapper that includes `<stdbool.h>` before `clip.h` (needed because `clip.h` uses `bool` without including the header, which fails when compiled as a C module by Swift's Clang)
- `llava.h` — symlink to `llama.cpp/examples/llava/llava.h`
- `module.modulemap` — exposes the `llava` module

**3. Metal shader handling**

The `ggml-metal.metal` file is a Metal shader that SPM would try to compile with clang (it doesn't recognize `.metal` as a resource). It is:
- **Excluded** from sources (so SPM doesn't compile it)
- **Added as a `.copy()` resource** (so it's bundled for runtime Metal compilation)

The `GGML_METAL_EMBED_LIBRARY` define is **NOT used** in SPM builds. In CMake builds, this define triggers generation of an assembly file that embeds the shader as a C blob — SPM has no custom build command equivalent. Instead, `ggml-metal.m` falls back to runtime shader compilation via `newLibraryWithSource:`.

**4. `SWIFTPM_MODULE_BUNDLE` shim**

`ggml-metal.m` uses `SWIFTPM_MODULE_BUNDLE` (guarded by `#ifdef SWIFT_PACKAGE`) to find the Metal shader resource. SPM defines `SWIFT_PACKAGE` for all targets, but only generates `SWIFTPM_MODULE_BUNDLE` for **Swift** targets. For the C `llama` target, we define it via cSettings:

```swift
.define("SWIFTPM_MODULE_BUNDLE", to: "[NSBundle mainBundle]")
```

**5. ARC disabled**

`ggml-metal.m` uses manual retain/release (`[obj release]`). SPM builds with ARC by default, so we add:

```swift
.unsafeFlags(["-fno-objc-arc"])
```

This applies to all C/ObjC files in the target. The llama.cpp C code doesn't use ObjC, so only `ggml-metal.m` is affected.

**6. `macOS(.v14)` platform**

`ggml-backend-reg.cpp` uses `std::filesystem::directory_iterator` which requires macOS 10.15+. Without a macOS platform declaration, SPM defaults to macOS 10.13 and the build fails with availability errors. The `.macOS(.v14)` declaration raises the floor.

**7. `cxxLanguageStandard: .cxx17`**

llama.cpp requires C++17. This is set at the Package level (not via `unsafeFlags`) to avoid leaking `-std=c++17` into C file compilation.

**8. Excluded directories**

The following are excluded from the `llama` target sources:
- All non-Metal GPU backends: `ggml-blas`, `ggml-cann`, `ggml-cuda`, `ggml-hip`, `ggml-kompute`, `ggml-musa`, `ggml-opencl`, `ggml-rpc`, `ggml-sycl`, `ggml-vulkan`
- Non-compilable files: all `CMakeLists.txt` and `cmake/` directories
- Non-source directories: `.devops`, `.github`, `benches`, `ci`, `cmake`, `common`, `docs`, `examples`, `gguf-py`, `grammars`, `models`, `pocs`, `prompts`, `scripts`, `tests`, `tools`

#### Updating the llama.cpp submodule

When bumping to a newer tag:

1. `cd native/llama.cpp && git fetch && git checkout <new-tag>`
2. Check for new directories or files in `ggml/src/` that might need excluding
3. Run `swift build --sdk $(xcrun --sdk iphonesimulator --show-sdk-path) --triple arm64-apple-ios16.0-simulator` to verify compilation
4. If new public headers were added to `include/` or `ggml/include/`, add symlinks to `native/llama-spm-headers/` and update `module.modulemap`
5. If `examples/llava/clip.h` or `llava.h` changed, update symlinks in `native/llava-spm-headers/`
6. Run `xcodebuild test` to verify tests still pass

### Test fixture

The `tiny-test.gguf` file (~183KB) is a valid GGUF model generated by `test/generate-test-fixture.py`. It contains:
- 1 transformer block, 32 tokens, 64-dim embeddings
- Metadata: `general.name = "tiny-test-model"`, chat template present, `clip.vision.image_size = 224` (hasVision marker)
- All-zero weights — loads successfully but produces meaningless output

L1 tests use injectable session factories with the fixture file path (no real llama.cpp model loading). L2, L3, and L4 tests use MockLlamaEngine variants with scripted responses for deterministic, fast results. L5 tests use no-engine or mock-engine sessions to test registry integration and session lifecycle without any native code. L6 tests use VisionMockLlamaEngine and MockVisionEncoder for vision paths; T4/T8 require a real mmproj GGUF file.

To regenerate:

```bash
pip install gguf numpy
python test/generate-test-fixture.py
# Copies to test/fixtures/ and ios/Tests/LLMPluginTests/Fixtures/
```

## Platform differences

| Aspect | iOS | Android |
|--------|-----|---------|
| GPU | Metal (`nGpuLayers: -1` = auto) | CPU-only (`nGpuLayers: 0`) |
| Build system | SPM (Package.swift) or CocoaPods (podspec) | Gradle + CMake + NDK |
| llama.cpp compilation | SPM C target with Metal | CMake `add_subdirectory` |
| llava compilation | SPM C target (`llava-spm-headers/`) | CMake OBJECT library linked into `llama_jni` |
| LlamaEngine impl | `LlamaContext` (Swift, conforms to protocol) | `LlamaContextWrapper` (Kotlin, implements interface) |
| VisionEncoder impl | `VisionEncoder` (Swift, conforms to `VisionEncoderProtocol`) | `VisionEncoder` (Kotlin, implements `VisionEncoderEngine`, wraps JNI) |
| Chat template | `ChatTemplateEngine.swift` (1260 lines) | `ChatTemplateEngine.kt` (957 lines) |
| Streaming engine | True per-token decode loop in `LlamaContext` | True per-token decode loop in `llama_jni.cpp` via JNI callback |
| Cancel flag | `cancelRequested: Bool` guarded by `NSLock` | `cancelRequested: AtomicBoolean` |
| Thread model | `DispatchQueue(label: "com.capacitor-llm.inference")` | `HandlerThread("llm-inference")` + coroutines |
| Concurrency guard | `NSLock` | `ReentrantLock` |
| Generation guard | `isGenerating` Bool + lock | `isGenerating` AtomicBoolean |
| Session manager | `DustModelServer` conformance | `ModelServer` implementation |
| Registry registration | `DustCoreRegistry.shared.register(modelServer:)` in `load()` | `DustCoreRegistry.getInstance().registerModelServer()` in `load()` |
| Memory pressure eviction | `UIApplication.didReceiveMemoryWarningNotification` observer | `ComponentCallbacks2` (`onTrimMemory` / `onLowMemory`) |
| Session eviction | `evict()` — sets flag, nils engine | `evict()` → `releaseResources(markEvicted: true)` — closes `AutoCloseable` engine |
| Eviction error | `LlamaError.modelEvicted` (enum case) | `LlamaError.ModelEvicted` (sealed class) |
| Vision error | `LlamaError.unsupportedOperation(String)` (enum case) | `LlamaError.UnsupportedOperation(detail: String)` (sealed class) |
| JNI generate return | N/A | Single-shot: `String[3]`; streaming: `String` stop reason + callback |
| JNI vision functions | N/A | 8 external funs: `nativeGenerateWithVision`, `nativeGenerateStreamingWithVision`, `nativeClipLoad/Free/ImageTokenCount/EncodeImage/EvalImageEmbed/FreeEmbed` |
| ABI | arm64 (simulator + device) | arm64-v8a only |

## CocoaPods vs SPM

The project supports both build systems for iOS:

- **CocoaPods** (`DustCapacitorLlm.podspec`): Used in production Capacitor app builds via `cap sync`. Uses `GGML_METAL_EMBED_LIBRARY=1` — Xcode compiles and embeds the Metal shader at build time. No runtime shader compilation needed.
- **SPM** (`Package.swift`): Used for running unit tests via `xcodebuild test`. Does NOT use `GGML_METAL_EMBED_LIBRARY` — Metal shaders are compiled at runtime from the bundled `.metal` resource file. Requires the `llama-spm-headers/` and `llava-spm-headers/` shims for module imports.

## iOS build note (Xcode 26)

`llama_sampler_chain_init()` returns an optional `UnsafeMutablePointer<llama_sampler>?` on the Xcode 26 / iOS 26 SDK. `makeSampler()` treats the chain as required (`guard let`) and conditionally adds any optional `llama_sampler_init_*` components so future Swift importer nullability changes degrade gracefully instead of failing the build.

---

<p align="center">
  Part of <a href="../README.md"><strong>dust</strong></a> — Device Unified Serving Toolkit
</p>
