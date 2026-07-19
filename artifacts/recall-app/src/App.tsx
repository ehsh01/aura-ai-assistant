import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Fragment, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RecallDataProvider } from "@/context/RecallDataContext";
import { AuthProvider } from "@/context/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { Dashboard } from "@/pages/Dashboard";
import { Today } from "@/pages/Today";
import { Notes } from "@/pages/Notes";
import { Tasks } from "@/pages/Tasks";
import { Canvas } from "@/pages/Canvas";
import { Inbox } from "@/pages/Inbox";
import { People } from "@/pages/People";
import { Vehicles } from "@/pages/Vehicles";
import { Organizations } from "@/pages/Organizations";
import { Connectors } from "@/pages/Connectors";
import { Projects } from "@/pages/Projects";
import { ProjectDetail } from "@/pages/ProjectDetail";
import { Documents } from "@/pages/Documents";
import { Memory } from "@/pages/Memory";
import { Activity } from "@/pages/Activity";
import { Settings } from "@/pages/Settings";
import { PrivacyPolicy } from "@/pages/Privacy";
import { TermsOfService } from "@/pages/Terms";
import { normalizeBrowserPath, pathnameOnly } from "@/lib/app-path";

const queryClient = new QueryClient();

function RouteNormalizer({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    normalizeBrowserPath();
    const path = pathnameOnly();
    if (location !== path) {
      setLocation(path, { replace: true });
    }
  }, [location, setLocation]);

  const path = pathnameOnly();
  if (location !== path) {
    return null;
  }

  // Key by location so nested routes re-render even when parents bail out on
  // stable children element references (Sign in → /login must remount auth gate).
  return <Fragment key={location}>{children}</Fragment>;
}

function RedirectHome() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    normalizeBrowserPath();
    setLocation("/", { replace: true });
  }, [setLocation]);
  return null;
}

/** Notebooks folded into Notes — old /notebooks bookmarks land on the Notes list. */
function RedirectToNotes() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    normalizeBrowserPath();
    setLocation("/notes", { replace: true });
  }, [setLocation]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/privacy" component={PrivacyPolicy} />
      <Route path="/terms" component={TermsOfService} />
      {/* /login is handled inside RequireAuth when signed out */}
      <Route>
        <AuthedRoutes />
      </Route>
    </Switch>
  );
}

function AuthedRoutes() {
  return (
    <RequireAuth>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/today" component={Today} />
        {/* Threads folded into Home — old /ask deep links (askPath()) still land on the same oracle UI. */}
        <Route path="/ask" component={Dashboard} />
        <Route path="/notes" component={Notes} />
        <Route path="/notebooks" component={RedirectToNotes} />
        <Route path="/inbox" component={Inbox} />
        <Route path="/documents" component={Documents} />
        {/* Knowledge folded into Notes — old /knowledge bookmarks land there too. */}
        <Route path="/knowledge" component={RedirectToNotes} />
        <Route path="/memory" component={Memory} />
        <Route path="/people" component={People} />
        <Route path="/vehicles" component={Vehicles} />
        <Route path="/organizations" component={Organizations} />
        <Route path="/activity" component={Activity} />
        <Route path="/connectors" component={Connectors} />
        <Route path="/settings" component={Settings} />
        <Route path="/projects" component={Projects} />
        <Route path="/projects/:projectId" component={ProjectDetail} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/canvas" component={Canvas} />
        {/* Signed-in users hitting /login land on Home */}
        <Route path="/login" component={RedirectHome} />
        <Route component={RedirectHome} />
      </Switch>
    </RequireAuth>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <RecallDataProvider>
            <TooltipProvider>
              <RouteNormalizer>
                <Router />
              </RouteNormalizer>
              <Toaster />
            </TooltipProvider>
          </RecallDataProvider>
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
