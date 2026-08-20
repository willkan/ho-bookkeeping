import type { TagType } from '@bookkeeping/contracts';

export const TAG_TYPE_OPTIONS: readonly { value: TagType; label: string }[] = [
  { value: 'category', label: '类目' },
  { value: 'other', label: '其他' },
];

export function tagTypeLabel(type: TagType): string {
  return TAG_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}
