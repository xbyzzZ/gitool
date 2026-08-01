import { describe, expect, it } from 'vitest';
import {
  parseAheadBehind,
  parseCommitFiles,
  parseHistoryLog,
  parseRefs,
} from '../../src/services/history-service.js';

describe('Git 历史机器输出解析', () => {
  it('解析 NUL 分隔的提交字段并保留父提交', () => {
    const raw = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb cccccccccccccccccccccccccccccccccccccccc',
      '许博阳',
      '2026-08-01T10:00:00+08:00',
      '功能：示例',
      '\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '',
      '其他人',
      '2026-07-31T10:00:00+08:00',
      '修复：上一个提交',
      '',
    ].join('\0');

    expect(parseHistoryLog(raw)).toEqual([
      {
        hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        shortHash: 'aaaaaaa',
        parents: [
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          'cccccccccccccccccccccccccccccccccccccccc',
        ],
        author: '许博阳',
        authoredAt: '2026-08-01T10:00:00+08:00',
        subject: '功能：示例',
      },
      {
        hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        shortHash: 'bbbbbbb',
        parents: [],
        author: '其他人',
        authoredAt: '2026-07-31T10:00:00+08:00',
        subject: '修复：上一个提交',
      },
    ]);
  });

  it('拒绝字段数量不完整和非法哈希', () => {
    expect(() => parseHistoryLog('bad\0')).toThrow('Git 历史字段不完整');
    expect(() => parseHistoryLog([
      'not-a-hash', '', '作者', '2026-08-01T10:00:00+08:00', '主题', '',
    ].join('\0'))).toThrow('Git 历史提交哈希无效');
  });

  it('把本地和远程引用绑定到对应提交', () => {
    const raw = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'main',
      '\naaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'origin/main',
      '',
    ].join('\0');

    expect(parseRefs(raw, 'main', 'origin/main')).toEqual(new Map([
      ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [
        { name: 'main', kind: 'head' },
        { name: 'origin/main', kind: 'remote' },
      ]],
    ]));
  });

  it('解析普通、重命名和删除文件状态', () => {
    expect(parseCommitFiles([
      'M', 'src/a.ts',
      'R100', 'old.ts', 'new.ts',
      'D', 'gone.ts',
      '',
    ].join('\0'))).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: 'R100', path: 'new.ts', originalPath: 'old.ts' },
      { status: 'D', path: 'gone.ts' },
    ]);
  });

  it('解析领先落后计数并拒绝非数字结果', () => {
    expect(parseAheadBehind('3\t2\n')).toEqual({ ahead: 3, behind: 2 });
    expect(() => parseAheadBehind('three two')).toThrow(
      'Git 未返回有效的领先落后计数',
    );
  });
});
