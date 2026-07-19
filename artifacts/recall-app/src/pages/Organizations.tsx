import { AppLayout } from "@/components/AppLayout";
import { OrganizationsPanel } from "@/components/OrganizationsPanel";

/**
 * Organizations & invoices now live as a tab on the People page (Sidebar
 * Consolidation). This standalone route is kept working — unlinked from the
 * nav — for anyone with an old bookmark/deep link.
 */
export function Organizations() {
  return (
    <AppLayout>
      <OrganizationsPanel />
    </AppLayout>
  );
}
