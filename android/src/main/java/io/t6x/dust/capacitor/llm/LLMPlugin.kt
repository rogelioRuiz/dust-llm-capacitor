package io.t6x.dust.capacitor.llm

import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.os.Handler
import android.os.HandlerThread
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import io.t6x.dust.llm.*
import io.t6x.dust.core.DustCoreError
import io.t6x.dust.core.ModelFormat
import io.t6x.dust.core.SessionPriority
import io.t6x.dust.capacitor.serve.ServePlugin
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.android.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.Base64

@CapacitorPlugin(name = "LLM")
class LLMPlugin : Plugin(), ComponentCallbacks2 {
    private val workerThread = HandlerThread("llm-inference")
    private lateinit var handler: Handler
    private lateinit var dispatcher: CoroutineDispatcher
    private lateinit var scope: CoroutineScope
    private val sessionManager = LLMSessionManager()

    override fun load() {
        workerThread.start()
        handler = Handler(workerThread.looper)
        dispatcher = handler.asCoroutineDispatcher()
        scope = CoroutineScope(dispatcher + SupervisorJob())
        (bridge.getPlugin("Serve")?.getInstance() as? ServePlugin)
            ?.setSessionFactory(sessionManager, ModelFormat.GGUF.value)
        bridge.context.registerComponentCallbacks(this)
    }

    override fun handleOnDestroy() {
        bridge.context.unregisterComponentCallbacks(this)
        super.handleOnDestroy()
        if (::scope.isInitialized) {
            scope.cancel()
        }
        workerThread.quitSafely()
    }

    @PluginMethod
    fun loadModel(call: PluginCall) {
        val descriptor = call.getObject("descriptor")
        val modelId = descriptor?.getString("id")
        val format = descriptor?.getString("format")

        if (modelId.isNullOrEmpty() || format.isNullOrEmpty()) {
            call.reject("descriptor.id and descriptor.format are required", "invalidInput")
            return
        }

        if (format != ModelFormat.GGUF.value) {
            call.reject("Only gguf models are supported", "formatUnsupported")
            return
        }

        val path = resolveModelPath(descriptor)
        if (path.isNullOrEmpty()) {
            call.reject("descriptor.url or descriptor.metadata.localPath is required", "invalidInput")
            return
        }

        val configObject = call.getObject("config")
        val config = LLMConfig(
            nGpuLayers = configObject?.getInteger("nGpuLayers") ?: -1,
            contextSize = configObject?.getInteger("contextSize") ?: 2048,
            batchSize = configObject?.getInteger("batchSize") ?: 512,
            mmprojPath = configObject?.getString("mmprojPath"),
        )
        val priority = SessionPriority.fromRawValue(call.getInt("priority") ?: SessionPriority.INTERACTIVE.rawValue)
            ?: SessionPriority.INTERACTIVE

        scope.launch {
            try {
                val session = sessionManager.loadModel(path, modelId, config, priority)
                val result = JSObject()
                result.put("modelId", session.sessionId)
                result.put("metadata", session.metadata.toJSObject())
                call.resolve(result)
            } catch (error: DustCoreError) {
                call.reject(error.message ?: "Inference failed", error.code())
            } catch (error: Throwable) {
                call.reject(error.message ?: "Unknown error", "unknownError")
            }
        }
    }

    @PluginMethod
    fun unloadModel(call: PluginCall) {
        val modelId = call.getString("modelId")
        if (modelId.isNullOrEmpty()) {
            call.reject("modelId is required", "invalidInput")
            return
        }

        scope.launch {
            try {
                sessionManager.forceUnloadModel(modelId)
                call.resolve()
            } catch (error: DustCoreError) {
                call.reject(error.message ?: "Failed to unload", error.code())
            } catch (error: Throwable) {
                call.reject(error.message ?: "Unknown error", "unknownError")
            }
        }
    }

    @PluginMethod
    fun listLoadedModels(call: PluginCall) {
        val modelIds = JSArray()
        for (modelId in sessionManager.allModelIds()) {
            modelIds.put(modelId)
        }
        val result = JSObject()
        result.put("modelIds", modelIds)
        call.resolve(result)
    }

    @PluginMethod
    fun getModelMetadata(call: PluginCall) {
        val modelId = call.getString("modelId")
        if (modelId.isNullOrEmpty()) {
            call.reject("modelId is required", "invalidInput")
            return
        }

        val session = sessionManager.session(modelId)
        if (session == null) {
            call.reject("Model session not found", "modelNotFound")
            return
        }

        call.resolve(session.metadata.toJSObject())
    }

    @PluginMethod
    fun tokenize(call: PluginCall) {
        val modelId = call.getString("modelId")
        val text = call.getString("text")
        if (modelId.isNullOrEmpty() || text == null) {
            call.reject("modelId and text are required", "invalidInput")
            return
        }

        val session = sessionManager.session(modelId)
        if (session == null) {
            call.reject("Model session not found", "modelNotFound")
            return
        }

        try {
            val tokens = session.tokenize(text, call.getBoolean("addSpecialTokens") ?: true)
            val array = JSArray()
            for (token in tokens) {
                array.put(token)
            }
            call.resolve(JSObject().put("tokens", array))
        } catch (error: DustCoreError) {
            call.reject(error.message ?: "Tokenization failed", error.code())
        } catch (error: LlamaError) {
            call.reject(error.message ?: "Tokenization failed", error.code())
        } catch (error: Throwable) {
            call.reject(error.message ?: "Unknown error", "unknownError")
        }
    }

    @PluginMethod
    fun detokenize(call: PluginCall) {
        val modelId = call.getString("modelId")
        val tokensArray = call.getArray("tokens")
        if (modelId.isNullOrEmpty() || tokensArray == null) {
            call.reject("modelId and tokens are required", "invalidInput")
            return
        }

        val session = sessionManager.session(modelId)
        if (session == null) {
            call.reject("Model session not found", "modelNotFound")
            return
        }

        val tokens = IntArray(tokensArray.length()) { index -> tokensArray.getInt(index) }

        try {
            call.resolve(JSObject().put("text", session.detokenize(tokens)))
        } catch (error: DustCoreError) {
            call.reject(error.message ?: "Detokenization failed", error.code())
        } catch (error: LlamaError) {
            call.reject(error.message ?: "Detokenization failed", error.code())
        } catch (error: Throwable) {
            call.reject(error.message ?: "Unknown error", "unknownError")
        }
    }

    @PluginMethod
    fun countTokens(call: PluginCall) {
        val modelId = call.getString("modelId")
        val text = call.getString("text")
        if (modelId.isNullOrEmpty() || text == null) {
            call.reject("modelId and text are required", "invalidInput")
            return
        }

        val session = sessionManager.session(modelId)
        if (session == null) {
            call.reject("Model session not found", "modelNotFound")
            return
        }

        try {
            call.resolve(JSObject().put("count", session.countTokens(text)))
        } catch (error: DustCoreError) {
            call.reject(error.message ?: "Token counting failed", error.code())
        } catch (error: LlamaError) {
            call.reject(error.message ?: "Token counting failed", error.code())
        } catch (error: Throwable) {
            call.reject(error.message ?: "Unknown error", "unknownError")
        }
    }

    @PluginMethod
    fun generate(call: PluginCall) {
        val modelId = call.getString("modelId")
        val prompt = call.getString("prompt")
        if (modelId.isNullOrEmpty() || prompt == null) {
            call.reject("modelId and prompt are required", "invalidInput")
            return
        }

        val session = sessionManager.session(modelId)
        if (session == null) {
            call.reject("Model session not found", "modelNotFound")
            return
        }

        val maxTokens = call.getInt("maxTokens") ?: 256
        if (maxTokens < 0) {
            call.reject("maxTokens must be greater than or equal to 0", "invalidInput")
            return
        }

        val stopSequences = call.getArray("stopSequences")?.let { array ->
            List(array.length()) { index -> array.getString(index) }
        } ?: emptyList()

        val sampler = parseSampler(call.getObject("sampler"))
        val imageBytes = try {
            decodeImageBytes(call.getString("imageBase64"))
        } catch (error: DustCoreError) {
            call.reject(error.message ?: "Invalid input", error.code())
            return
        }

        scope.launch {
            try {
                val result = session.generate(prompt, maxTokens, stopSequences, sampler, imageBytes)
                call.resolve(
                    JSObject()
                        .put("text", result.text)
                        .put("tokenCount", result.tokenCount)
                        .put("stopReason", result.stopReason.wireValue),
                )
            } catch (error: DustCoreError) {
                call.reject(error.message ?: "Generation failed", error.code())
            } catch (error: LlamaError) {
                call.reject(error.message ?: "Generation failed", error.code())
            } catch (error: Throwable) {
                call.reject(error.message ?: "Unknown error", "unknownError")
            }
        }
    }

    @PluginMethod
    fun applyTemplate(call: PluginCall) {
        val modelId = call.getString("modelId")
        if (modelId.isNullOrEmpty()) {
            call.reject("modelId is required", "invalidInput")
            return
        }

        val session = sessionManager.session(modelId)
        if (session == null) {
            call.reject("Model session not found", "modelNotFound")
            return
        }

        val messages = parseMessages(call.getArray("messages"))
        if (messages == null) {
            call.reject("messages is required and must contain valid role/content pairs", "invalidInput")
            return
        }

        try {
            val enableThinking = call.getBoolean("enableThinking")
            val (prompt, tokenCount) = session.applyTemplate(
                messages = messages,
                addGenerationPrompt = call.getBoolean("addGenerationPrompt") ?: false,
                enableThinking = enableThinking,
            )
            call.resolve(
                JSObject()
                    .put("prompt", prompt)
                    .put("tokenCount", tokenCount),
            )
        } catch (error: DustCoreError) {
            call.reject(error.message ?: "Template application failed", error.code())
        } catch (error: LlamaError) {
            call.reject(error.message ?: "Template application failed", error.code())
        } catch (error: Throwable) {
            call.reject(error.message ?: "Unknown error", "unknownError")
        }
    }

    @PluginMethod
    fun generateChat(call: PluginCall) {
        val modelId = call.getString("modelId")
        if (modelId.isNullOrEmpty()) {
            call.reject("modelId is required", "invalidInput")
            return
        }

        val session = sessionManager.session(modelId)
        if (session == null) {
            call.reject("Model session not found", "modelNotFound")
            return
        }

        val messages = parseMessages(call.getArray("messages"))
        if (messages == null) {
            call.reject("messages is required and must contain valid role/content pairs", "invalidInput")
            return
        }

        val maxTokens = call.getInt("maxTokens") ?: 256
        if (maxTokens < 0) {
            call.reject("maxTokens must be greater than or equal to 0", "invalidInput")
            return
        }

        val stopSequences = call.getArray("stopSequences")?.let { array ->
            List(array.length()) { index -> array.getString(index) }
        } ?: emptyList()
        val sampler = parseSampler(call.getObject("sampler"))

        scope.launch {
            try {
                val enableThinking = call.getBoolean("enableThinking")
                val (result, contextUsed) = session.generateChat(messages, maxTokens, stopSequences, sampler, enableThinking)
                call.resolve(
                    JSObject()
                        .put("text", result.text)
                        .put("tokenCount", result.tokenCount)
                        .put("stopReason", result.stopReason.wireValue)
                        .put("contextUsed", contextUsed),
                )
            } catch (error: DustCoreError) {
                call.reject(error.message ?: "Generation failed", error.code())
            } catch (error: LlamaError) {
                call.reject(error.message ?: "Generation failed", error.code())
            } catch (error: Throwable) {
                call.reject(error.message ?: "Unknown error", "unknownError")
            }
        }
    }

    @PluginMethod
    fun streamGenerate(call: PluginCall) {
        val modelId = call.getString("modelId")
        val prompt = call.getString("prompt")
        if (modelId.isNullOrEmpty() || prompt == null) {
            call.reject("modelId and prompt are required", "invalidInput")
            return
        }

        val maxTokens = call.getInt("maxTokens") ?: 256
        if (maxTokens < 0) {
            call.reject("maxTokens must be greater than or equal to 0", "invalidInput")
            return
        }

        val stopSequences = call.getArray("stopSequences")?.let { array ->
            List(array.length()) { index -> array.getString(index) }
        } ?: emptyList()

        val sampler = parseSampler(call.getObject("sampler"))
        val imageBytes = try {
            decodeImageBytes(call.getString("imageBase64"))
        } catch (error: DustCoreError) {
            notifyListeners(
                "inferenceFailed",
                JSObject()
                    .put("modelId", modelId)
                    .put("error", error.message ?: "Invalid input")
                    .put("tokenCount", 0),
            )
            call.resolve()
            return
        }

        val session = sessionManager.session(modelId)
        if (session == null) {
            notifyListeners(
                "inferenceFailed",
                JSObject()
                    .put("modelId", modelId)
                    .put("error", "Model session not found")
                    .put("tokenCount", 0),
            )
            call.resolve()
            return
        }

        scope.launch {
            session.streamGenerate(
                prompt = prompt,
                maxTokens = maxTokens,
                stopSequences = stopSequences,
                sampler = sampler,
                imageBytes = imageBytes,
                onToken = { tokenIndex, tokenId, text ->
                    notifyListeners(
                        "inferenceToken",
                        JSObject()
                            .put("modelId", modelId)
                            .put("tokenIndex", tokenIndex)
                            .put("token", text)
                            .put("rawToken", tokenId),
                    )
                },
                onComplete = { fullText, tokenCount, promptTokens, tokensPerSecond, stopReason ->
                    notifyListeners(
                        "inferenceComplete",
                        JSObject()
                            .put("modelId", modelId)
                            .put("text", fullText)
                            .put("completionTokens", tokenCount)
                            .put("promptTokens", promptTokens)
                            .put("tokensPerSecond", tokensPerSecond)
                            .put("stopReason", stopReason.wireValue),
                    )
                },
                onError = { error, tokenCount ->
                    val message = when (error) {
                        is LlamaError.ModelEvicted -> "Model was evicted from memory"
                        else -> error.message ?: "Unknown error"
                    }
                    notifyListeners(
                        "inferenceFailed",
                        JSObject()
                            .put("modelId", modelId)
                            .put("error", message)
                            .put("tokenCount", tokenCount),
                    )
                },
            )

            call.resolve()
        }
    }

    @PluginMethod
    fun cancelGeneration(call: PluginCall) {
        val modelId = call.getString("modelId")
        if (modelId.isNullOrEmpty()) {
            call.reject("modelId is required", "invalidInput")
            return
        }

        sessionManager.session(modelId)?.cancelGeneration()
        call.resolve()
    }

    @PluginMethod
    fun clearHistory(call: PluginCall) {
        val modelId = call.getString("modelId")
        if (modelId.isNullOrEmpty()) {
            call.reject("modelId is required", "invalidInput")
            return
        }

        val session = sessionManager.session(modelId)
        if (session == null) {
            call.reject("Model session not found", "modelNotFound")
            return
        }

        session.clearHistory()
        call.resolve()
    }

    @PluginMethod
    fun getContextUsed(call: PluginCall) {
        val modelId = call.getString("modelId")
        if (modelId.isNullOrEmpty()) {
            call.reject("modelId is required", "invalidInput")
            return
        }

        val session = sessionManager.session(modelId)
        if (session == null) {
            call.reject("Model session not found", "modelNotFound")
            return
        }

        call.resolve(
            JSObject().put("contextUsed", session.contextUsed),
        )
    }

    private fun resolveModelPath(descriptor: JSObject?): String? {
        if (descriptor == null) {
            return null
        }

        val url = descriptor.getString("url")
        if (!url.isNullOrEmpty()) {
            return url
        }

        val metadata = descriptor.getJSObject("metadata")
        val localPath = metadata?.getString("localPath")
        if (!localPath.isNullOrEmpty()) {
            return localPath
        }

        return null
    }

    private fun parseSampler(samplerObject: JSObject?): SamplerConfig {
        if (samplerObject == null) return SamplerConfig()
        return SamplerConfig(
            temperature = if (samplerObject.has("temperature")) samplerObject.getDouble("temperature").toFloat() else 0.8f,
            topK = if (samplerObject.has("topK")) samplerObject.getInt("topK") else 40,
            topP = if (samplerObject.has("topP")) samplerObject.getDouble("topP").toFloat() else 0.95f,
            minP = if (samplerObject.has("minP")) samplerObject.getDouble("minP").toFloat() else 0.05f,
            repeatPenalty = if (samplerObject.has("repeatPenalty")) samplerObject.getDouble("repeatPenalty").toFloat() else 1.1f,
            repeatLastN = if (samplerObject.has("repeatLastN")) samplerObject.getInt("repeatLastN") else 64,
            seed = if (samplerObject.has("seed")) samplerObject.getInt("seed") else 0,
        )
    }

    private fun decodeImageBytes(imageBase64: String?): ByteArray? {
        if (imageBase64 == null) {
            return null
        }

        return try {
            Base64.getDecoder().decode(imageBase64)
        } catch (_: IllegalArgumentException) {
            throw DustCoreError.InvalidInput("imageBase64 must be valid base64")
        }
    }

    private fun parseMessages(messagesArray: JSArray?): List<ChatMessage>? {
        if (messagesArray == null) {
            return null
        }

        val messages = mutableListOf<ChatMessage>()
        for (index in 0 until messagesArray.length()) {
            val message = messagesArray.getJSONObject(index)
            val role = message.optString("role").takeIf { message.has("role") && it.isNotEmpty() }
            val content = if (message.has("content")) {
                message.optString("content")
            } else {
                null
            }
            if (role == null || content == null) {
                return null
            }
            messages += ChatMessage(role = role, content = content)
        }
        return messages
    }

    @Suppress("DEPRECATION")
    override fun onTrimMemory(level: Int) {
        val pressureLevel = when {
            level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL -> MemoryPressureLevel.CRITICAL
            level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> MemoryPressureLevel.STANDARD
            level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND -> MemoryPressureLevel.CRITICAL
            else -> null
        }

        pressureLevel?.let { pressure ->
            scope.launch { sessionManager.evictUnderPressure(pressure) }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {}

    @Deprecated("Required legacy fallback for Android low-memory callbacks")
    @Suppress("DEPRECATION")
    override fun onLowMemory() {
        scope.launch { sessionManager.evictUnderPressure(MemoryPressureLevel.CRITICAL) }
    }
}

private fun LLMModelMetadata.toJSObject(): JSObject {
    val result = JSObject()
    result.put("hasVision", hasVision)
    name?.let { result.put("name", it) }
    chatTemplate?.let { result.put("chatTemplate", it) }
    return result
}

private fun DustCoreError.code(): String = when (this) {
    is DustCoreError.ModelNotFound -> "modelNotFound"
    is DustCoreError.ModelNotReady -> "modelNotReady"
    is DustCoreError.FormatUnsupported -> "formatUnsupported"
    is DustCoreError.SessionClosed -> "sessionClosed"
    is DustCoreError.InvalidInput -> "invalidInput"
    is DustCoreError.InferenceFailed -> "inferenceFailed"
    else -> "unknownError"
}

private fun LlamaError.code(): String = when (this) {
    is LlamaError.ModelEvicted -> "modelEvicted"
    is LlamaError.UnsupportedOperation -> "unsupportedOperation"
}
