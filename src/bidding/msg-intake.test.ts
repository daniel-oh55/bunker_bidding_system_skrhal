import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_MSG_FILE_SIZE_BYTES, readMsgFile } from './msg-intake';

const reader = vi.hoisted(() => ({
  construct: vi.fn(),
  getFileData: vi.fn(),
}));

vi.mock('@kenjiuno/msgreader-web-ng', () => ({
  MsgReader: class {
    constructor(buffer: ArrayBuffer) {
      reader.construct(buffer);
    }

    getFileData(): unknown {
      return reader.getFileData() as unknown;
    }
  },
}));

const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function fileStub(name: string, bytes = signature, declaredSize = bytes.length) {
  const buffer = Uint8Array.from(bytes).buffer;
  const arrayBuffer = vi.fn(() => Promise.resolve(buffer));
  return { file: { name, size: declaredSize, arrayBuffer }, arrayBuffer };
}

describe('Outlook .msg file boundary', () => {
  beforeEach(() => {
    reader.construct.mockReset();
    reader.getFileData.mockReset();
    reader.getFileData.mockReturnValue({ subject: ' Test subject ', body: ' Test body ' });
  });

  it('rejects a non-.msg extension before reading file bytes', async () => {
    const { file, arrayBuffer } = fileStub('request.eml');

    await expect(readMsgFile(file)).resolves.toEqual({ ok: false, error: 'Choose one Outlook .msg file.' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('accepts the .msg extension case-insensitively', async () => {
    const { file } = fileStub('REQUEST.MSG');

    await expect(readMsgFile(file)).resolves.toEqual({
      ok: true,
      content: { subject: 'Test subject', body: 'Test body' },
    });
    expect(reader.getFileData).toHaveBeenCalledOnce();
  });

  it('rejects a file larger than 5 MiB before reading file bytes', async () => {
    const { file, arrayBuffer } = fileStub('request.msg', signature, MAX_MSG_FILE_SIZE_BYTES + 1);

    await expect(readMsgFile(file)).resolves.toEqual({ ok: false, error: 'The .msg file must be 5 MiB or smaller.' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects an invalid CFBF signature before invoking MsgReader', async () => {
    const { file } = fileStub('request.msg', [0, 1, 2, 3, 4, 5, 6, 7]);

    await expect(readMsgFile(file)).resolves.toEqual({
      ok: false,
      error: 'The selected file is not a valid Outlook .msg compound file.',
    });
    expect(reader.construct).not.toHaveBeenCalled();
    expect(reader.getFileData).not.toHaveBeenCalled();
  });

  it('converts a parser exception into a sanitized failure', async () => {
    reader.getFileData.mockImplementation(() => {
      throw new Error('Secret subject and internal parser details');
    });
    const { file } = fileStub('request.msg');

    const result = await readMsgFile(file);
    expect(result).toEqual({ ok: false, error: 'The selected .msg file could not be parsed safely.' });
    expect(JSON.stringify(result)).not.toContain('Secret subject');
  });

  it('normalizes missing or non-string subject and body to plain empty strings', async () => {
    reader.getFileData.mockReturnValue({ subject: undefined, body: new Uint8Array([1, 2]) });
    const { file } = fileStub('request.msg');

    await expect(readMsgFile(file)).resolves.toEqual({
      ok: true,
      content: { subject: '', body: '' },
    });
  });

  it('exposes subject and body only and never exposes HTML or attachment data', async () => {
    reader.getFileData.mockReturnValue({
      subject: 'Subject',
      body: 'Plain text',
      bodyHtml: '<img src="https://invalid.example/tracker">',
      html: new Uint8Array([1, 2, 3]),
      attachments: [{ fileName: 'secret.txt', content: new Uint8Array([4, 5]) }],
      senderEmail: 'sender@invalid.example',
    });
    const { file } = fileStub('request.msg');

    const result = await readMsgFile(file);
    expect(result).toEqual({ ok: true, content: { subject: 'Subject', body: 'Plain text' } });
    expect(result).not.toHaveProperty('content.bodyHtml');
    expect(result).not.toHaveProperty('content.attachments');
    expect(result).not.toHaveProperty('content.senderEmail');
  });
});
