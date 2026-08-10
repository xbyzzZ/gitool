import type { AheadBehindCount } from '../domain/history-model.js';

export function parseAheadBehind(raw: string): AheadBehindCount {
  const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(raw);
  if (match === null) {
    throw new Error('Git 未返回有效的领先落后计数');
  }
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}
