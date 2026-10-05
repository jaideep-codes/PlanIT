const MAILPIT_ORIGIN = 'http://127.0.0.1:8025';

interface MailpitAddress {
  Address?: string;
}

interface MailpitSummary {
  ID?: string;
  Subject?: string;
  Created?: string;
  To?: MailpitAddress[];
}

function codeFromText(text: string): string | null {
  const match = /code is (\d{6})/.exec(text);
  return match?.[1] ?? null;
}

/**
 * Reads a one-time code from Mailpit. The code is returned to the caller and is
 * not written to the console.
 */
export async function readInboxCode(email: string, subjectIncludes: string): Promise<string> {
  const deadline = Date.now() + 25_000;
  const recipient = email.toLowerCase();
  const subjectNeedle = subjectIncludes.toLowerCase();

  while (Date.now() < deadline) {
    const list = await fetch(`${MAILPIT_ORIGIN}/api/v1/messages?limit=50`);
    if (list.ok) {
      const body = (await list.json()) as { messages?: MailpitSummary[] };
      const matches = (body.messages ?? [])
        .filter((message) => {
          const subject = message.Subject?.toLowerCase() ?? '';
          const addressed = (message.To ?? []).some(
            (entry) => entry.Address?.toLowerCase() === recipient,
          );
          return addressed && subject.includes(subjectNeedle) && Boolean(message.ID);
        })
        .sort((left, right) => (right.Created ?? '').localeCompare(left.Created ?? ''));
      const newest = matches[0];
      if (newest?.ID) {
        const detail = await fetch(`${MAILPIT_ORIGIN}/api/v1/message/${newest.ID}`);
        if (!detail.ok) throw new Error('Could not read the inbox message');
        const message = (await detail.json()) as { Text?: string };
        const code = codeFromText(message.Text ?? '');
        if (!code) throw new Error('The inbox message did not include a code');
        return code;
      }
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
  }

  throw new Error(`No inbox message arrived for ${email}`);
}
