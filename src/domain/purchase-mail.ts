export function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function purchaseMailRequest(input: { from: string; to: string; subject: string; text: string }): {
  from: string;
  to: string;
  subject: string;
  text: string;
} {
  return {
    from: input.from.trim(),
    to: input.to.trim(),
    subject: input.subject.trim(),
    text: input.text,
  };
}
