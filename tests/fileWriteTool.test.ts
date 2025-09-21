import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import FileWriteTool from '@/Tools/FileWriteTool';

describe('FileWriteTool path validation', () => {
  let baseDir: string;
  let tool: FileWriteTool;

  beforeAll(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'tiny-crew-filewrite-'));
    tool = new FileWriteTool({ basePath: baseDir });
  });

  afterAll(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('writes files inside the configured base directory', async () => {
    const result = await tool.use({
      filename: 'notes/safe.txt',
      content: 'hello tiny crew'
    });

    expect(result).toContain('Content successfully written');

    const saved = readFileSync(join(baseDir, 'notes', 'safe.txt'), 'utf8');
    expect(saved).toBe('hello tiny crew');
  });

  it('rejects path traversal attempts', async () => {
    expect(tool.validateInput({ filename: '../escape.txt', content: 'nope' })).toBe(false);

    await expect(tool.use({ filename: '../escape.txt', content: 'nope' })).rejects.toThrow('Invalid file path or content');
  });

  it('rejects absolute paths outside the base directory', async () => {
    const outsidePath = resolve(baseDir, '../outside.txt');

    expect(tool.validateInput({ filename: outsidePath, content: 'nope' })).toBe(false);

    await expect(tool.use({ filename: outsidePath, content: 'nope' })).rejects.toThrow('Invalid file path or content');
  });
});
