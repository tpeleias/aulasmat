import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import PublicAvailability from "./pages/PublicAvailability";
import AdminLayout from "./components/AdminLayout";
import CalendarPage from "./pages/admin/CalendarPage";
import BlocksPage from "./pages/admin/BlocksPage";
import BillingPage from "./pages/admin/BillingPage";
import SettingsPage from "./pages/admin/SettingsPage";
import AuditPage from "./pages/admin/AuditPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/disponibilidade" element={<PublicAvailability />} />
            <Route path="/disponibilidade/thiago" element={<PublicAvailability teacher="thiago" />} />
            <Route path="/disponibilidade/mayara" element={<PublicAvailability teacher="mayara" />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<CalendarPage />} />
              <Route path="bloqueios" element={<BlocksPage />} />
              <Route path="financeiro" element={<BillingPage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
              <Route path="auditoria" element={<AuditPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
