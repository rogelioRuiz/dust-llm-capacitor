import type { PluginListenerHandle } from '@capacitor/core'
import { registerPlugin, WebPlugin } from '@capacitor/core'

import type {
  ApplyTemplateResult,
  GenerateChatResult,
  GenerateResult,
  InferenceCompleteEvent,
  InferenceFailedEvent,
  InferenceTokenEvent,
  LLMModelMetadata,
  LLMPlugin,
  LoadModelResult,
} from './definitions'

class LLMWeb extends WebPlugin implements LLMPlugin {
  async loadModel(_options: { descriptor: unknown; config?: unknown; priority?: unknown }): Promise<LoadModelResult> {
    throw this.unimplemented('loadModel is not supported on web')
  }

  async unloadModel(_options: { modelId: string }): Promise<void> {
    throw this.unimplemented('unloadModel is not supported on web')
  }

  async listLoadedModels(): Promise<{ modelIds: string[] }> {
    throw this.unimplemented('listLoadedModels is not supported on web')
  }

  async getModelMetadata(_options: { modelId: string }): Promise<LLMModelMetadata> {
    throw this.unimplemented('getModelMetadata is not supported on web')
  }

  async tokenize(_options: {
    modelId: string
    text: string
    addSpecialTokens?: boolean
  }): Promise<{ tokens: number[] }> {
    throw this.unimplemented('tokenize is not supported on web')
  }

  async detokenize(_options: { modelId: string; tokens: number[] }): Promise<{ text: string }> {
    throw this.unimplemented('detokenize is not supported on web')
  }

  async countTokens(_options: { modelId: string; text: string }): Promise<{ count: number }> {
    throw this.unimplemented('countTokens is not supported on web')
  }

  async generate(_options: {
    modelId: string
    prompt: string
    imageBase64?: string
    maxTokens?: number
    stopSequences?: string[]
    sampler?: unknown
  }): Promise<GenerateResult> {
    throw this.unimplemented('generate is not supported on web')
  }

  async applyTemplate(_options: {
    modelId: string
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    addGenerationPrompt?: boolean
  }): Promise<ApplyTemplateResult> {
    throw this.unimplemented('applyTemplate is not supported on web')
  }

  async generateChat(_options: {
    modelId: string
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
    maxTokens?: number
    stopSequences?: string[]
    sampler?: unknown
  }): Promise<GenerateChatResult> {
    throw this.unimplemented('generateChat is not supported on web')
  }

  async clearHistory(_options: { modelId: string }): Promise<void> {
    throw this.unimplemented('clearHistory is not supported on web')
  }

  async getContextUsed(_options: { modelId: string }): Promise<{ contextUsed: number }> {
    throw this.unimplemented('getContextUsed is not supported on web')
  }

  async streamGenerate(_options: {
    modelId: string
    prompt: string
    imageBase64?: string
    maxTokens?: number
    stopSequences?: string[]
    sampler?: unknown
  }): Promise<void> {
    throw this.unimplemented('streamGenerate is not supported on web')
  }

  async cancelGeneration(_options: { modelId: string }): Promise<void> {
    throw this.unimplemented('cancelGeneration is not supported on web')
  }

  async addListener(
    eventName: 'inferenceToken',
    handler: (event: InferenceTokenEvent) => void,
  ): Promise<PluginListenerHandle>
  async addListener(
    eventName: 'inferenceComplete',
    handler: (event: InferenceCompleteEvent) => void,
  ): Promise<PluginListenerHandle>
  async addListener(
    eventName: 'inferenceFailed',
    handler: (event: InferenceFailedEvent) => void,
  ): Promise<PluginListenerHandle>
  async addListener(eventName: string, handler: (event: any) => void): Promise<PluginListenerHandle> {
    return super.addListener(eventName, handler)
  }

  async removeAllListeners(): Promise<void> {
    return super.removeAllListeners()
  }
}

export const LLM = registerPlugin<LLMPlugin>('LLM', {
  web: () => Promise.resolve(new LLMWeb()),
})
