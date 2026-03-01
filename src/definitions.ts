import type { PluginListenerHandle } from '@capacitor/core'
import type { ModelDescriptor, SessionPriority } from '@dust/capacitor-core'

export interface LLMConfig {
  nGpuLayers?: number
  contextSize?: number
  batchSize?: number
  mmprojPath?: string
}

export interface LLMModelMetadata {
  name?: string
  chatTemplate?: string
  hasVision: boolean
}

export interface LoadModelResult {
  modelId: string
  metadata: LLMModelMetadata
}

export type StopReason = 'max_tokens' | 'stop_sequence' | 'eos' | 'cancelled'

export interface SamplerParams {
  temperature?: number
  topK?: number
  topP?: number
  minP?: number
  repeatPenalty?: number
  repeatLastN?: number
  seed?: number
}

export interface GenerateResult {
  text: string
  tokenCount: number
  stopReason: StopReason
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ApplyTemplateResult {
  prompt: string
  tokenCount: number
}

export interface GenerateChatResult {
  text: string
  tokenCount: number
  stopReason: StopReason
  contextUsed: number
}

export interface InferenceTokenEvent {
  modelId: string
  tokenIndex: number
  token: string
  rawToken: number
}

export interface InferenceCompleteEvent {
  modelId: string
  text: string
  completionTokens: number
  promptTokens: number
  tokensPerSecond: number
  stopReason: StopReason
}

export interface InferenceFailedEvent {
  modelId: string
  error: string
  tokenCount: number
}

export interface LLMPlugin {
  loadModel(options: {
    descriptor: ModelDescriptor
    config?: LLMConfig
    priority?: SessionPriority
  }): Promise<LoadModelResult>
  unloadModel(options: { modelId: string }): Promise<void>
  listLoadedModels(): Promise<{ modelIds: string[] }>
  getModelMetadata(options: { modelId: string }): Promise<LLMModelMetadata>
  tokenize(options: { modelId: string; text: string; addSpecialTokens?: boolean }): Promise<{ tokens: number[] }>
  detokenize(options: { modelId: string; tokens: number[] }): Promise<{ text: string }>
  countTokens(options: { modelId: string; text: string }): Promise<{ count: number }>
  generate(options: {
    modelId: string
    prompt: string
    imageBase64?: string
    maxTokens?: number
    stopSequences?: string[]
    sampler?: SamplerParams
  }): Promise<GenerateResult>
  applyTemplate(options: {
    modelId: string
    messages: ChatMessage[]
    addGenerationPrompt?: boolean
  }): Promise<ApplyTemplateResult>
  generateChat(options: {
    modelId: string
    messages: ChatMessage[]
    maxTokens?: number
    stopSequences?: string[]
    sampler?: SamplerParams
  }): Promise<GenerateChatResult>
  clearHistory(options: { modelId: string }): Promise<void>
  getContextUsed(options: { modelId: string }): Promise<{ contextUsed: number }>
  streamGenerate(options: {
    modelId: string
    prompt: string
    imageBase64?: string
    maxTokens?: number
    stopSequences?: string[]
    sampler?: SamplerParams
  }): Promise<void>
  cancelGeneration(options: { modelId: string }): Promise<void>
  addListener(eventName: 'inferenceToken', handler: (event: InferenceTokenEvent) => void): Promise<PluginListenerHandle>
  addListener(
    eventName: 'inferenceComplete',
    handler: (event: InferenceCompleteEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'inferenceFailed',
    handler: (event: InferenceFailedEvent) => void,
  ): Promise<PluginListenerHandle>
  removeAllListeners(): Promise<void>
}
