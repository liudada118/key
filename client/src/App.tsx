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

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/generate"} component={GenerateKey} />
        <Route path={"/keys"} component={KeyList} />
        <Route path={"/verify"} component={VerifyKey} />
        <Route path={"/accounts"} component={AccountManagement} />
        <Route path={"/customers"} component={CustomerManagement} />
        <Route path={"/mac-reader"} component={MacReader} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
