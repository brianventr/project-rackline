import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useScanner } from "../../scanner/ScannerProvider";
import { Button, ErrorBanner, Input } from "../../components/ui";

export function FloorScanBox({
  label,
  placeholder,
  onScan,
}: {
  label: string;
  placeholder: string;
  onScan: (raw: string) => void;
}) {
  const scanner = useScanner();
  const [value, setValue] = useState("");
  const handledAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const scan = scanner.lastScan;
    if (!scan || scan.at === handledAt.current) return;
    handledAt.current = scan.at;
    setValue(scan.raw);
    onScan(scan.raw);
  }, [scanner.lastScan, onScan]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) onScan(value.trim());
  }

  return (
    <form className="space-y-2" onSubmit={submit}>
      <p className="text-sm font-medium">{label}</p>
      <Input
        ref={inputRef}
        data-scan-capture
        className="h-14 text-xl"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit">Use scan</Button>
    </form>
  );
}

export function FloorFrame({
  title,
  description,
  error,
  children,
}: {
  title: string;
  description: string;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Floor</p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
      <ErrorBanner error={error} />
      {children}
    </div>
  );
}
