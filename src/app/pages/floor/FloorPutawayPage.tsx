import { useSearchParams } from "react-router-dom";
import { MovePage } from "../MovePage";
import { FloorTransferPage } from "./FloorTransferPage";

export function FloorPutawayPage() {
  const [params] = useSearchParams();
  if (params.get("id")) return <FloorTransferPage />;
  return <MovePage />;
}
