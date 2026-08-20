export type PilotErrorCategory =
  | 'invalid_request'
  | 'unauthorized'
  | 'invite_unavailable'
  | 'entitlement_unavailable'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'concurrency_limited'
  | 'already_processed'
  | 'replay_detected'
  | 'provider_error'
  | 'model_output_invalid'
  | 'timeout';

export class PilotError extends Error {
  constructor(
    readonly category: PilotErrorCategory,
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}
