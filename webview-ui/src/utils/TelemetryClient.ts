import type { TelemetrySetting } from "@roo-code/types"

class TelemetryClient {
	private static instance: TelemetryClient
	private static telemetryEnabled: boolean = false

	public updateTelemetryState(_telemetrySetting: TelemetrySetting, _apiKey?: string, _distinctId?: string) {
		// No-op: telemetry disabled
	}

	public static getInstance(): TelemetryClient {
		if (!TelemetryClient.instance) {
			TelemetryClient.instance = new TelemetryClient()
		}

		return TelemetryClient.instance
	}

	public capture(_eventName: string, _properties?: Record<string, any>) {
		// No-op: telemetry disabled
	}
}

export const telemetryClient = TelemetryClient.getInstance()
