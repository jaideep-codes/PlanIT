export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

/** Transactional mail. Callers pass the message in memory; implementations must not log it. */
export interface Mailer {
  send(message: OutboundEmail): Promise<void>;
}
