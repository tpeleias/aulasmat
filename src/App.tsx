import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { VocabularyProvider } from "@/hooks/useVocabulary";
import { ThemeProvider } from "@/hooks/useTheme";
import Auth from "./pages/Auth";
import AndroidBackButton from "./components/AndroidBackButton";

// Cada tela vira um arquivo à parte: a vitrine e o login não baixam o app
// inteiro (antes, ~1,3 MB de uma vez). O login fica no pacote principal porque
// é a primeira tela de quase todo mundo.
const NotFound = lazy(() => import("./pages/NotFound"));
const PublicAvailability = lazy(() => import("./pages/PublicAvailability"));
const PublicHome = lazy(() => import("./pages/PublicHome"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfUse = lazy(() => import("./pages/TermsOfUse"));
const DeleteAccountInfo = lazy(() => import("./pages/DeleteAccountInfo"));
const MyAccount = lazy(() => import("./pages/MyAccount"));
const AdminLayout = lazy(() => import("./components/AdminLayout"));
const HomePage = lazy(() => import("./pages/admin/HomePage"));
const CalendarPage = lazy(() => import("./pages/admin/CalendarPage"));
const BlocksPage = lazy(() => import("./pages/admin/BlocksPage"));
const BillingPage = lazy(() => import("./pages/admin/BillingPage"));
const ReportsPage = lazy(() => import("./pages/admin/ReportsPage"));
const EvolutionPage = lazy(() => import("./pages/admin/EvolutionPage"));
const SettingsPage = lazy(() => import("./pages/admin/SettingsPage"));
const StudentsPage = lazy(() => import("./pages/admin/StudentsPage"));
const TeachersPage = lazy(() => import("./pages/admin/TeachersPage"));
const AssistantPage = lazy(() => import("./pages/admin/AssistantPage"));
const AccessPage = lazy(() => import("./pages/admin/AccessPage"));
const StudentLayout = lazy(() => import("./components/StudentLayout"));
const StudentDashboard = lazy(() => import("./pages/student/StudentDashboard"));
const StudentLessons = lazy(() => import("./pages/student/StudentLessons"));
const StudentBilling = lazy(() => import("./pages/student/StudentBilling"));
const StudentMaterials = lazy(() => import("./pages/student/StudentMaterials"));
const StudentHomework = lazy(() => import("./pages/student/StudentHomework"));
const StudentBooking = lazy(() => import("./pages/student/StudentBooking"));
const ChangePassword = lazy(() => import("./pages/student/ChangePassword"));
const ChildLayout = lazy(() => import("./components/ChildLayout"));
const ChildDashboard = lazy(() => import("./pages/child/ChildDashboard"));
const PlatformPage = lazy(() => import("./pages/platform/PlatformPage"));

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
          <Suspense fallback={null}>
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
          </Suspense>
        </VocabularyProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
    </MotionConfig>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
