import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { AppProvider } from '../src/application/app-context';
import { SpeechRuntimeProvider } from '../src/application/speech-runtime-context';
import { defineParseBackgroundTask } from '../src/infrastructure/jobs/background-parse-task';
import { colors } from '../src/ui/tokens';

// TaskManager requires defineTask at load time before OS may invoke the worker.
defineParseBackgroundTask();

/**
 * Root: native stack. Primary tabs live under (tabs); secondary routes are stack screens.
 */
export default function RootLayout() {
  return (
    <AppProvider>
      <SpeechRuntimeProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.ink,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.background },
            // Prevent Expo Router group name "(tabs)" from becoming the iOS back title.
            headerBackTitle: '返回',
            headerBackButtonDisplayMode: 'minimal',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: '返回' }} />
          <Stack.Screen name="confirm/[id]" options={{ title: '确认这次整理' }} />
          <Stack.Screen name="record/[id]" options={{ title: '记录详情' }} />
          <Stack.Screen name="withdrawn" options={{ title: '已撤销账单' }} />
          <Stack.Screen name="modes/index" options={{ title: '模式' }} />
          <Stack.Screen name="modes/edit" options={{ title: '编辑模式' }} />
          <Stack.Screen name="tags/index" options={{ title: '标签' }} />
          <Stack.Screen name="stats/breakdown" options={{ title: '消费占比' }} />
          <Stack.Screen name="stats/trend" options={{ title: '消费趋势' }} />
          <Stack.Screen name="stats/drilldown" options={{ title: '这些记录' }} />
          <Stack.Screen name="export" options={{ title: '导出 Excel' }} />
          <Stack.Screen name="ai-provider" options={{ title: '智能整理' }} />
          <Stack.Screen name="managed-ai-pilot" options={{ title: '托管 AI 内测' }} />
          <Stack.Screen name="support-author" options={{ title: '支持作者' }} />
        </Stack>
      </SpeechRuntimeProvider>
    </AppProvider>
  );
}
