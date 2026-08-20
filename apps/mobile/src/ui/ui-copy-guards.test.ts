import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_ROOT = join(__dirname, '../..');

describe('UI product-copy guards', () => {
  it('routes withdrawn bills to a separate restorable archive screen', () => {
    const ledger = readFileSync(join(APP_ROOT, 'app/(tabs)/ledger.tsx'), 'utf8');
    const archive = readFileSync(join(APP_ROOT, 'app/withdrawn.tsx'), 'utf8');
    const layout = readFileSync(join(APP_ROOT, 'app/_layout.tsx'), 'utf8');
    const feed = readFileSync(join(APP_ROOT, 'src/ui/ledger-feed.tsx'), 'utf8');
    expect(ledger).toContain("router.push('/withdrawn' as Href)");
    expect(ledger).toContain('查看已撤销账单');
    expect(archive).toContain('service?.listWithdrawnLedger()');
    expect(archive).toContain('service.restoreConsumption(id)');
    expect(archive).toContain('没有已撤销账单');
    expect(layout).toContain('name="withdrawn"');
    expect(feed).not.toContain('WithdrawnRow');
    expect(feed).not.toContain("case 'withdrawn'");
  });

  it('ledger keyword search keeps existing record open and long-press delete actions', () => {
    const route = readFileSync(join(APP_ROOT, 'app/(tabs)/ledger.tsx'), 'utf8');
    const feed = readFileSync(join(APP_ROOT, 'src/ui/ledger-feed.tsx'), 'utf8');
    expect(route).toContain('service.searchLedger(deferredKeyword)');
    expect(route).toContain('placeholder="搜索商户、商品、原文或标签"');
    expect(route).toContain('没有找到相关账单');
    expect(route).toContain('长按可撤销');
    expect(feed).toContain('onPress={() => onOpen(record.id)}');
    expect(feed).toContain('onLongPress={() => onDelete(record.id)}');
    expect(feed).toContain("name: 'delete', label: '撤销账单'");
  });

  it('failed raw inputs show their reason and offer confirmed soft deletion', () => {
    const route = readFileSync(join(APP_ROOT, 'app/(tabs)/ledger.tsx'), 'utf8');
    const feed = readFileSync(join(APP_ROOT, 'src/ui/ledger-feed.tsx'), 'utf8');
    expect(feed).toContain('raw.parseErrorMessage');
    expect(route).toContain("text: '删除原文'");
    expect(route).toContain("'删除这条失败原文？'");
    expect(route).toContain('service.softDeleteFailedRawInput(rawInputId)');
  });

  it('record submit uses a non-blocking acknowledgement and never awaits queue execution', () => {
    const src = readFileSync(join(APP_ROOT, 'app/(tabs)/index.tsx'), 'utf8');
    expect(src).toContain('已保存，正在整理');
    expect(src).toContain('void refresh()');
    expect(src).not.toContain("Alert.alert('已记下'");
    expect(src).not.toContain('await refresh()');
  });

  it('record editor exposes only checkout amounts and not coupon implementation fields', () => {
    const src = readFileSync(join(APP_ROOT, 'app/record/[id].tsx'), 'utf8');
    expect(src).toContain('优惠券抵扣（元）');
    expect(src).not.toMatch(/券ID|券成本|券面值|支付构成/);
    expect(src).not.toContain('支付构成 JSON');
    expect(src).not.toContain('发生时间 ISO');
    expect(src).not.toContain('label="时区"');
  });

  it('record detail preserves direction internally without exposing it as a user field', () => {
    const src = readFileSync(join(APP_ROOT, 'app/record/[id].tsx'), 'utf8');
    expect(src).toContain('direction: record.direction');
    expect(src).not.toContain('directionLabel');
    expect(src).not.toContain('setDirection');
    expect(src).not.toContain('>方向</Text>');
    expect(src).not.toContain('<Row label="类型"');
  });

  it('ledger rows prefer the meaningful note when the merchant is empty', () => {
    const src = readFileSync(join(APP_ROOT, 'src/ui/ledger-feed.tsx'), 'utf8');
    expect(src).toContain('const title = consumptionRecordTitle(record)');
    expect(src).toContain('accessibilityLabel={`记录 ${title}`}');
  });

  it('saving provider settings never waits for queued AI work', () => {
    const src = readFileSync(join(APP_ROOT, 'src/application/app-context.tsx'), 'utf8');
    const reloadBlock = src.slice(
      src.indexOf('const reloadProviderConfig'),
      src.indexOf('const value = useMemo'),
    );
    expect(reloadBlock).toContain('void runner.resume()');
    expect(reloadBlock).not.toContain('await runnerRef.current.resume()');
  });

  it('tag creation lets the user choose a typed dimension', () => {
    const tags = readFileSync(join(APP_ROOT, 'app/tags/index.tsx'), 'utf8');
    const modes = readFileSync(join(APP_ROOT, 'app/modes/edit.tsx'), 'utf8');
    const tagTypes = readFileSync(join(APP_ROOT, 'src/ui/tag-types.ts'), 'utf8');
    expect(tags).toContain('TAG_TYPE_OPTIONS');
    expect(tags).toContain('service.createTag(newType');
    expect(modes).toContain('直接新建默认标签');
    expect(modes).toContain('service.createTag(newTagType');
    expect(tagTypes).toContain("value: 'category'");
    expect(tagTypes).toContain("value: 'other'");
    expect(tagTypes).not.toMatch(/value: '(trip|place|merchant|channel|person|purpose)'/);
  });

  it('statistics uses a pie chart and readable scrollable trend buckets', () => {
    const breakdown = readFileSync(join(APP_ROOT, 'app/stats/breakdown.tsx'), 'utf8');
    const trend = readFileSync(join(APP_ROOT, 'app/stats/trend.tsx'), 'utf8');
    const charts = readFileSync(join(APP_ROOT, 'src/ui/statistics-charts.tsx'), 'utf8');
    expect(breakdown).toContain('<ConsumptionPieChart');
    expect(breakdown).not.toContain('barTrack');
    expect(trend).toContain('<TrendBarChart');
    expect(charts).toContain('<ScrollView');
    expect(charts).toContain('horizontal');
    expect(charts).toContain('width: 58');
    expect(charts).not.toContain("flex: 1,\n    alignItems: 'center'");
  });

  it('statistics charts drill into records and record rows retain meaningful context', () => {
    const breakdown = readFileSync(join(APP_ROOT, 'app/stats/breakdown.tsx'), 'utf8');
    const trend = readFileSync(join(APP_ROOT, 'app/stats/trend.tsx'), 'utf8');
    const drilldown = readFileSync(join(APP_ROOT, 'app/stats/drilldown.tsx'), 'utf8');
    const charts = readFileSync(join(APP_ROOT, 'src/ui/statistics-charts.tsx'), 'utf8');
    expect(breakdown).toContain('onBucketPress={openBucket}');
    expect(trend).toContain('onBucketPress={openBucket}');
    expect(charts).toContain('onPress={() => onBucketPress?.(bucket)}');
    expect(drilldown).toContain('service.trendRecords(');
    expect(drilldown).toContain('consumptionRecordTitle(');
    expect(drilldown).toContain('service.getRawInput(item.rawInputId)?.rawText');
  });

  it('mode default-tag creation uses an accessible add icon instead of a text primary button', () => {
    const modes = readFileSync(join(APP_ROOT, 'app/modes/edit.tsx'), 'utf8');
    expect(modes).toContain('<Ionicons name="add"');
    expect(modes).toContain('accessibilityLabel="添加默认标签"');
    expect(modes).not.toContain('label="添加"');
  });

  // Positive: secondary stack screens never expose Expo group name as iOS back title
  it('root stack prevents (tabs) as header back title', () => {
    const src = readFileSync(join(APP_ROOT, 'app/_layout.tsx'), 'utf8');
    expect(src).toMatch(/headerBackTitle:\s*['"]返回['"]/);
    expect(src).toMatch(/headerBackButtonDisplayMode:\s*['"]minimal['"]/);
    expect(src).toMatch(/name="\(tabs\)"[\s\S]*title:\s*['"]返回['"]/);
  });

  // Negative: implementation diagnostics do not belong in ordinary settings
  it('settings does not expose storage or scheduling implementation language', () => {
    const src = readFileSync(join(APP_ROOT, 'app/(tabs)/settings.tsx'), 'utf8');
    expect(src).toContain('账本只保存在这台设备');
    expect(src).not.toMatch(/SQLite|正式队列|后台调度|configRevision|providerHost/);
  });

  it('settings exposes anonymous payment willingness without presenting a payment flow', () => {
    const settings = readFileSync(join(APP_ROOT, 'app/(tabs)/settings.tsx'), 'utf8');
    const support = readFileSync(join(APP_ROOT, 'src/ui/support-author-screen.tsx'), 'utf8');
    expect(settings).toContain('支持作者 · 付费意愿');
    expect(settings).toContain("router.push('/support-author')");
    expect(support).toContain('愿意为正式版付费');
    expect(support).toContain('还不确定');
    expect(support).toContain('暂不愿意');
    expect(support).toContain('这不是付款，也不会产生扣费');
    expect(support).toContain('不占用 AI 解析额度');
    expect(support).not.toMatch(/支付金额|信用卡|支付宝|微信支付|内购/);
  });

  it('ledger offers an explicit mode scope and never passes mode into trend', () => {
    const src = readFileSync(join(APP_ROOT, 'app/(tabs)/ledger.tsx'), 'utf8');
    expect(src).toContain('label="按模式"');
    expect(src).toContain('默认查看这个模式的全部时间');
    const trendPush = src.slice(
      src.indexOf("pathname: '/stats/trend'"),
      src.indexOf('return;', src.indexOf("pathname: '/stats/trend'")),
    );
    expect(trendPush).not.toContain('modeId');
  });

  it('confirmation uses user-facing fields instead of raw transport fields', () => {
    const src = readFileSync(join(APP_ROOT, 'app/confirm/[id].tsx'), 'utf8');
    expect(src).toContain('整理出 {rows.length} 笔记录，请确认');
    expect(src).toContain('label="本次实付（元）"');
    expect(src).not.toMatch(/支付构成 JSON|标签 JSON|优惠券购买 JSON|发生时间 ISO|label="时区"/);
    expect(src).not.toContain('expense|income|transfer');
  });

  it('ledger exposes confirmed long-press withdrawal without a persistent icon', () => {
    const route = readFileSync(join(APP_ROOT, 'app/(tabs)/ledger.tsx'), 'utf8');
    const feed = readFileSync(join(APP_ROOT, 'src/ui/ledger-feed.tsx'), 'utf8');
    expect(feed).toContain('onLongPress');
    expect(feed).toContain("name: 'delete', label: '撤销账单'");
    expect(feed).not.toContain('name="trash-outline"');
    expect(feed).not.toContain('name="ellipsis-horizontal"');
    expect(route).toContain("Alert.alert('撤销这条账单？'");
    expect(route).toContain("text: '确认撤销'");
    expect(route).toContain('service.softDeleteConsumption');
  });

  it('uses one global ledger route instead of a separate today ledger', () => {
    const tabs = readFileSync(join(APP_ROOT, 'app/(tabs)/_layout.tsx'), 'utf8');
    const recordHome = readFileSync(join(APP_ROOT, 'app/(tabs)/index.tsx'), 'utf8');
    expect(tabs).toContain("title: '账单'");
    expect(tabs).toContain('android_ripple={null}');
    expect(recordHome).toContain("router.push('/ledger')");
    expect(existsSync(join(APP_ROOT, 'app/today.tsx'))).toBe(false);
  });

  it('tag management exposes merge-safe deletion rather than hiding a hard delete', () => {
    const src = readFileSync(join(APP_ROOT, 'app/tags/index.tsx'), 'utf8');
    expect(src).toContain('service.deleteTag(tag.id)');
    expect(src).toContain('name="trash-outline"');
    expect(src).toMatch(/Alert\.alert\(\s*['"]无法删除['"]/);
  });

  // Negative: record home must not ship development money format placeholder
  it('record home has no development amount placeholder', () => {
    const src = readFileSync(join(APP_ROOT, 'app/(tabs)/index.tsx'), 'utf8');
    expect(src.includes('金额示例')).toBe(false);
    expect(src.includes('formatYuan(10000)')).toBe(false);
    expect(src.includes('仅展示格式')).toBe(false);
  });

  // Positive: voice disclosure explains file-free, device-only streaming recognition
  it('voice session ships Chinese streaming disclosure', () => {
    const src = readFileSync(join(APP_ROOT, 'src/application/voice-session.ts'), 'utf8');
    expect(src).toMatch(/语音在本机识别，不会保存录音/);
    expect(src).toMatch(/正在听，松开结束/);
    expect(src).toMatch(/按住说话/);
    expect(src).toMatch(/权限已开启，请再按住说话/);
    expect(src).toMatch(/正在完成识别/);
    expect(src).toMatch(/没有识别到语音/);
    expect(src).toMatch(/未获得麦克风权限/);
  });

  it('record home binds hold/release gestures and preserves a screen-reader toggle', () => {
    const src = readFileSync(join(APP_ROOT, 'app/(tabs)/index.tsx'), 'utf8');

    expect(src).toContain('screenReaderEnabled ? onAccessibleMicPress : undefined');
    expect(src).toContain('onPressIn={screenReaderEnabled ? undefined : onMicPress}');
    expect(src).toContain('onPressOut={screenReaderEnabled ? undefined : onMicRelease}');
    expect(src).toContain("speechModel.state.phase !== 'ready'");
    expect(src).toContain('<SpeechModelDownloadModal');
    expect(src).not.toContain('onPress={voice.toggleMic}');
  });

  it('record home integrates one borderless hold-to-talk action inside the input composer', () => {
    const src = readFileSync(join(APP_ROOT, 'app/(tabs)/index.tsx'), 'utf8');

    expect(src).toContain('styles.composer');
    expect(src).toContain('styles.micButtonLabel');
    expect(src).toContain("'正在听，松开结束'");
    expect(src).toContain("'按住说话'");
    expect(src).toContain('borderTopWidth: StyleSheet.hairlineWidth');
    expect(src).not.toContain('borderWidth: 1');
    expect(src).not.toContain('styles.inputRow');
    expect(src).not.toContain('立刻保存在本机，整理在后台完成');
  });
});
