import { Tabs } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import { colors } from '../../src/ui/tokens';

function TabIcon({ glyph, focused }: { glyph: string; focused: boolean }) {
  return (
    <Text style={{ color: focused ? colors.accent : colors.muted, fontSize: 16 }}>{glyph}</Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '记录',
          tabBarIcon: ({ focused }) => <TabIcon glyph="✎" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="ledger"
        options={{
          title: '账单',
          tabBarIcon: ({ focused }) => <TabIcon glyph="☰" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '设置',
          tabBarIcon: ({ focused }) => <TabIcon glyph="⚙" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
