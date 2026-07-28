import { describe, expect, it } from 'vitest';
import { redactSensitiveText } from '../../src/git/git-runner.js';

describe('redactSensitiveText', () => {
  it('遮蔽 URL 中的用户名、密码和令牌', () => {
    expect(redactSensitiveText(
      '推送 https://alice:secret@example.com/a.git?access_token=token123',
    )).toBe(
      '推送 https://***:***@example.com/a.git?access_token=***',
    );
  });
});
