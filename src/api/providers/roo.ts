import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { rooDefaultModelId, getApiProtocol, type ImageGenerationApiMethod } from "@roo-code/types"
import { CloudService } from "@roo-code/cloud"

import { NativeToolCallParser } from "../../core/assistant-message/NativeToolCallParser"

import { Package } from "../../shared/package"
import type { ApiHandlerOptions } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import { convertToOpenAiMessages } from "../transform/openai-format"
import type { RooReasoningParams } from "../transform/reasoning"
import { getRooReasoning } from "../transform/reasoning"

import type { ApiHandlerCreateMessageMetadata } from "../index"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"
import { getModels, getModelsFromCache } from "../providers/fetchers/modelCache"
import { handleOpenAIError } from "./utils/openai-error-handler"
import { generateImageWithProvider, generateImageWithImagesApi, ImageGenerationResult } from "./utils/image-generation"
import { t } from "../../i18n"

// Extend OpenAI's CompletionUsage to include Roo specific fields
interface RooUsage extends OpenAI.CompletionUsage {
	cache_creation_input_tokens?: number
	cost?: number
}

// Add custom interface for Roo params to support reasoning
type RooChatCompletionParams = OpenAI.Chat.ChatCompletionCreateParamsStreaming & {
	reasoning?: RooReasoningParams
}

function getSessionToken(): string {
	const token = CloudService.hasInstance() ? CloudService.instance.authService?.getSessionToken() : undefined
	return token ?? "unauthenticated"
}

export class RooHandler extends BaseOpenAiCompatibleProvider<string> {
	private fetcherBaseURL: string
	private currentReasoningDetails: any[] = []

	constructor(options: ApiHandlerOptions) {
		const sessionToken = options.rooApiKey ?? getSessionToken()

		let baseURL = process.env.ROO_CODE_PROVIDER_URL ?? ""

		// Ensure baseURL ends with /v1 for OpenAI client, but don't duplicate it
		if (baseURL && !baseURL.endsWith("/v1")) {
			baseURL = `${baseURL}/v1`
		}

		// Always construct the handler, even without a valid token.
		// The provider-proxy server will return 401 if authentication fails.
		super({
			...options,
			providerName: "Morse Code Cloud",
			baseURL, // Already has /v1 suffix
			apiKey: sessionToken,
			defaultProviderModelId: rooDefaultModelId,
			providerModels: {},
		})

		// Load dynamic models asynchronously - strip /v1 from baseURL for fetcher
		this.fetcherBaseURL = baseURL.endsWith("/v1") ? baseURL.slice(0, -3) : baseURL

		// Cloud features disabled — skip loading dynamic models from upstream
		// this.loadDynamicModels(this.fetcherBaseURL, sessionToken).catch((error) => {
		// 	console.error("[RooHandler] Failed to load dynamic models:", error)
		// })
	}

	protected override createStream(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
		requestOptions?: OpenAI.RequestOptions,
	) {
		// Defer the baseURL guard to the first API call so handler construction
		// (which happens during settings load) does not throw when the env var is absent.
		if (!this.fetcherBaseURL) {
			throw new Error(
				"Morse Cloud provider URL is not configured. Set ROO_CODE_PROVIDER_URL or configure the provider URL in settings.",
			)
		}

		const { id: model, info } = this.getModel()

		// Get model parameters including reasoning
		const params = getModelParams({
			format: "openai",
			modelId: model,
			model: info,
			settings: this.options,
			defaultTemperature: this.defaultTemperature,
		})

		// Get Roo-specific reasoning parameters
		const reasoning = getRooReasoning({
			model: info,
			reasoningBudget: params.reasoningBudget,
			reasoningEffort: params.reasoningEffort,
			settings: this.options,
		})

		const max_tokens = params.maxTokens ?? undefined
		const temperature = params.temperature ?? this.defaultTemperature

		const rooParams: RooChatCompletionParams = {
			model,
			max_tokens,
			temperature,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
			...(reasoning && { reasoning }),
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
		}

		try {
			this.client.apiKey = this.options.rooApiKey ?? getSessionToken()
			return this.client.chat.completions.create(rooParams, requestOptions)
		} catch (error) {
			throw handleOpenAIError(error, this.providerName)
		}
	}

	getReasoningDetails(): any[] | undefined {
		return this.currentReasoningDetails.length > 0 ? this.currentReasoningDetails : undefined
	}

	// eslint-disable-next-line require-yield
	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Cloud features disabled — Morse Code provider is not available in this fork
		throw new Error("Morse Code provider is not available in this fork. Cloud features have been disabled.")
	}

	override async completePrompt(prompt: string): Promise<string> {
		throw new Error("Morse Code provider is not available in this fork. Cloud features have been disabled.")
	}

	private async loadDynamicModels(baseURL: string, apiKey?: string): Promise<void> {
		try {
			// Fetch models and cache them in the shared cache
			await getModels({
				provider: "roo",
				baseUrl: baseURL,
				apiKey,
			})
		} catch (error) {
			// Enhanced error logging with more context
			console.error("[RooHandler] Error loading dynamic models:", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				baseURL,
				hasApiKey: Boolean(apiKey),
			})
		}
	}

	override getModel() {
		const modelId = this.options.apiModelId || rooDefaultModelId

		// Get models from shared cache (settings are already applied by the fetcher)
		const models = getModelsFromCache("roo") || {}
		const modelInfo = models[modelId]

		if (modelInfo) {
			return { id: modelId, info: modelInfo }
		}

		// Return the requested model ID even if not found, with fallback info.
		const fallbackInfo = {
			maxTokens: 16_384,
			contextWindow: 262_144,
			supportsImages: false,
			supportsReasoningEffort: false,
			supportsPromptCache: true,
			inputPrice: 0,
			outputPrice: 0,
			isFree: false,
		}

		return {
			id: modelId,
			info: fallbackInfo,
		}
	}

	/**
	 * Generate an image using Morse Code Cloud's image generation API
	 * @param prompt The text prompt for image generation
	 * @param model The model to use for generation
	 * @param inputImage Optional base64 encoded input image data URL
	 * @param apiMethod The API method to use (chat_completions or images_api)
	 * @returns The generated image data and format, or an error
	 */
	async generateImage(
		prompt: string,
		model: string,
		inputImage?: string,
		apiMethod?: ImageGenerationApiMethod,
	): Promise<ImageGenerationResult> {
		return {
			success: false,
			error: "Morse Code provider is not available in this fork. Cloud features have been disabled.",
		}
	}
}
