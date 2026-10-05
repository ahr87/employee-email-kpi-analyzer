export interface ParsedEmail {
  senderName: string;
  senderEmail: string;
  to: string[];
  cc: string[];
  subject: string;
  sentAt: Date | null; // wall-clock time stored as UTC
  body: string;
  rawSource: string;
  messageId: string | null;
  isForward: boolean;
  isReply: boolean;
  /** Fields the parser could not determine confidently — never invented. */
  uncertainFields: string[];
}

export interface ParseResult {
  emails: ParsedEmail[];
  warnings: string[];
}

export interface ParseOptions {
  /** How to read all-numeric dates such as 03/04/2026. Default DMY. */
  dateOrder?: "DMY" | "MDY";
}
