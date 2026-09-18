import { barcodeSvg } from "../lib/code128";

export function BarcodeLabel({
  value,
  className = "",
  height = 44,
}: {
  value: string;
  className?: string;
  height?: number;
}) {
  const src = `data:image/svg+xml;utf8,${encodeURIComponent(barcodeSvg(value, { height, module: 2 }))}`;
  return <img src={src} alt={`Barcode ${value}`} className={`bg-card ${className}`} />;
}
