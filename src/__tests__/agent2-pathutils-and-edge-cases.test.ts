/**
 * Agent 2 — Coverage for previously-untested code paths.
 *
 * NOTE: Multiple agents may be editing the repo concurrently. This file
 * only adds tests — it does NOT modify source code.
 *
 * Targets (identified by searching tests vs source):
 *
 * path-utils.ts — isFileSystemError (ZERO prior test coverage):
 *  1. Returns true for all 12 FS_ERROR_CODES (EACCES, EPERM, ENOSPC, EROFS,
 *     ENOENT, EISDIR, ENOTDIR, EMFILE, ENFILE, EIO, EEXIST, EBUSY)
 *  2. Returns false for non-Error inputs (null, undefined, string, number, plain object)
 *  3. Returns false for Error without code property
 *  4. Returns false for Error with network error codes (ECONNREFUSED, ECONNRESET, ETIMEDOUT)
 *  5. Returns false for Error with empty string code
 *
 * path-utils.ts — writeOutputFile (ZERO prior test coverage):
 *  6. Writes file with correct content
 *  7. Cleans up temp on failure (ENOENT from non-existent parent)
 *  8. Overwrites existing file at target path
 *
 * embed_text — remaining edge cases:
 *  9. texts as single non-string (number) — wraps in array then type-checks
 *  10. texts as boolean — wraps in array then type-checks
 *  11. texts as object — wraps in array then type-checks
 *
 * decide — remaining edge cases:
 *  12. state with BigInt value — non-serializable (different from circular ref)
 *  13. score answer where all values are non-finite (NaN, Infinity, -Infinity)
 *  14. Multiple questions with mixed answer types in summary
 *  15. score criteria with exactly 2 non-string entries (first fails)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { promises as fs } from 'node:fs';
import { isFileSystemError, writeOutputFile } from '../tool-handlers/path-utils.js';
import { handleEmbedText } from '../tool-handlers/embed-text.js';
import { handleDecide } from '../tool-handlers/decide.js';
import type { OpenRouterAPIClient } from '../openrouter-api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ErrorResult = {
  content: Array<{ type: string; text: string }>;
  isError: true;
  _meta: { code: string };
};

type SuccessResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

function mockEmbedClient(response: unknown) {
  return {
    createEmbeddings: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function mockDecideClient(response: unknown) {
  return {
    submitDecision: vi.fn().mockResolvedValue(response),
  } as unknown as OpenRouterAPIClient;
}

function embedReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleEmbedText>[0];
}

function decideReq(args: Record<string, unknown>) {
  return { params: { arguments: args } } as Parameters<typeof handleDecide>[0];
}

/** Helper to create an Error with a code property (like Node.js fs errors). */
function fsError(code: string, message = 'mock fs error'): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// 1. isFileSystemError — returns true for all 12 FS_ERROR_CODES
// ---------------------------------------------------------------------------

describe('isFileSystemError — FS error codes', () => {
  const FS_CODES = [
    'EACCES',
    'EPERM',
    'ENOSPC',
    'EROFS',
    'ENOENT',
    'EISDIR',
    'ENOTDIR',
    'EMFILE',
    'ENFILE',
    'EIO',
    'EEXIST',
    'EBUSY',
  ];

  it.each(FS_CODES)('returns true for Error with code %s', (code) => {
    expect(isFileSystemError(fsError(code))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. isFileSystemError — returns false for non-Error inputs
// ---------------------------------------------------------------------------

describe('isFileSystemError — non-Error inputs', () => {
  it('returns false for null', () => {
    expect(isFileSystemError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isFileSystemError(undefined)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isFileSystemError('EACCES')).toBe(false);
  });

  it('returns false for number', () => {
    expect(isFileSystemError(42)).toBe(false);
  });

  it('returns false for plain object with code', () => {
    // Not an Error instance — should be false
    expect(isFileSystemError({ code: 'EACCES', message: 'test' })).toBe(false);
  });

  it('returns false for boolean', () => {
    expect(isFileSystemError(true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. isFileSystemError — returns false for Error without code
// ---------------------------------------------------------------------------

describe('isFileSystemError — Error without code', () => {
  it('returns false for plain Error (no code)', () => {
    expect(isFileSystemError(new Error('generic error'))).toBe(false);
  });

  it('returns false for Error with undefined code', () => {
    const err = new Error('test') as NodeJS.ErrnoException;
    err.code = undefined;
    expect(isFileSystemError(err)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. isFileSystemError — returns false for network error codes
// ---------------------------------------------------------------------------

describe('isFileSystemError — network error codes (should be false)', () => {
  const NETWORK_CODES = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH'];

  it.each(NETWORK_CODES)('returns false for Error with code %s', (code) => {
    expect(isFileSystemError(fsError(code))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. isFileSystemError — empty string code
// ---------------------------------------------------------------------------

describe('isFileSystemError — edge cases', () => {
  it('returns false for Error with empty string code', () => {
    const err = new Error('test') as NodeJS.ErrnoException;
    err.code = '';
    expect(isFileSystemError(err)).toBe(false);
  });

  it('returns false for Error with lowercase fs code (case-sensitive)', () => {
    expect(isFileSystemError(fsError('eacces'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6–8. writeOutputFile — atomic file writing
// ---------------------------------------------------------------------------

describe('writeOutputFile', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    for (const p of cleanupPaths) {
      await fs.rm(p, { recursive: true, force: true }).catch(() => undefined);
    }
    cleanupPaths.length = 0;
  });

  it('writes file with correct content', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'writetest-'));
    cleanupPaths.push(dir);
    const target = path.join(dir, 'output.bin');
    const data = Buffer.from('hello world');

    await writeOutputFile(target, data);

    const read = await fs.readFile(target);
    expect(read.toString()).toBe('hello world');
  });

  it('overwrites existing file at target path', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'writetest-'));
    cleanupPaths.push(dir);
    const target = path.join(dir, 'existing.bin');

    // Write initial content
    await fs.writeFile(target, 'old data');
    // Overwrite via atomic write
    await writeOutputFile(target, Buffer.from('new data'));

    const read = await fs.readFile(target, 'utf8');
    expect(read).toBe('new data');
  });

  it('throws on non-existent parent directory', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'writetest-'));
    cleanupPaths.push(dir);
    // Target is in a subdirectory that doesn't exist
    const target = path.join(dir, 'nonexistent', 'subdir', 'output.bin');

    await expect(writeOutputFile(target, Buffer.from('test'))).rejects.toThrow();
  });

  it('leaves no temp files on failure', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'writetest-'));
    cleanupPaths.push(dir);
    const target = path.join(dir, 'nonexistent', 'output.bin');

    try {
      await writeOutputFile(target, Buffer.from('test'));
    } catch {
      // Expected to throw
    }

    // Verify no temp files are left in the parent directory
    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
  });

  it('writes empty buffer successfully', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'writetest-'));
    cleanupPaths.push(dir);
    const target = path.join(dir, 'empty.bin');

    await writeOutputFile(target, Buffer.alloc(0));

    const stat = await fs.stat(target);
    expect(stat.size).toBe(0);
  });

  it('writes binary data correctly', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'writetest-'));
    cleanupPaths.push(dir);
    const target = path.join(dir, 'binary.bin');
    const data = Buffer.from([0x00, 0xff, 0x7f, 0x80, 0x01, 0xfe]);

    await writeOutputFile(target, data);

    const read = await fs.readFile(target);
    expect(Buffer.compare(read, data)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9–11. embed_text — single non-string/non-array inputs
// ---------------------------------------------------------------------------

describe('handleEmbedText — single non-array non-string texts input', () => {
  it('returns INVALID_INPUT when texts is a number (wraps in array, fails type check)', async () => {
    const r = (await handleEmbedText(embedReq({ texts: 42 }), mockEmbedClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('returns INVALID_INPUT when texts is a boolean', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: true }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('texts[0]');
  });

  it('returns INVALID_INPUT when texts is an object (non-array)', async () => {
    const r = (await handleEmbedText(
      embedReq({ texts: { key: 'value' } }),
      mockEmbedClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    // Object wraps into [{key: 'value'}], which fails the string check at index 0
    expect(r.content[0].text).toContain('texts[0]');
  });
});

// ---------------------------------------------------------------------------
// 12. decide — state with BigInt (non-serializable)
// ---------------------------------------------------------------------------

describe('handleDecide — state with non-serializable BigInt', () => {
  it('returns INVALID_INPUT when state contains BigInt value', async () => {
    const state = { count: BigInt(42) };
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'Is this valid?',
            criteria: { yes: 'Yes', no: 'No' },
          },
        },
        state,
      }),
      mockDecideClient({}),
    )) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('not serializable');
  });
});

// ---------------------------------------------------------------------------
// 13. decide — score with all non-finite values
// ---------------------------------------------------------------------------

describe('handleDecide — score with non-finite values', () => {
  it('Infinity passes typeof check, so it wins the max comparison', async () => {
    // Infinity IS typeof 'number', so it passes the guard and wins the sort.
    // NaN fails comparison (NaN > anything is false), so it's skipped.
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [NaN, Infinity, -Infinity] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['low', 'mid', 'high'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    // Infinity is at index 1 → level 2/3, and (Infinity * 100).toFixed(1) = "Infinity"
    expect(r.content[0].text).toContain('level 2/3');
    expect(r.content[0].text).toContain('Infinity');
  });

  it('handles score where only NaN entries exist (maxIdx stays 0)', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'score', score: [NaN, NaN] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'score',
            instructions: 'rate',
            criteria: ['low', 'high'],
          },
        },
      }),
      client,
    )) as SuccessResult;
    // NaN > -Infinity is false, so maxIdx stays 0. score[0] is NaN → ?? 0 → 0.0%
    expect(r.content[0].text).toContain('level 1/2');
  });
});

// ---------------------------------------------------------------------------
// 14. decide — multiple mixed answer types summary formatting
// ---------------------------------------------------------------------------

describe('handleDecide — multi-type answer summary', () => {
  it('formats all three answer types in one response', async () => {
    const client = mockDecideClient({
      answers: {
        binary_q: { type: 'noul', noul: 0.95 },
        color_q: { type: 'choice', choice: { red: 0.6, blue: 0.3, green: 0.1 } },
        quality_q: { type: 'score', score: [0.05, 0.1, 0.8, 0.05] },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          binary_q: {
            type: 'noul',
            instructions: 'Is it sunny?',
            criteria: { yes: 'Sunny', no: 'Not sunny' },
          },
          color_q: {
            type: 'choice',
            instructions: 'Pick a color',
            criteria: { red: 'Red', blue: 'Blue', green: 'Green' },
          },
          quality_q: {
            type: 'score',
            instructions: 'Rate quality',
            criteria: ['bad', 'fair', 'good', 'excellent'],
          },
        },
      }),
      client,
    )) as SuccessResult;

    const text = r.content[0].text;
    const lines = text.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(3);

    // noul → YES at 95.0%
    expect(text).toContain('binary_q');
    expect(text).toContain('YES');
    expect(text).toContain('95.0%');

    // choice → red at 60.0%
    expect(text).toContain('color_q');
    expect(text).toContain('red');
    expect(text).toContain('60.0%');

    // score → level 3/4 at 80.0%
    expect(text).toContain('quality_q');
    expect(text).toContain('level 3/4');
    expect(text).toContain('80.0%');

    // structuredContent has all answers
    const answers = r.structuredContent.answers as Record<string, unknown>;
    expect(Object.keys(answers)).toHaveLength(3);
  });

  it('includes question_count in _meta matching number of submitted questions', async () => {
    const client = mockDecideClient({
      answers: {
        q1: { type: 'noul', noul: 0.5 },
        q2: { type: 'choice', choice: { a: 0.7, b: 0.3 } },
      },
    });
    const r = (await handleDecide(
      decideReq({
        questions: {
          q1: {
            type: 'noul',
            instructions: 'test1',
            criteria: { yes: 'y', no: 'n' },
          },
          q2: {
            type: 'choice',
            instructions: 'test2',
            criteria: { a: 'A', b: 'B' },
          },
        },
      }),
      client,
    )) as SuccessResult;
    expect(r._meta.question_count).toBe(2);
    expect(r._meta.model).toBe('typesafe/jev-1.13');
  });
});

// ---------------------------------------------------------------------------
// 15. decide — score criteria with non-string entries at first position
// ---------------------------------------------------------------------------

describe('handleDecide — score criteria type validation order', () => {
  it('rejects score criteria when first entry is non-string', async () => {
    const questions = {
      q1: {
        type: 'score',
        instructions: 'rate quality',
        criteria: [42, 'good'], // first entry is non-string
      },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria[0]');
    expect(r.content[0].text).toContain('must be a string');
  });

  it('rejects score criteria when last entry is non-string', async () => {
    const questions = {
      q1: {
        type: 'score',
        instructions: 'rate quality',
        criteria: ['bad', 'ok', false], // last entry is non-string
      },
    };
    const r = (await handleDecide(decideReq({ questions }), mockDecideClient({}))) as ErrorResult;
    expect(r.isError).toBe(true);
    expect(r._meta.code).toBe('INVALID_INPUT');
    expect(r.content[0].text).toContain('criteria[2]');
    expect(r.content[0].text).toContain('must be a string');
  });
});
