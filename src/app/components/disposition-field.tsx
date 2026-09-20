import { Select } from "./ui";
import { RETURN_DISPOSITIONS, dispositionLabel, type ReturnDisposition } from "@/domain/return-disposition";

export function DispositionSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: ReturnDisposition) => void;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as ReturnDisposition)}>
      {RETURN_DISPOSITIONS.map((row) => (
        <option key={row} value={row}>
          {dispositionLabel(row)}
        </option>
      ))}
    </Select>
  );
}
