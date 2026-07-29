import type { TagType } from '@bookkeeping/contracts';

export const TAG_TYPE_OPTIONS: readonly { value: TagType; label: string }[] = [
  { value: 'category', label: '类目' },
  { value: 'trip', label: '行程' },
  { value: 'place', label: '地点' },
  { value: 'merchant', label: '商户' },
  { value: 'channel', label: '渠道' },
  { value: 'person', label: '人物' },
  { value: 'purpose', label: '用途' },
  { value: 'other', label: '其他' },
];

export function tagTypeLabel(type: TagType): string {
  return TAG_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}
