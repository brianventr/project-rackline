import { Link } from "react-router-dom";
import { PageHeader } from "../../components/ui";

export function LabelsSetupPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Setup"
        title="Labels"
        description="Location barcodes print from the Locations page. Item barcodes default to the SKU and can be overridden on the item record."
      />
      <ul className="list-disc space-y-2 pl-5 text-sm">
        <li>
          <Link className="underline" to="/stock/locations">
            Print bay labels
          </Link>
        </li>
        <li>
          Scan prefixes: <span className="font-mono">LOC:</span>, <span className="font-mono">SKU:</span>,{" "}
          <span className="font-mono">ORD:</span>, <span className="font-mono">RCP:</span>, <span className="font-mono">WO:</span>
        </li>
        <li>USB and Bluetooth gun scanners work on every screen. Camera scan is in the header when the browser supports it.</li>
      </ul>
    </div>
  );
}
