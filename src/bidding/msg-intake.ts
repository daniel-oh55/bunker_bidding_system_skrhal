import { MsgReader } from '@kenjiuno/msgreader-web-ng';

export const MAX_MSG_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export type NormalizedMsgContent = {
  subject: string;
  body: string;
};

export type MsgIntakeResult =
  | { ok: true; content: NormalizedMsgContent }
  | { ok: false; error: string };

const compoundFileSignature = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function hasMsgExtension(name: string): boolean {
  return /\.msg$/i.test(name);
}

function hasCompoundFileSignature(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < compoundFileSignature.length) return false;
  const header = new Uint8Array(buffer, 0, compoundFileSignature.length);
  return compoundFileSignature.every((byte, index) => header[index] === byte);
}

export async function readMsgFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<MsgIntakeResult> {
  if (!hasMsgExtension(file.name)) {
    return { ok: false, error: 'Choose one Outlook .msg file.' };
  }
  if (file.size > MAX_MSG_FILE_SIZE_BYTES) {
    return { ok: false, error: 'The .msg file must be 5 MiB or smaller.' };
  }

  try {
    const buffer = await file.arrayBuffer();
    if (!hasCompoundFileSignature(buffer)) {
      return { ok: false, error: 'The selected file is not a valid Outlook .msg compound file.' };
    }

    const parsed = new MsgReader(buffer).getFileData();
    return {
      ok: true,
      content: {
        subject: typeof parsed.subject === 'string' ? parsed.subject.trim() : '',
        body: typeof parsed.body === 'string' ? parsed.body.trim() : '',
      },
    };
  } catch {
    return { ok: false, error: 'The selected .msg file could not be parsed safely.' };
  }
}
