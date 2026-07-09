import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RecallDataProvider } from "@/context/RecallDataContext";
import { AuthProvider } from "@/context/AuthContext";
import { RequireAuth } from "@/components/RequireAuth";
import { Dashboard } from "@/pages/Dashboard";
import { Notes } from "@/pages/Notes";
import { Notebooks } from "@/pages/Notebooks";
import { Tasks } from "@/pages/Tasks";
import { Canvas } from "@/pages/Canvas";
import { Inbox } from "@/pages/Inbox";
import { People } from "@/pages/People";
import { Connectors } from "@/pages/Connectors";
import { Projects } from "@/pages/Projects";
import { ProjectDetail } from "@/pages/ProjectDetail";
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

  return <>{children}</>;
}

function RedirectHome() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    normalizeBrowserPath();
    setLocation("/", { replace: true });
  }, [setLocation]);
  return null;
}

function Router() {
  return (
    <RequireAuth>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/notes" component={Notes} />
        <Route path="/notebooks" component={Notebooks} />
        <Route path="/inbox" component={Inbox} />
        <Route path="/people" component={People} />
        <Route path="/connectors" component={Connectors} />
        <Route path="/projects" component={Projects} />
        <Route path="/projects/:projectId" component={ProjectDetail} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/canvas" component={Canvas} />
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
