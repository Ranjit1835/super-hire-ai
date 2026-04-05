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
      <Route path="/college-placement" element={<CollegePlacement />} />
      <Route path="/leaderboard" element={<Leaderboard />} />
      <Route path="/reels-campaign" element={<ReelsCampaign />} />
      <Route path="/weekly-stats" element={<ProtectedRoute><WeeklyStats /></ProtectedRoute>} />
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
            <Suspense fallback={<PageLoader />}>
              <AppRoutes />
            </Suspense>
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
