export const CLASSES = ["FORWARDED", "NOT_USEFUL", "DUPLICATE", "PENDING_REVIEW", "OTHER"] as const;
export type Classification = (typeof CLASSES)[number];

export const CLASS_LABELS: Record<Classification, string> = {
  FORWARDED: "Forwarded / Escalated",
  NOT_USEFUL: "Not Useful / Replied",
  DUPLICATE: "Duplicate",
  PENDING_REVIEW: "Pending Review",
  OTHER: "Other",
};

export type ReviewReason =
  | "LOW_CONFIDENCE"
  | "UNMATCHED_EMPLOYEE"
  | "DATE_INVALID"
  | "DATE_AMBIGUOUS"
  | "OUTSIDE_MONTH"
  | "UNCERTAIN_DUPLICATE"
  | "AMBIGUOUS"
  | "NO_EVIDENCE"
  | "PARSE_UNCERTAIN";

export const REVIEW_REASON_LABELS: Record<ReviewReason, string> = {
  LOW_CONFIDENCE: "Confidence below threshold",
  UNMATCHED_EMPLOYEE: "Sender not matched to an employee",
  DATE_INVALID: "Date missing or invalid",
  DATE_AMBIGUOUS: "Day/month order unclear — could fall in another month",
  OUTSIDE_MONTH: "Date outside selected month",
  UNCERTAIN_DUPLICATE: "Possible duplicate (uncertain)",
  AMBIGUOUS: "Ambiguous evidence",
  NO_EVIDENCE: "No evidence of escalation or reply",
  PARSE_UNCERTAIN: "Parser was unsure about some fields",
};

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
