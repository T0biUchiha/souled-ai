export type KnownTelemetryEvent =
  | { name: 'route_viewed'; path: string }
  | { name: 'domain_operation_failed'; operation: string; code: string };

/** The runtime telemetry client lives in client.ts; this file only describes known event shapes. */
export { telemetry, type TelemetryClient, type TelemetryEvent } from './client';
