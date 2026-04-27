import { type TelemetryEvent, TelemetryEventName } from "@roo-code/types"

import { BaseTelemetryClient } from "./BaseTelemetryClient"

/**
 * PostHogTelemetryClient handles telemetry event tracking for the Roo Code extension.
 * All methods are no-ops — telemetry has been disabled in this fork.
 */
export class PostHogTelemetryClient extends BaseTelemetryClient {
	// Git repository properties that should be filtered out
	private readonly gitPropertyNames = ["repositoryUrl", "repositoryName", "defaultBranch"]

	constructor(_debug = false) {
		super(
			{
				type: "exclude",
				events: [TelemetryEventName.TASK_MESSAGE, TelemetryEventName.LLM_COMPLETION],
			},
			_debug,
		)
	}

	/**
	 * Filter out git repository properties for PostHog telemetry
	 * @param propertyName The property name to check
	 * @returns Whether the property should be included in telemetry events
	 */
	protected override isPropertyCapturable(propertyName: string): boolean {
		if (this.gitPropertyNames.includes(propertyName)) {
			return false
		}
		return true
	}

	public override async capture(_event: TelemetryEvent): Promise<void> {
		// No-op: telemetry disabled
	}

	public override async captureException(
		_error: Error,
		_additionalProperties?: Record<string, unknown>,
	): Promise<void> {
		// No-op: telemetry disabled
	}

	public override updateTelemetryState(_didUserOptIn: boolean): void {
		// No-op: telemetry disabled
	}

	public override async shutdown(): Promise<void> {
		// No-op: telemetry disabled
	}
}
