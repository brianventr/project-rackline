import { Input } from "./ui";

export function CatchWeightInput({
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
      type="number"
      min={1}
      className={className}
      placeholder="Weight (g)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function parseWeightGrams(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  return Number(raw);
}
