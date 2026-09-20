import { Input } from "./ui";
import { formatExpiresOn } from "@/domain/expiry";

export function ExpiryInput({
  show,
  value,
  onChange,
  className,
}: {
  show?: boolean;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  if (!show) return null;
  return (
    <Input
      type="date"
      className={className}
      placeholder="Expiry"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function parseExpiryInput(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  return raw.trim();
}

export function expiryDisplay(value: number | null | undefined): string {
  return formatExpiresOn(value);
}
