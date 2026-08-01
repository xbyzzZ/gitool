import type {
  AheadBehind,
  AheadBehindCount,
  CommitDetails,
  CommitFile,
  CommitGraphNode,
  CommitRef,
  CommitSummary,
  HistoryView,
} from '../domain/history-model.js';
import { GitRunner } from '../git/git-runner.js';

const fullHashPattern = /^[0-9a-f]{40,64}$/u;
const statusPattern = /^[A-Z][0-9]*$/u;

function removeTrailingEmpty(fields: string[]): void {
  while (fields.at(-1)?.trim().length === 0) {
    fields.pop();
  }
}

function validateHash(hash: string, message: string): void {
  if (!fullHashPattern.test(hash)) {
    throw new Error(message);
  }
}

export function parseHistoryLog(raw: string): Omit<CommitSummary, 'refs'>[] {
  if (raw.length === 0) {
    return [];
  }
  const fields = raw.split('\0');
  removeTrailingEmpty(fields);
  if (fields.length % 5 !== 0) {
    throw new Error('Git 历史字段不完整');
  }
  const commits: Omit<CommitSummary, 'refs'>[] = [];
  for (let index = 0; index < fields.length; index += 5) {
    const hash = fields[index]?.trimStart() ?? '';
    const parentField = fields[index + 1] ?? '';
    const author = fields[index + 2] ?? '';
    const authoredAt = fields[index + 3] ?? '';
    const subject = fields[index + 4] ?? '';
    validateHash(hash, 'Git 历史提交哈希无效');
    const parents = parentField.length === 0 ? [] : parentField.split(' ');
    for (const parent of parents) {
      validateHash(parent, 'Git 历史父提交哈希无效');
    }
    if (!Number.isFinite(Date.parse(authoredAt))) {
      throw new Error('Git 历史提交时间无效');
    }
    commits.push({
      hash,
      shortHash: hash.slice(0, 7),
      parents,
      author,
      authoredAt,
      subject,
    });
  }
  return commits;
}

export function parseRefs(
  raw: string,
  head?: string,
  upstream?: string,
): Map<string, CommitRef[]> {
  if (raw.length === 0) {
    return new Map();
  }
  const fields = raw.split('\0');
  removeTrailingEmpty(fields);
  if (fields.length % 2 !== 0) {
    throw new Error('Git 引用字段不完整');
  }
  const refs = new Map<string, CommitRef[]>();
  for (let index = 0; index < fields.length; index += 2) {
    const hash = fields[index]?.trimStart() ?? '';
    const name = fields[index + 1] ?? '';
    validateHash(hash, 'Git 引用提交哈希无效');
    if (name.length === 0) {
      throw new Error('Git 引用名称为空');
    }
    const kind: CommitRef['kind'] = name === head
      ? 'head'
      : name === upstream
        ? 'remote'
        : 'local';
    const current = refs.get(hash) ?? [];
    current.push({ name, kind });
    refs.set(hash, current);
  }
  return refs;
}

export function parseCommitFiles(raw: string): CommitFile[] {
  if (raw.length === 0) {
    return [];
  }
  const fields = raw.split('\0');
  removeTrailingEmpty(fields);
  const files: CommitFile[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index] ?? '';
    if (!statusPattern.test(status)) {
      throw new Error('Git 提交文件状态无效');
    }
    index += 1;
    if (status.startsWith('R') || status.startsWith('C')) {
      const originalPath = fields[index];
      const path = fields[index + 1];
      if (originalPath === undefined || path === undefined) {
        throw new Error('Git 重命名文件字段不完整');
      }
      files.push({ status, path, originalPath });
      index += 2;
      continue;
    }
    const path = fields[index];
    if (path === undefined) {
      throw new Error('Git 提交文件路径缺失');
    }
    files.push({ status, path });
    index += 1;
  }
  return files;
}

export function parseAheadBehind(raw: string): AheadBehindCount {
  const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(raw);
  if (match === null) {
    throw new Error('Git 未返回有效的领先落后计数');
  }
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}

function buildGraph(
  commits: readonly CommitSummary[],
): CommitGraphNode[] {
  const lanes: string[] = [];
  return commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(commit.hash);
    }
    if (commit.parents.length === 0) {
      lanes.splice(lane, 1);
      return { ...commit, lane, parentLanes: [] };
    }
    const [firstParent, ...otherParents] = commit.parents;
    if (firstParent !== undefined) {
      lanes[lane] = firstParent;
    }
    for (const parent of otherParents) {
      if (!lanes.includes(parent)) {
        lanes.splice(lane + 1, 0, parent);
      }
    }
    return {
      ...commit,
      lane,
      parentLanes: commit.parents.map((parent) => lanes.indexOf(parent)),
    };
  });
}

export class HistoryService {
  constructor(private readonly git: GitRunner) {}

  async list(repositoryRoot: string, limit = 50): Promise<HistoryView> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 500) {
      throw new RangeError('Git 历史条数必须在 1 到 500 之间');
    }
    const [headResult, upstreamResult, refsResult, logResult] = await Promise.all([
      this.git.run(repositoryRoot, [
        'symbolic-ref', '--quiet', '--short', 'HEAD',
      ], { allowFailure: true }),
      this.git.run(repositoryRoot, [
        'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}',
      ], { allowFailure: true }),
      this.git.runForMachineParsing(repositoryRoot, [
        'for-each-ref',
        '--format=%(objectname)%00%(refname:short)%00',
        'refs/heads',
        'refs/remotes',
      ]),
      this.git.runForMachineParsing(repositoryRoot, [
        'log', '--all', '--topo-order', '--date-order',
        `--max-count=${String(limit)}`,
        '--format=%H%x00%P%x00%an%x00%aI%x00%s%x00',
      ]),
    ]);
    const head = headResult.exitCode === 0
      ? headResult.stdout.trim()
      : undefined;
    const upstream = upstreamResult.exitCode === 0
      ? upstreamResult.stdout.trim()
      : undefined;
    const refs = parseRefs(refsResult.rawStdout, head, upstream);
    const summaries: CommitSummary[] = parseHistoryLog(logResult.rawStdout)
      .map((commit) => ({
        ...commit,
        refs: refs.get(commit.hash) ?? [],
      }));
    return {
      ...(head === undefined ? {} : { head }),
      ...(upstream === undefined ? {} : { upstream }),
      commits: buildGraph(summaries),
    };
  }

  async details(
    repositoryRoot: string,
    hash: string,
  ): Promise<CommitDetails> {
    validateHash(hash, '待读取的提交哈希无效');
    const [parentResult, filesResult] = await Promise.all([
      this.git.runForMachineParsing(repositoryRoot, [
        'rev-list', '--parents', '--max-count=1', hash,
      ]),
      this.git.runForMachineParsing(repositoryRoot, [
        'diff-tree', '--root', '--first-parent', '--no-commit-id',
        '--name-status', '-r', '-M', '-z', hash,
      ]),
    ]);
    const hashes = parentResult.rawStdout.trim().split(/\s+/u);
    if (hashes[0] !== hash || hashes.some((value) => !fullHashPattern.test(value))) {
      throw new Error('Git 提交父级输出无效');
    }
    return {
      hash,
      ...(hashes[1] === undefined ? {} : { parentHash: hashes[1] }),
      files: parseCommitFiles(filesResult.rawStdout),
    };
  }

  async aheadBehind(repositoryRoot: string): Promise<AheadBehind> {
    const upstreamResult = await this.git.run(repositoryRoot, [
      'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}',
    ], { allowFailure: true });
    if (upstreamResult.exitCode !== 0) {
      return { kind: 'no-upstream' };
    }
    const upstream = upstreamResult.stdout.trim();
    if (upstream.length === 0) {
      throw new Error('Git 上游名称为空');
    }
    const countResult = await this.git.runForMachineParsing(repositoryRoot, [
      'rev-list', '--left-right', '--count', 'HEAD...@{upstream}',
    ]);
    return {
      kind: 'ready',
      upstream,
      ...parseAheadBehind(countResult.rawStdout),
    };
  }
}
