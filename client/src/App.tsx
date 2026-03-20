import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import DashboardLayout from "./components/DashboardLayout";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import GenerateKey from "./pages/GenerateKey";
import KeyList from "./pages/KeyList";
import VerifyKey from "./pages/VerifyKey";
import AccountManagement from "./pages/AccountManagement";
import CustomerManagement from "./pages/CustomerManagement";
import MacReader from "./pages/MacReader";
import SensorTypeManagement from "./pages/SensorTypeManagement";
import OfflineKeyGen from "./pages/OfflineKeyGen";
import ApiDocs from "./pages/ApiDocs";
import Login from "./pages/Login";
import { useAuth } from "./_core/hooks/useAuth";
import { Loader2 } from "lucide-react";

function AuthenticatedRouter() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/generate"} component={GenerateKey} />
        <Route path={"/keys"} component={KeyList} />
        <Route path={"/verify"} component={VerifyKey} />
        <Route path={"/accounts"} component={AccountManagement} />
        <Route path={"/customers"} component={CustomerManagement} />
        <Route path={"/sensor-types"} component={SensorTypeManagement} />
        <Route path={"/offline-keys"} component={OfflineKeyGen} />
        <Route path={"/mac-reader"} component={MacReader} />
        <Route path={"/api-docs"} component={ApiDocs} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function AppRouter() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path={"/login"} component={Login} />
        {/* 未登录时所有路由都显示登录页 */}
        <Route><Login /></Route>
      </Switch>
    );
  }

  return <AuthenticatedRouter />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <AppRouter />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
