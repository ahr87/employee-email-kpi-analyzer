export interface ParsedEmail {
  senderName: string;
  senderEmail: string;
  to: string[];
  cc: string[];
  subject: string;
  sentAt: Date | null; // wall-clock time stored as UTC
  /** Other reading of an ambiguous numeric date (day/month swapped), when it is a valid different date. */
  sentAtAlt: Date | null;
  /** "DMY"/"MDY" when the numeric date itself proves the order (a part > 12); otherwise null. */
  dateOrderEvidence: "DMY" | "MDY" | null;
  /** True when this message was found inside a reply/forward chain below another message. */
  quoted: boolean;
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
