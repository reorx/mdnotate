import { describe, expect, it } from 'vitest';
import { convertBoxTables } from '../src/lib/box-table';

// A faithful excerpt of tmp/claude-output.md: Claude CLI output saved as .md,
// with a Unicode box-drawing table indented by two spaces and a separator
// between every row.
const claudeCliTable = [
  '  一、现状盘点：我们有什么、各自防的是什么',
  '',
  '  ┌───────────────┬───────────────────────────────────┬────────────────────────┬──────────────────────┐',
  '  │      层       │               现状                │       防的是什么       │         盲区         │',
  '  ├───────────────┼───────────────────────────────────┼────────────────────────┼──────────────────────┤',
  '  │ 配置可复现    │ Ansible SSOT                      │ 机器丢了重建不出来     │ 不管运行时           │',
  '  ├───────────────┼───────────────────────────────────┼────────────────────────┼──────────────────────┤',
  '  │ 指标/日志告警 │ vmalert + Alertmanager → Telegram │ 错误率、资源、节点离线 │ 见下面两个结构性盲区 │',
  '  └───────────────┴───────────────────────────────────┴────────────────────────┴──────────────────────┘',
  '',
  '  现有的告警链路有两个结构性盲区。',
].join('\n');

describe('convertBoxTables', () => {
  it('converts a Unicode box-drawing table (Claude CLI style) into a GFM pipe table', () => {
    const out = convertBoxTables(claudeCliTable);
    const lines = out.split('\n');
    expect(lines).toContain('  | 层 | 现状 | 防的是什么 | 盲区 |');
    expect(lines).toContain('  | --- | --- | --- | --- |');
    expect(lines).toContain('  | 配置可复现 | Ansible SSOT | 机器丢了重建不出来 | 不管运行时 |');
    expect(lines).toContain(
      '  | 指标/日志告警 | vmalert + Alertmanager → Telegram | 错误率、资源、节点离线 | 见下面两个结构性盲区 |',
    );
    // The box drawing is gone, the surrounding prose is not.
    expect(out).not.toMatch(/[┌┬┐├┼┤└┴┘─│]/);
    expect(out).toContain('一、现状盘点：我们有什么、各自防的是什么');
    expect(out).toContain('现有的告警链路有两个结构性盲区。');
  });

  it('keeps data rows in document order', () => {
    const out = convertBoxTables(claudeCliTable);
    expect(out.indexOf('配置可复现')).toBeLessThan(out.indexOf('指标/日志告警'));
  });

  it('converts an ASCII +---+ table with one header separator, one row per line (MySQL style)', () => {
    const input = [
      '+----+-------+',
      '| id | name  |',
      '+----+-------+',
      '| 1  | alice |',
      '| 2  | bob   |',
      '+----+-------+',
    ].join('\n');
    const lines = convertBoxTables(input).split('\n');
    expect(lines).toContain('| id | name |');
    expect(lines).toContain('| --- | --- |');
    expect(lines).toContain('| 1 | alice |');
    expect(lines).toContain('| 2 | bob |');
  });

  it('merges wrapped cell lines within a row when separators divide every row', () => {
    const input = [
      '┌─────┬─────────┐',
      '│ key │ value   │',
      '├─────┼─────────┤',
      '│ a   │ first   │',
      '│     │ second  │',
      '├─────┼─────────┤',
      '│ b   │ third   │',
      '└─────┴─────────┘',
    ].join('\n');
    const lines = convertBoxTables(input).split('\n');
    expect(lines).toContain('| a | first second |');
    expect(lines).toContain('| b | third |');
  });

  it('returns prose without tables unchanged', () => {
    const input = '# Title\n\nSome paragraph with │ a stray bar and a ┌ corner.\n\n- list item\n';
    expect(convertBoxTables(input)).toBe(input);
  });

  it('leaves an existing GFM pipe table alone', () => {
    const input = '| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    expect(convertBoxTables(input)).toBe(input);
  });

  it('leaves box tables inside fenced code blocks untouched', () => {
    const input = ['```', '┌───┬───┐', '│ a │ b │', '├───┼───┤', '│ 1 │ 2 │', '└───┴───┘', '```'].join('\n');
    expect(convertBoxTables(input)).toBe(input);
  });

  it('leaves indented code blocks (4+ spaces) untouched', () => {
    const input = [
      'text',
      '',
      '    ┌───┬───┐',
      '    │ a │ b │',
      '    ├───┼───┤',
      '    │ 1 │ 2 │',
      '    └───┴───┘',
    ].join('\n');
    expect(convertBoxTables(input)).toBe(input);
  });

  it('leaves blocks with inconsistent column counts untouched', () => {
    const input = ['┌───┬───┐', '│ a │ b │', '├───┼───┤', '│ 1 │ 2 │ 3 │', '└───┴───┘'].join('\n');
    expect(convertBoxTables(input)).toBe(input);
  });

  it('leaves a single-column box (not a table) untouched', () => {
    const input = ['┌───────┐', '│ hello │', '└───────┘'].join('\n');
    expect(convertBoxTables(input)).toBe(input);
  });

  it('escapes literal pipes inside cells so they do not split columns', () => {
    const input = [
      '┌──────┬───────┐',
      '│ cmd  │ a | b │',
      '├──────┼───────┤',
      '│ x    │ y     │',
      '└──────┴───────┘',
    ].join('\n');
    const lines = convertBoxTables(input).split('\n');
    expect(lines).toContain('| cmd | a \\| b |');
  });

  it('inserts blank lines so a table adjacent to text still parses as a table', () => {
    const input = ['before', '┌───┬───┐', '│ a │ b │', '├───┼───┤', '│ 1 │ 2 │', '└───┴───┘', 'after'].join('\n');
    const out = convertBoxTables(input);
    expect(out.split('\n')).toEqual(['before', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', 'after']);
  });

  it('converts multiple tables in one document', () => {
    const table = ['┌───┬───┐', '│ a │ b │', '├───┼───┤', '│ 1 │ 2 │', '└───┴───┘'].join('\n');
    const out = convertBoxTables(`${table}\n\nmiddle\n\n${table}`);
    expect(out.match(/\| --- \| --- \|/g)).toHaveLength(2);
    expect(out).toContain('middle');
  });

  it('drops a truncated block (no bottom border) back to the original text', () => {
    const input = ['┌───┬───┐', '│ a │ b │', '├───┼───┤', '│ 1 │ 2 │'].join('\n');
    expect(convertBoxTables(input)).toBe(input);
  });
});
