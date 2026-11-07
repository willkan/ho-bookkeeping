export type WeChatCsvRecord = {
  localDate: string;
  occurredAt: string;
  category: string;
  amountMinor: number;
  note: string | null;
  sourceText: string;
};

function cells(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (quoted || value === '') {
        quoted = !quoted;
      } else {
        throw new Error('CSV 引号格式错误');
      }
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(value);
      if (row.some((part) => part !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  row.push(value);
  if (row.some((part) => part !== '')) rows.push(row);
  return rows;
}

const HEADER = ['日期', '时间', '收支', '分类', '金额(元)', '备注'];

export function parseWeChatCsv(input: string): WeChatCsvRecord[] {
  const rows = cells(input.replace(/^\uFEFF/, ''));
  if (
    !rows[0] ||
    rows[0].length !== HEADER.length ||
    rows[0].some((value, i) => value !== HEADER[i])
  ) {
    throw new Error('请选择微信记账本已分类明细 CSV');
  }
  if (rows.length === 1) throw new Error('文件中没有账单记录');
  return rows.slice(1).map((row, index) => {
    const line = index + 2;
    if (row.length !== 6) throw new Error(`第 ${line} 行字段数量错误`);
    const [date, time, direction, categoryValue, amount, noteValue] = row as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const category = categoryValue.trim();
    if (direction !== '支出' || !category || !/^-\d+\.\d{2}$/.test(amount)) {
      throw new Error(`第 ${line} 行需为已分类支出和两位小数金额`);
    }
    const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const timeParts = /^(\d{2}):(\d{2})$/.exec(time);
    if (!dateParts || !timeParts) throw new Error(`第 ${line} 行日期或时间无效`);
    const year = Number(dateParts[1]);
    const month = Number(dateParts[2]);
    const day = Number(dateParts[3]);
    const hour = Number(timeParts[1]);
    const minute = Number(timeParts[2]);
    const check = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (
      year < 2000 ||
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day ||
      check.getUTCHours() !== hour ||
      check.getUTCMinutes() !== minute
    ) {
      throw new Error(`第 ${line} 行日期或时间无效`);
    }
    const [yuan, fen] = amount.slice(1).split('.').map(Number) as [number, number];
    const amountMinor = yuan * 100 + fen;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new Error(`第 ${line} 行金额无效`);
    }
    return {
      localDate: date,
      occurredAt: new Date(check.getTime() - 8 * 60 * 60 * 1000).toISOString(),
      category,
      amountMinor,
      note: noteValue || null,
      sourceText: `微信记账本 CSV｜${date} ${time}｜${direction}｜${category}｜${amount}｜${noteValue}`,
    };
  });
}
