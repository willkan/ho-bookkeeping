export const PILOT_WILLINGNESS = ['willing', 'unsure', 'not_willing'] as const;
export type PilotWillingness = (typeof PILOT_WILLINGNESS)[number];

export type PilotFeedback = {
  willingness: PilotWillingness | null;
  updatedAt: string | null;
};

export interface PilotFeedbackPort {
  load(): Promise<PilotFeedback>;
  save(willingness: PilotWillingness): Promise<PilotFeedback>;
}
