import Capacitor
import Foundation
import DustCore
@_exported import DustLlm
import UIKit

@objc(LLMPlugin)
public class LLMPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LLMPlugin"
    public let jsName = "LLM"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "loadModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unloadModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listLoadedModels", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getModelMetadata", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tokenize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "detokenize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "countTokens", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "applyTemplate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateChat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearHistory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getContextUsed", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "streamGenerate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelGeneration", returnType: CAPPluginReturnPromise),
    ]

    private let sessionManager = LLMSessionManager()

    public override func load() {
        super.load()
        DustCoreRegistry.shared.register(modelServer: sessionManager)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleMemoryWarning),
            name: UIApplication.didReceiveMemoryWarningNotification,
            object: nil
        )
    }

    @objc func loadModel(_ call: CAPPluginCall) {
        guard let descriptor = call.getObject("descriptor"),
              let modelId = descriptor["id"] as? String,
              let format = descriptor["format"] as? String else {
            call.reject("descriptor.id and descriptor.format are required", "invalidInput", nil)
            return
        }

        let supportedFormats: Set<String> = [DustModelFormat.gguf.rawValue, DustModelFormat.mlx.rawValue]
        guard supportedFormats.contains(format) else {
            call.reject("Only gguf and mlx models are supported", "formatUnsupported", nil)
            return
        }

        guard let path = Self.resolveModelPath(from: descriptor) else {
            call.reject("descriptor.url or descriptor.metadata.localPath is required", "invalidInput", nil)
            return
        }

        let config = LLMConfig(jsObject: call.getObject("config"))
        let priority = DustSessionPriority(rawValue: call.getInt("priority") ?? DustSessionPriority.interactive.rawValue)
            ?? .interactive

        LLMSessionManager.inferenceQueue.async { [weak self] in
            guard let self else {
                call.reject("Plugin unavailable", "unknownError", nil)
                return
            }

            do {
                let session = try self.sessionManager.loadModel(
                    path: path,
                    modelId: modelId,
                    config: config,
                    priority: priority
                )
                call.resolve([
                    "modelId": session.sessionId,
                    "metadata": session.metadata.toJSObject(),
                ])
            } catch let error as LlamaError {
                self.reject(call: call, for: error)
            } catch {
                call.reject(error.localizedDescription, "inferenceFailed", error)
            }
        }
    }

    @objc func unloadModel(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else {
            call.reject("modelId is required", "invalidInput", nil)
            return
        }

        Task {
            do {
                try await sessionManager.forceUnloadModel(id: modelId)
                call.resolve()
            } catch let error as DustCoreError {
                call.reject(Self.errorMessage(for: error), Self.errorCode(for: error), error)
            } catch {
                call.reject(error.localizedDescription, "unknownError", error)
            }
        }
    }

    @objc func listLoadedModels(_ call: CAPPluginCall) {
        call.resolve([
            "modelIds": sessionManager.allModelIds(),
        ])
    }

    @objc func getModelMetadata(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else {
            call.reject("modelId is required", "invalidInput", nil)
            return
        }

        guard let session = sessionManager.session(for: modelId) else {
            call.reject("Model session not found", "modelNotFound", nil)
            return
        }

        call.resolve(session.metadata.toJSObject())
    }

    @objc func tokenize(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId"),
              let text = call.getString("text") else {
            call.reject("modelId and text are required", "invalidInput", nil)
            return
        }

        guard let session = sessionManager.session(for: modelId) else {
            call.reject("Model session not found", "modelNotFound", nil)
            return
        }

        let addSpecialTokens = call.getBool("addSpecialTokens") ?? true

        do {
            let tokens = try session.tokenize(text: text, addSpecial: addSpecialTokens)
            call.resolve([
                "tokens": tokens.map(Int.init),
            ])
        } catch let error as DustCoreError {
            call.reject(Self.errorMessage(for: error), Self.errorCode(for: error), error)
        } catch let error as LlamaError {
            reject(call: call, for: error)
        } catch {
            call.reject(error.localizedDescription, "unknownError", error)
        }
    }

    @objc func detokenize(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else {
            call.reject("modelId is required", "invalidInput", nil)
            return
        }

        guard let tokenValues = call.getArray("tokens") as? [NSNumber] else {
            call.reject("tokens is required", "invalidInput", nil)
            return
        }

        guard let session = sessionManager.session(for: modelId) else {
            call.reject("Model session not found", "modelNotFound", nil)
            return
        }

        do {
            let text = try session.detokenize(tokens: tokenValues.map { Int32(truncating: $0) })
            call.resolve([
                "text": text,
            ])
        } catch let error as DustCoreError {
            call.reject(Self.errorMessage(for: error), Self.errorCode(for: error), error)
        } catch let error as LlamaError {
            reject(call: call, for: error)
        } catch {
            call.reject(error.localizedDescription, "unknownError", error)
        }
    }

    @objc func countTokens(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId"),
              let text = call.getString("text") else {
            call.reject("modelId and text are required", "invalidInput", nil)
            return
        }

        guard let session = sessionManager.session(for: modelId) else {
            call.reject("Model session not found", "modelNotFound", nil)
            return
        }

        do {
            let count = try session.countTokens(text: text)
            call.resolve([
                "count": count,
            ])
        } catch let error as DustCoreError {
            call.reject(Self.errorMessage(for: error), Self.errorCode(for: error), error)
        } catch let error as LlamaError {
            reject(call: call, for: error)
        } catch {
            call.reject(error.localizedDescription, "unknownError", error)
        }
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId"),
              let prompt = call.getString("prompt") else {
            call.reject("modelId and prompt are required", "invalidInput", nil)
            return
        }

        guard let session = sessionManager.session(for: modelId) else {
            call.reject("Model session not found", "modelNotFound", nil)
            return
        }

        let maxTokens = call.getInt("maxTokens") ?? 256
        if maxTokens < 0 {
            call.reject("maxTokens must be greater than or equal to 0", "invalidInput", nil)
            return
        }

        let stopSequences = (call.getArray("stopSequences") as? [String]) ?? []
        let sampler = Self.parseSampler(from: call.getObject("sampler"))
        let imageData: Data?
        do {
            imageData = try Self.decodeImageData(from: call.getString("imageBase64"))
        } catch let error as DustCoreError {
            call.reject(Self.errorMessage(for: error), Self.errorCode(for: error), error)
            return
        } catch {
            call.reject(error.localizedDescription, "invalidInput", error)
            return
        }

        LLMSessionManager.inferenceQueue.async { [weak self] in
            do {
                let result = try session.generate(
                    prompt: prompt,
                    imageData: imageData,
                    maxTokens: maxTokens,
                    stopSequences: stopSequences,
                    sampler: sampler
                )
                call.resolve([
                    "text": result.text,
                    "tokenCount": result.tokenCount,
                    "stopReason": result.stopReason.rawValue,
                ])
            } catch let error as DustCoreError {
                call.reject(Self.errorMessage(for: error), Self.errorCode(for: error), error)
            } catch let error as LlamaError {
                self?.reject(call: call, for: error) ?? call.reject("Plugin unavailable", "unknownError", error)
            } catch {
                call.reject(error.localizedDescription, "unknownError", error)
            }
        }
    }

    @objc func applyTemplate(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else {
            call.reject("modelId is required", "invalidInput", nil)
            return
        }

        guard let session = sessionManager.session(for: modelId) else {
            call.reject("Model session not found", "modelNotFound", nil)
            return
        }

        guard let messages = Self.parseMessages(from: call.getArray("messages") as? [[String: Any]]) else {
            call.reject("messages is required and must contain valid role/content pairs", "invalidInput", nil)
            return
        }

        let addGenerationPrompt = call.getBool("addGenerationPrompt") ?? false

        do {
            let result = try session.applyTemplate(
                messages: messages,
                addGenerationPrompt: addGenerationPrompt
            )
            call.resolve([
                "prompt": result.prompt,
                "tokenCount": result.tokenCount,
            ])
        } catch let error as DustCoreError {
            call.reject(Self.errorMessage(for: error), Self.errorCode(for: error), error)
        } catch let error as LlamaError {
            reject(call: call, for: error)
        } catch {
            call.reject(error.localizedDescription, "unknownError", error)
        }
    }

    @objc func generateChat(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else {
            call.reject("modelId is required", "invalidInput", nil)
            return
        }

        guard let session = sessionManager.session(for: modelId) else {
            call.reject("Model session not found", "modelNotFound", nil)
            return
        }

        guard let messages = Self.parseMessages(from: call.getArray("messages") as? [[String: Any]]) else {
            call.reject("messages is required and must contain valid role/content pairs", "invalidInput", nil)
            return
        }

        let maxTokens = call.getInt("maxTokens") ?? 256
        if maxTokens < 0 {
            call.reject("maxTokens must be greater than or equal to 0", "invalidInput", nil)
            return
        }

        let stopSequences = (call.getArray("stopSequences") as? [String]) ?? []
        let sampler = Self.parseSampler(from: call.getObject("sampler"))
        let imageData: Data?
        do {
            imageData = try Self.decodeImageData(from: call.getString("imageBase64"))
        } catch let error as DustCoreError {
            notifyListeners("inferenceFailed", data: [
                "modelId": modelId,
                "error": Self.errorMessage(for: error),
                "tokenCount": 0,
            ])
            call.resolve()
            return
        } catch {
            notifyListeners("inferenceFailed", data: [
                "modelId": modelId,
                "error": error.localizedDescription,
                "tokenCount": 0,
            ])
            call.resolve()
            return
        }

        LLMSessionManager.inferenceQueue.async { [weak self] in
            do {
                let result = try session.generateChat(
                    messages: messages,
                    maxTokens: maxTokens,
                    stopSequences: stopSequences,
                    sampler: sampler
                )
                call.resolve([
                    "text": result.result.text,
                    "tokenCount": result.result.tokenCount,
                    "stopReason": result.result.stopReason.rawValue,
                    "contextUsed": result.contextUsed,
                ])
            } catch let error as DustCoreError {
                call.reject(Self.errorMessage(for: error), Self.errorCode(for: error), error)
            } catch let error as LlamaError {
                self?.reject(call: call, for: error) ?? call.reject("Plugin unavailable", "unknownError", error)
            } catch {
                call.reject(error.localizedDescription, "unknownError", error)
            }
        }
    }

    @objc func streamGenerate(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId"),
              let prompt = call.getString("prompt") else {
            call.reject("modelId and prompt are required", "invalidInput", nil)
            return
        }

        let maxTokens = call.getInt("maxTokens") ?? 256
        if maxTokens < 0 {
            call.reject("maxTokens must be greater than or equal to 0", "invalidInput", nil)
            return
        }

        let stopSequences = (call.getArray("stopSequences") as? [String]) ?? []
        let sampler = Self.parseSampler(from: call.getObject("sampler"))
        let imageData: Data?
        do {
            imageData = try Self.decodeImageData(from: call.getString("imageBase64"))
        } catch let error as DustCoreError {
            notifyListeners("inferenceFailed", data: [
                "modelId": modelId,
                "error": Self.errorMessage(for: error),
                "tokenCount": 0,
            ])
            call.resolve()
            return
        } catch {
            notifyListeners("inferenceFailed", data: [
                "modelId": modelId,
                "error": error.localizedDescription,
                "tokenCount": 0,
            ])
            call.resolve()
            return
        }

        guard let session = sessionManager.session(for: modelId) else {
            notifyListeners("inferenceFailed", data: [
                "modelId": modelId,
                "error": "Model session not found",
                "tokenCount": 0,
            ])
            call.resolve()
            return
        }

        LLMSessionManager.inferenceQueue.async { [weak self] in
            guard let self else {
                call.resolve()
                return
            }

            session.streamGenerate(
                prompt: prompt,
                imageData: imageData,
                maxTokens: maxTokens,
                stopSequences: stopSequences,
                sampler: sampler,
                onToken: { tokenIndex, tokenId, text in
                    self.notifyListeners("inferenceToken", data: [
                        "modelId": modelId,
                        "tokenIndex": tokenIndex,
                        "token": text,
                        "rawToken": Int(tokenId),
                    ])
                },
                onComplete: { fullText, tokenCount, promptTokens, tokensPerSecond, stopReason in
                    self.notifyListeners("inferenceComplete", data: [
                        "modelId": modelId,
                        "text": fullText,
                        "completionTokens": tokenCount,
                        "promptTokens": promptTokens,
                        "tokensPerSecond": tokensPerSecond,
                        "stopReason": stopReason.rawValue,
                    ])
                },
                onError: { error, tokenCount in
                    let message: String
                    if let mlCoreError = error as? DustCoreError {
                        message = Self.errorMessage(for: mlCoreError)
                    } else if let llamaError = error as? LlamaError {
                        message = Self.errorMessage(for: llamaError)
                    } else {
                        message = error.localizedDescription
                    }

                    self.notifyListeners("inferenceFailed", data: [
                        "modelId": modelId,
                        "error": message,
                        "tokenCount": tokenCount,
                    ])
                }
            )

            call.resolve()
        }
    }

    @objc func clearHistory(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else {
            call.reject("modelId is required", "invalidInput", nil)
            return
        }

        guard let session = sessionManager.session(for: modelId) else {
            call.reject("Model session not found", "modelNotFound", nil)
            return
        }

        session.clearHistory()
        call.resolve()
    }

    @objc func getContextUsed(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else {
            call.reject("modelId is required", "invalidInput", nil)
            return
        }

        guard let session = sessionManager.session(for: modelId) else {
            call.reject("Model session not found", "modelNotFound", nil)
            return
        }

        call.resolve([
            "contextUsed": session.contextUsed,
        ])
    }

    @objc func cancelGeneration(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else {
            call.reject("modelId is required", "invalidInput", nil)
            return
        }

        sessionManager.session(for: modelId)?.cancelGeneration()
        call.resolve()
    }

    private func reject(call: CAPPluginCall, for error: LlamaError) {
        switch error {
        case .fileNotFound(let path):
            call.reject("Model file not found at \(path)", "inferenceFailed", error)
        case .loadFailed(let path):
            call.reject("Failed to load GGUF model at \(path)", "inferenceFailed", error)
        case .contextCreationFailed(let path):
            call.reject("Failed to create llama context for \(path)", "inferenceFailed", error)
        case .contextOverflow(let promptTokens, let contextSize):
            call.reject("Prompt has \(promptTokens) tokens but context size is \(contextSize)", "invalidInput", error)
        case .decodeFailed:
            call.reject("llama_decode failed", "inferenceFailed", error)
        case .tokenizationFailed:
            call.reject("Tokenization failed", "inferenceFailed", error)
        case .unsupportedOperation(let detail):
            call.reject(detail, "unsupportedOperation", error)
        case .modelEvicted:
            call.reject("Model was evicted from memory", "modelEvicted", error)
        }
    }

    private static func errorMessage(for error: LlamaError) -> String {
        switch error {
        case .fileNotFound(let path):
            return "Model file not found at \(path)"
        case .loadFailed(let path):
            return "Failed to load GGUF model at \(path)"
        case .contextCreationFailed(let path):
            return "Failed to create llama context for \(path)"
        case .contextOverflow(let promptTokens, let contextSize):
            return "Prompt has \(promptTokens) tokens but context size is \(contextSize)"
        case .decodeFailed:
            return "llama_decode failed"
        case .tokenizationFailed:
            return "Tokenization failed"
        case .unsupportedOperation(let detail):
            return detail
        case .modelEvicted:
            return "Model was evicted from memory"
        }
    }

    @objc private func handleMemoryWarning() {
        Task {
            await sessionManager.evictUnderPressure(level: .critical)
        }
    }

    private static func resolveModelPath(from descriptor: [String: Any]) -> String? {
        if let url = descriptor["url"] as? String, !url.isEmpty {
            if url.hasPrefix("Documents/") {
                if let docsUrl = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
                    let fileName = String(url.dropFirst("Documents/".count))
                    return docsUrl.appendingPathComponent(fileName).path
                }
            }
            return url
        }

        if let metadata = descriptor["metadata"] as? [String: Any],
           let localPath = metadata["localPath"] as? String,
           !localPath.isEmpty {
            return localPath
        }

        return nil
    }

    private static func errorCode(for error: DustCoreError) -> String {
        switch error {
        case .modelNotFound:
            return "modelNotFound"
        case .modelNotReady:
            return "modelNotReady"
        case .formatUnsupported:
            return "formatUnsupported"
        case .sessionClosed:
            return "sessionClosed"
        case .invalidInput:
            return "invalidInput"
        case .inferenceFailed:
            return "inferenceFailed"
        default:
            return "unknownError"
        }
    }

    private static func errorMessage(for error: DustCoreError) -> String {
        switch error {
        case .modelNotFound:
            return "Model session not found"
        case .modelNotReady:
            return "Model session is busy"
        case .sessionClosed:
            return "Model session is closed"
        case .formatUnsupported:
            return "Model format not supported"
        case .invalidInput(let detail):
            return detail ?? "Invalid input"
        case .inferenceFailed(let detail):
            return detail ?? "Inference failed"
        default:
            return "Unknown error"
        }
    }

    private static func parseSampler(from jsObject: [String: Any]?) -> SamplerConfig {
        SamplerConfig(
            temperature: (jsObject?["temperature"] as? NSNumber)?.floatValue ?? 0.8,
            topK: (jsObject?["topK"] as? NSNumber)?.int32Value ?? 40,
            topP: (jsObject?["topP"] as? NSNumber)?.floatValue ?? 0.95,
            minP: (jsObject?["minP"] as? NSNumber)?.floatValue ?? 0.05,
            repeatPenalty: (jsObject?["repeatPenalty"] as? NSNumber)?.floatValue ?? 1.1,
            repeatLastN: (jsObject?["repeatLastN"] as? NSNumber)?.int32Value ?? 64,
            seed: (jsObject?["seed"] as? NSNumber)?.uint32Value ?? 0
        )
    }

    private static func decodeImageData(from imageBase64: String?) throws -> Data? {
        guard let imageBase64 else {
            return nil
        }

        guard let data = Data(base64Encoded: imageBase64) else {
            throw DustCoreError.invalidInput(detail: "imageBase64 must be valid base64")
        }

        return data
    }

    private static func parseMessages(from jsArray: [[String: Any]]?) -> [ChatMessage]? {
        guard let jsArray else {
            return nil
        }

        var messages: [ChatMessage] = []
        messages.reserveCapacity(jsArray.count)

        for dictionary in jsArray {
            guard let role = dictionary["role"] as? String,
                  let content = dictionary["content"] as? String else {
                return nil
            }

            messages.append(ChatMessage(role: role, content: content))
        }

        return messages
    }
}
