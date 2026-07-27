import { Suspense } from "react";

import { SettingsPanel } from "@/components/settings-panel";

export default function SettingsPage() {
  return (
    <Suspense>
      <SettingsPanel />
    </Suspense>
  );
}
