import { isFullGitObjectId } from '../domain/git-object-id.js';
import type {
  AheadBehind,
  CommitDetails,
  CommitFile,
  CommitGraphNode,
  CommitRef,
  CommitSummary,
  HistoryView,
} from '../domain/history-model.js';
import { GitRunner } from '../git/git-runner.js';
import { parseAheadBehind } from './ahead-behind.js';

export { parseAheadBehind } from './ahead-behind.js';

const statusPattern = /^[A-Z][0-9]*$/u;

function removeTrailingEmpty(fields: string[]): void {
  while (fields.at(-1)?.trim().length === 0) {
    fields.pop();
  }
}

function validateHash(hash: string, message: string): void {
  if (!isFullGitObjectId(hash)) {
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
    const fullName = fields[index + 1] ?? '';
    validateHash(hash, 'Git 引用提交哈希无效');
    if (fullName.length === 0) {
      throw new Error('Git 引用名称为空');
    }
    const localPrefix = 'refs/heads/';
    const remotePrefix = 'refs/remotes/';
    if (fullName.startsWith(remotePrefix) && fullName.endsWith('/HEAD')) {
      continue;
    }
    const local = fullName.startsWith(localPrefix);
    const remote = fullName.startsWith(remotePrefix);
    if (!local && !remote) {
      throw new Error('Git 引用命名空间无效');
    }
    const name = fullName.slice((local ? localPrefix : remotePrefix).length);
    const kind: CommitRef['kind'] = local && name === head
      ? 'head'
      : remote ? 'remote' : 'local';
    const current = refs.get(hash) ?? [];
    current.push({ name, kind });
    current.sort((left, right) => {
      const priority = (ref: CommitRef): number => ref.kind === 'head'
        ? 0
        : ref.kind === 'local'
          ? 1
          : ref.name === upstream ? 2 : 3;
      return priority(left) - priority(right)
        || left.name.localeCompare(right.name);
    });
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

export function buildGraph(
  commits: readonly CommitSummary[],
): CommitGraphNode[] {
  const lanes: { hash: string; color: number }[] = [];
  let nextColor = 0;
  return commits.map((commit) => {
    let lane = lanes.findIndex((item) => item.hash === commit.hash);
    const hasIncoming = lane >= 0;
    if (lane < 0) {
      lane = lanes.length;
      lanes.push({ hash: commit.hash, color: nextColor });
      nextColor += 1;
    }
    const before = [...lanes];
    const current = before[lane];
    if (current === undefined) {
      throw new Error('Git 提交拓扑轨道无效');
    }
    lanes.splice(lane, 1);
    for (const parent of [...new Set(commit.parents)].reverse()) {
      if (!lanes.some((item) => item.hash === parent)) {
        const color = parent === commit.parents[0]
          ? current.color
          : nextColor++;
        lanes.splice(lane, 0, { hash: parent, color });
      }
    }
    const passingEdges = before.flatMap((item, fromLane) => {
      if (item.hash === commit.hash) {
        return [];
      }
      const toLane = lanes.findIndex((laneItem) => laneItem.hash === item.hash);
      return toLane < 0 ? [] : [{ fromLane, toLane, color: item.color }];
    });
    const parentEdges = commit.parents.map((parent) => {
      const toLane = lanes.findIndex((item) => item.hash === parent);
      const parentItem = lanes[toLane];
      if (parentItem === undefined) {
        throw new Error('Git 父提交拓扑轨道无效');
      }
      return { fromLane: lane, toLane, color: parentItem.color };
    });
    const parentLanes = parentEdges.map((edge) => edge.toLane);
    const laneCount = Math.max(before.length, lanes.length, 1);
    return {
      ...commit,
      lane,
      color: current.color,
      laneCount,
      hasIncoming,
      parentLanes,
      parentEdges,
      passingEdges,
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
        '--format=%(objectname)%00%(refname)%00',
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
    if (hashes[0] !== hash || hashes.some((value) => !isFullGitObjectId(value))) {
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
