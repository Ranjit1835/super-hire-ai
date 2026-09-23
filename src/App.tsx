import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Landing from "./pages/Landing";
import { StudioNavBar } from "./components/StudioNavBar";
import { StudioFAB } from "./components/StudioFAB";
import { StudioOnboardingTooltip } from "./components/StudioOnboardingTooltip";

const Auth = lazy(() => import("./pages/Auth"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const OtpVerification = lazy(() => import("./pages/OtpVerification"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Analysis = lazy(() => import("./pages/Analysis"));
const FixResume = lazy(() => import("./pages/FixResume"));
const GuestAnalysis = lazy(() => import("./pages/GuestAnalysis"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const ResumeBuilder = lazy(() => import("./pages/ResumeBuilder"));
const MockInterview = lazy(() => import("./pages/MockInterview"));
const NotFound = lazy(() => import("./pages/NotFound"));
const CollegePlacement = lazy(() => import("./pages/CollegePlacement"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const ReelsCampaign = lazy(() => import("./pages/ReelsCampaign"));
const WeeklyStats = lazy(() => import("./pages/WeeklyStats"));
const VoiceInterview = lazy(() => import("./pages/VoiceInterview"));
const StudioPage = lazy(() => import("./features/studio/pages/StudioPage"));
const StudioPaywallPage = lazy(() => import("./features/studio/pages/StudioPaywallPage"));
const StudioSharedPage = lazy(() => import("./features/studio/pages/StudioSharedPage"));
const ATSChecker = lazy(() => import("./pages/ATSChecker"));
const Pricing = lazy(() => import("./pages/Pricing"));
const About = lazy(() => import("./pages/About"));
const Blog = lazy(() => import("./pages/Blog"));
const SuperAdminOrgs = lazy(() => import("./features/b2b/pages/SuperAdminOrgs"));
const SuperAdminCosts = lazy(() => import("./features/b2b/pages/SuperAdminCosts"));
const OrgLayout = lazy(() => import("./features/b2b/pages/OrgLayout").then((m) => ({ default: m.OrgLayout })));
const OrgRedirect = lazy(() => import("./features/b2b/pages/OrgLayout").then((m) => ({ default: m.OrgRedirect })));
const OrgOverview = lazy(() => import("./features/b2b/pages/OrgHome"));
const OrgInvites = lazy(() => import("./features/b2b/pages/OrgInvites"));
const OrgImport = lazy(() => import("./features/b2b/pages/OrgImport"));
const InviteAccept = lazy(() => import("./features/b2b/pages/InviteAccept"));
const OrgModules = lazy(() => import("./features/b2b/pages/OrgModules"));
const ModuleEditor = lazy(() => import("./features/b2b/pages/ModuleEditor"));
const OrgDashboard = lazy(() => import("./features/b2b/pages/OrgDashboard"));
const StudentDetail = lazy(() => import("./features/b2b/pages/StudentDetail"));
const LearnHome = lazy(() => import("./features/b2b/pages/LearnHome"));
const InterviewRoom = lazy(() => import("./features/b2b/pages/InterviewRoom"));
const StudentReport = lazy(() => import("./features/b2b/pages/StudentReport"));
// Dev-only in-memory preview of the demo dashboard (tree-shaken out of production builds).
const DemoPreview = import.meta.env.DEV ? lazy(() => import("./features/b2b/dev/DemoPreview")) : null;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    },
  },
});

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/verify-otp" element={<OtpVerification />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/analysis/guest/:token" element={<GuestAnalysis />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/analysis/:id" element={<ProtectedRoute><Analysis /></ProtectedRoute>} />
      <Route path="/fix/:id" element={<ProtectedRoute><FixResume /></ProtectedRoute>} />
      <Route path="/build-resume" element={<ProtectedRoute><ResumeBuilder /></ProtectedRoute>} />
      <Route path="/mock-interview" element={<ProtectedRoute><MockInterview /></ProtectedRoute>} />
      <Route path="/ats-checker" element={<ATSChecker />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/about" element={<About />} />
      <Route path="/blog" element={<Blog />} />
      <Route path="/college-placement" element={<CollegePlacement />} />
      <Route path="/leaderboard" element={<Leaderboard />} />
      <Route path="/reels-campaign" element={<ReelsCampaign />} />
      <Route path="/weekly-stats" element={<ProtectedRoute><WeeklyStats /></ProtectedRoute>} />
      <Route path="/voice-interview" element={<ProtectedRoute><VoiceInterview /></ProtectedRoute>} />
      <Route path="/studio" element={<ProtectedRoute><StudioPaywallPage /></ProtectedRoute>} />
      <Route path="/studio/:resumeId" element={<ProtectedRoute><StudioPage /></ProtectedRoute>} />
      <Route path="/studio/shared/:shareToken" element={<StudioSharedPage />} />
      {/* B2B: institutions */}
      <Route path="/admin/orgs" element={<ProtectedRoute><SuperAdminOrgs /></ProtectedRoute>} />
      <Route path="/admin/costs" element={<ProtectedRoute><SuperAdminCosts /></ProtectedRoute>} />
      <Route path="/org" element={<ProtectedRoute><OrgRedirect /></ProtectedRoute>} />
      <Route path="/org/:orgId" element={<ProtectedRoute><OrgLayout /></ProtectedRoute>}>
        <Route index element={<OrgOverview />} />
        <Route path="dashboard" element={<OrgDashboard />} />
        <Route path="students/:userId" element={<StudentDetail />} />
        <Route path="modules" element={<OrgModules />} />
        <Route path="modules/:moduleId" element={<ModuleEditor />} />
        <Route path="invites" element={<OrgInvites />} />
        <Route path="import" element={<OrgImport />} />
      </Route>
      <Route path="/invite/:token" element={<InviteAccept />} />
      <Route path="/learn" element={<ProtectedRoute><LearnHome /></ProtectedRoute>} />
      <Route path="/learn/interview/:moduleId" element={<ProtectedRoute><InterviewRoom /></ProtectedRoute>} />
      <Route path="/learn/report/:interviewId" element={<ProtectedRoute><StudentReport /></ProtectedRoute>} />
      {DemoPreview && <Route path="/dev/b2b-demo/*" element={<DemoPreview />} />}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ErrorBoundary>
            <StudioNavBar />
            <Suspense fallback={<PageLoader />}>
              <AppRoutes />
            </Suspense>
            <StudioFAB />
            <StudioOnboardingTooltip />
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
