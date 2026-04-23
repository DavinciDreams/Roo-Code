import {
	type TelemetryClient,
	type TelemetryEvent,
	type ClineMessage,
	type AuthService,
	type SettingsService,
	TelemetryEventName,
	TelemetryEventSubscription,
} from "@roo-code/types"

abstract class BaseTelemetryClient implements TelemetryClient {
	protected providerRef: WeakRef<any> | null = null
	protected telemetryEnabled: boolean = false

	constructor(
		public readonly subscription?: TelemetryEventSubscription,
		protected readonly debug = false,
	) {}

	protected isEventCapturable(eventName: TelemetryEventName): boolean {
		if (!this.subscription) {
			return true
		}

		return this.subscription.type === "include"
			? this.subscription.events.includes(eventName)
			: !this.subscription.events.includes(eventName)
	}

	/**
	 * Determines if a specific property should be included in telemetry events
	 * Override in subclasses to filter specific properties
	 */
	protected isPropertyCapturable(_propertyName: string): boolean {
		return true
	}

	protected async getEventProperties(event: TelemetryEvent): Promise<TelemetryEvent["properties"]> {
		let providerProperties: TelemetryEvent["properties"] = {}
		const provider = this.providerRef?.deref()

		if (provider) {
			try {
				// Get properties from the provider
				providerProperties = await provider.getTelemetryProperties()
			} catch (error) {
				// Log error but continue with capturing the event.
				console.error(
					`Error getting telemetry properties: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}

		// Merge provider properties with event-specific properties.
		// Event properties take precedence in case of conflicts.
		const mergedProperties = {
			...providerProperties,
			...(event.properties || {}),
		}

		// Filter out properties that shouldn't be captured by this client
		return Object.fromEntries(Object.entries(mergedProperties).filter(([key]) => this.isPropertyCapturable(key)))
	}

	public abstract capture(event: TelemetryEvent): Promise<void>

	public async captureException(_error: Error, _additionalProperties?: Record<string, unknown>): Promise<void> {}

	public setProvider(provider: any): void {
		this.providerRef = new WeakRef(provider)
	}

	public abstract updateTelemetryState(didUserOptIn: boolean): void

	public isTelemetryEnabled(): boolean {
		return this.telemetryEnabled
	}

	public abstract shutdown(): Promise<void>
}

export class CloudTelemetryClient extends BaseTelemetryClient {
	constructor(_authService: AuthService, _settingsService: SettingsService) {
		super({
			type: "exclude",
			events: [TelemetryEventName.TASK_CONVERSATION_MESSAGE],
		})
	}

	public override async capture(_event: TelemetryEvent): Promise<void> {
		// No-op: telemetry disabled
	}

	public async backfillMessages(_messages: ClineMessage[], _taskId: string): Promise<void> {
		// No-op: telemetry disabled
	}

	public override updateTelemetryState(_didUserOptIn: boolean): void {
		// No-op: telemetry disabled
	}

	public override isTelemetryEnabled(): boolean {
		return false
	}

	public override async shutdown(): Promise<void> {
		// No-op: telemetry disabled
	}
}
