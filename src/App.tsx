import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import PublicAvailability from "./pages/PublicAvailability";
import SeatingMap from "./pages/SeatingMap";
import AdminLayout from "./components/AdminLayout";
import CalendarPage from "./pages/admin/CalendarPage";
import BlocksPage from "./pages/admin/BlocksPage";
import BillingPage from "./pages/admin/BillingPage";
import SettingsPage from "./pages/admin/SettingsPage";
import AuditPage from "./pages/admin/AuditPage";
import StudentsPage from "./pages/admin/StudentsPage";
import TeachersPage from "./pages/admin/TeachersPage";
import StudentLayout from "./components/StudentLayout";
import StudentDashboard from "./pages/student/StudentDashboard";
import StudentLessons from "./pages/student/StudentLessons";
import StudentBilling from "./pages/student/StudentBilling";
import StudentMaterials from "./pages/student/StudentMaterials";
import StudentHomework from "./pages/student/StudentHomework";
import StudentBooking from "./pages/student/StudentBooking";
import ChangePassword from "./pages/student/ChangePassword";
import ChildLayout from "./components/ChildLayout";
import ChildDashboard from "./pages/child/ChildDashboard";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Auth />} />
            <Route path="/auth" element={<Navigate to="/" replace />} />
            <Route path="/trocar-senha" element={<ChangePassword />} />
            <Route path="/disponibilidade" element={<PublicAvailability />} />
            <Route path="/disponibilidade/thiago" element={<PublicAvailability teacher="thiago" />} />
            <Route path="/disponibilidade/mayara" element={<PublicAvailability teacher="mayara" />} />
            <Route path="/mapa-sala" element={<SeatingMap />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<CalendarPage />} />
              <Route path="bloqueios" element={<BlocksPage />} />
              <Route path="alunos" element={<StudentsPage />} />
              <Route path="professores" element={<TeachersPage />} />
              <Route path="financeiro" element={<BillingPage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
              <Route path="auditoria" element={<AuditPage />} />
            </Route>
            <Route path="/aluno" element={<StudentLayout />}>
              <Route index element={<StudentDashboard />} />
              <Route path="aulas" element={<StudentLessons />} />
              <Route path="agendar" element={<StudentBooking />} />
              <Route path="financeiro" element={<StudentBilling />} />
              <Route path="materiais" element={<StudentMaterials />} />
              <Route path="tarefas" element={<StudentHomework />} />
            </Route>
            <Route path="/meu-painel" element={<ChildLayout />}>
              <Route index element={<ChildDashboard />} />
              <Route path="aulas" element={<StudentLessons />} />
              <Route path="materiais" element={<StudentMaterials />} />
              <Route path="tarefas" element={<StudentHomework />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
