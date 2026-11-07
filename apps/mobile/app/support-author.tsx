import React, { useMemo } from 'react';
import { ManagedPilotFeedbackClient } from '../src/infrastructure/ai/managed-pilot-feedback';
import { getFeedbackCredential } from '../src/infrastructure/ai/secure-feedback';
import { ExpoCryptoIdGenerator } from '../src/infrastructure/ids/expo-crypto-id-generator';
import { SupportAuthorScreen } from '../src/ui/support-author-screen';

const ids = new ExpoCryptoIdGenerator();

export default function SupportAuthorRoute() {
  const feedback = useMemo(
    () => new ManagedPilotFeedbackClient(getFeedbackCredential, () => ids.createId('feedback')),
    [],
  );
  return <SupportAuthorScreen feedback={feedback} />;
}
