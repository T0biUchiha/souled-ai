export type TelemetryEvent =
  | { name: 'route_viewed'; path: string }
  | { name: 'domain_operation_failed'; operation: string; code: string };

export interface TelemetryClient {
  track(event: TelemetryEvent): void;
}

export const telemetry: TelemetryClient = {
  track: () => undefined,
};
