import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { useApp } from '../src/application/app-context';
import { ManagedPilotFeedbackClient } from '../src/infrastructure/ai/managed-pilot-feedback';
import { ExpoCryptoIdGenerator } from '../src/infrastructure/ids/expo-crypto-id-generator';
import { SupportAuthorScreen } from '../src/ui/support-author-screen';

const ids = new ExpoCryptoIdGenerator();

export default function SupportAuthorRoute() {
  const router = useRouter();
  const { managedPilotStore, managedPilotPublic } = useApp();
  const feedback = useMemo(
    () =>
      managedPilotStore
        ? new ManagedPilotFeedbackClient(managedPilotStore, () => ids.createId('feedback'))
        : null,
    [managedPilotStore],
  );
  return (
    <SupportAuthorScreen
      feedback={feedback}
      active={managedPilotPublic?.accessTokenCurrent === true}
      onActivate={() => router.push('/managed-ai-pilot')}
    />
  );
}
