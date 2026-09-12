import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import PublicAvailability from "./pages/PublicAvailability";
import PublicHome from "./pages/PublicHome";
import AdminLayout from "./components/AdminLayout";
import HomePage from "./pages/admin/HomePage";
import CalendarPage from "./pages/admin/CalendarPage";
import OrganizationPage from "./pages/admin/OrganizationPage";
import BlocksPage from "./pages/admin/BlocksPage";
import BillingPage from "./pages/admin/BillingPage";
import SettingsPage from "./pages/admin/SettingsPage";
import AuditPage from "./pages/admin/AuditPage";
import StudentsPage from "./pages/admin/StudentsPage";
import TeachersPage from "./pages/admin/TeachersPage";
import AssistantPage from "./pages/admin/AssistantPage";
import AccessPage from "./pages/admin/AccessPage";
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
import AndroidBackButton from "./components/AndroidBackButton";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <MotionConfig reducedMotion="user">
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AndroidBackButton />
          <Routes>
            <Route path="/" element={<Auth />} />
            <Route path="/auth" element={<Navigate to="/" replace />} />
            <Route path="/trocar-senha" element={<ChangePassword />} />
            <Route path="/inicio" element={<PublicHome />} />
            <Route path="/disponibilidade" element={<PublicAvailability />} />
            <Route path="/disponibilidade/thiago" element={<PublicAvailability teacher="thiago" />} />
            <Route path="/disponibilidade/mayara" element={<PublicAvailability teacher="mayara" />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<HomePage />} />
              <Route path="agenda" element={<CalendarPage />} />
              <Route path="organizacao" element={<OrganizationPage />} />
              <Route path="bloqueios" element={<BlocksPage />} />
              <Route path="alunos" element={<StudentsPage />} />
              <Route path="professores" element={<TeachersPage />} />
              <Route path="assistente" element={<AssistantPage />} />
              <Route path="financeiro" element={<BillingPage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
              <Route path="acessos" element={<AccessPage />} />
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
    </MotionConfig>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
