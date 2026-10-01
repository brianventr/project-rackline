import { Route, Routes } from "react-router-dom";
import { ReturnLabelPage } from "./ReturnLabelPage";
import { TrackingPage } from "./TrackingPage";

/** Pages a customer opens from a link. They render without `/api/me` or a sign-in. */
export function isPublicPath(pathname: string): boolean {
  return /^\/[tr]\/[^/]+\/?$/.test(pathname);
}

export function PublicRoutes() {
  return (
    <Routes>
      <Route path="/t/:token" element={<TrackingPage />} />
      <Route path="/r/:token" element={<ReturnLabelPage />} />
    </Routes>
  );
}
