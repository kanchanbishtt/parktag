import React from "react";
import { AdminShell } from "./AdminShell.jsx";
import { OverviewScreen } from "./OverviewScreen.jsx";
import { EtagsScreen } from "./EtagsScreen.jsx";
import { IssuanceScreen } from "./IssuanceScreen.jsx";
import { PrintQueueScreen } from "./PrintQueueScreen.jsx";
import { OwnersScreen } from "./OwnersScreen.jsx";
import { ActivityScreen } from "./ActivityScreen.jsx";
import { AdminsScreen } from "./AdminsScreen.jsx";

const SCREENS = {
  overview: OverviewScreen,
  etags: EtagsScreen,
  issuance: IssuanceScreen,
  "print-queue": PrintQueueScreen,
  owners: OwnersScreen,
  activity: ActivityScreen,
  admins: AdminsScreen,
};

export function AdminConsoleApp({ initial = "overview" }) {
  const [page, setPage] = React.useState(initial);
  const Screen = SCREENS[page] || OverviewScreen;
  return (
    <AdminShell active={page} onNavigate={setPage}>
      <Screen onNavigate={setPage} />
    </AdminShell>
  );
}
