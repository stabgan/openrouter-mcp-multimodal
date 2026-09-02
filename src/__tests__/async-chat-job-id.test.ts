import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadJobFromDisk } from '../tool-handlers/async-chat.js';
import { isValidJobId, resolveSafeJobStatusPath } from '../tool-handlers/path-safety.js';

describe('async chat job_id sandbox', () => {
  let sandbox: string;

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(tmpdir(), 'mcp-async-jobs-'));
    vi.stubEnv('OPENROUTER_OUTPUT_DIR', sandbox);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  it('isValidJobId rejects traversal segments', () => {
    expect(isValidJobId('chat_20250823120000_001')).toBe(true);
    expect(isValidJobId('chat_disk_completed')).toBe(true);
    expect(isValidJobId('../etc/passwd')).toBe(false);
    expect(isValidJobId('chat_20250823120000_001/../../secret')).toBe(false);
    expect(isValidJobId('not-a-job')).toBe(false);
  });

  it('loadJobFromDisk rejects malicious job_id before filesystem read', async () => {
    const malicious = '../outside';
    const result = await loadJobFromDisk(malicious);
    expect(result).toBeNull();
    const outside = path.join(sandbox, 'outside', 'status.json');
    await expect(fs.access(outside)).rejects.toThrow();
  });

  it('resolveSafeJobStatusPath rejects symlink escape outside jobs root', async () => {
    const outside = await fs.mkdtemp(path.join(tmpdir(), 'mcp-outside-'));
    const jobsDir = path.join(sandbox, 'openrouter-jobs');
    await fs.mkdir(jobsDir, { recursive: true });
    const jobId = 'chat_symlink_escape';
    await fs.symlink(outside, path.join(jobsDir, jobId));
    await fs.mkdir(path.join(outside, 'nested'), { recursive: true });
    await fs.writeFile(path.join(outside, 'status.json'), '{"oops":true}');

    const resolved = await resolveSafeJobStatusPath(jobsDir, jobId);
    expect(resolved).toBeNull();
    await fs.rm(outside, { recursive: true, force: true });
  });
});
