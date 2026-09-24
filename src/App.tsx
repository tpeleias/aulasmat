import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { VocabularyProvider } from "@/hooks/useVocabulary";
import { ThemeProvider } from "@/hooks/useTheme";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import PublicAvailability from "./pages/PublicAvailability";
import PublicHome from "./pages/PublicHome";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfUse from "./pages/TermsOfUse";
import DeleteAccountInfo from "./pages/DeleteAccountInfo";
import MyAccount from "./pages/MyAccount";
import AdminLayout from "./components/AdminLayout";
import HomePage from "./pages/admin/HomePage";
import CalendarPage from "./pages/admin/CalendarPage";
import BlocksPage from "./pages/admin/BlocksPage";
import BillingPage from "./pages/admin/BillingPage";
import ReportsPage from "./pages/admin/ReportsPage";
import EvolutionPage from "./pages/admin/EvolutionPage";
import SettingsPage from "./pages/admin/SettingsPage";
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
import PlatformPage from "./pages/platform/PlatformPage";

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
        <VocabularyProvider>
          <AndroidBackButton />
          <Routes>
            <Route path="/" element={<Auth />} />
            <Route path="/auth" element={<Navigate to="/" replace />} />
            <Route path="/trocar-senha" element={<ChangePassword />} />
            <Route path="/inicio" element={<PublicHome />} />
            <Route path="/privacidade" element={<PrivacyPolicy />} />
            <Route path="/termos" element={<TermsOfUse />} />
            <Route path="/excluir-conta" element={<DeleteAccountInfo />} />
            <Route path="/minha-conta" element={<MyAccount />} />
            <Route path="/disponibilidade" element={<PublicAvailability />} />
            <Route path="/disponibilidade/:teacher" element={<PublicAvailability />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<HomePage />} />
              <Route path="agenda" element={<CalendarPage />} />
              {/* A Organização foi fundida no Financeiro. O endereço fica porque o widget
                  de cobrança de quem ainda está no app antigo abre ele. */}
              <Route path="organizacao" element={<Navigate to="/admin/financeiro" replace />} />
              <Route path="bloqueios" element={<BlocksPage />} />
              <Route path="alunos" element={<StudentsPage />} />
              <Route path="professores" element={<TeachersPage />} />
              <Route path="assistente" element={<AssistantPage />} />
              <Route path="financeiro" element={<BillingPage />} />
              <Route path="relatorios" element={<ReportsPage />} />
              <Route path="evolucao" element={<EvolutionPage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
              <Route path="acessos" element={<AccessPage />} />
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
            <Route path="/gestor" element={<PlatformPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </VocabularyProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
    </MotionConfig>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
