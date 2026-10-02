import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { UnrecoverableError } from 'bullmq';

import type { OutboundEmail } from '../mail/mailer.js';

export interface SealedPayload {
  v: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** AES-256-GCM. The plaintext exists only in the process that seals or opens the payload. */
export function sealPayload(key: Buffer, message: OutboundEmail): SealedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(message), 'utf8'),
    cipher.final(),
  ]);
  return {
    v: 1,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

export function openSealedPayload(key: Buffer, value: unknown): OutboundEmail {
  if (!isRecord(value) || value.v !== 1) {
    throw new UnrecoverableError('Email job payload is not sealed');
  }
  const { iv, tag, ciphertext } = value;
  if (typeof iv !== 'string' || typeof tag !== 'string' || typeof ciphertext !== 'string') {
    throw new UnrecoverableError('Email job payload is not sealed');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const json = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (
      !isRecord(parsed) ||
      typeof parsed.to !== 'string' ||
      typeof parsed.subject !== 'string' ||
      typeof parsed.text !== 'string'
    ) {
      throw new Error('unsealed email is incomplete');
    }
    return { to: parsed.to, subject: parsed.subject, text: parsed.text };
  } catch (error) {
    if (error instanceof UnrecoverableError) throw error;
    throw new UnrecoverableError('Email job payload could not be opened');
  }
}
