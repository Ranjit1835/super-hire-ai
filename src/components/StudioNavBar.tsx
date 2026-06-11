import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Zap, Menu, X, Home, FileText, Mic, Trophy } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PulseDot } from "@/components/premium";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: Home, authOnly: true },
  { href: "/build-resume", label: "Builder", icon: FileText, authOnly: true },
  { href: "/voice-interview", label: "Interview", icon: Mic, authOnly: true },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy, authOnly: false },
];

export function StudioNavBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Don't show on studio editor pages, auth pages, or landing
  // Hide on pages that have their own nav/header
  const hideOn = ["/studio/", "/auth", "/verify-otp", "/reset-password", "/auth/callback", "/ats-checker", "/pricing", "/about", "/blog", "/college-placement", "/leaderboard", "/reels-campaign"];
  if (location.pathname === "/") return null;
  if (hideOn.some((p) => location.pathname.startsWith(p))) return null;
  if (/^\/studio\/[a-f0-9-]+$/.test(location.pathname)) return null;

  const visibleLinks = NAV_LINKS.filter((l) => !l.authOnly || user);
  const isActivePath = (href: string) => location.pathname === href;

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-[60] glass-strong border-b border-violet-500/10">
        <div className="container max-w-6xl mx-auto flex items-center justify-between h-12 px-4">
          {/* Logo */}
          <button
            onClick={() => navigate(user ? "/dashboard" : "/")}
            className="flex items-center gap-2 group"
          >
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-600 to-cyan-600 flex items-center justify-center shadow-lg shadow-violet-500/20 group-hover:shadow-violet-500/30 transition-shadow">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-sm text-foreground tracking-tight">HireResume</span>
          </button>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-1">
            {visibleLinks.map((link) => {
              const active = isActivePath(link.href);
              return (
                <button
                  key={link.href}
                  onClick={() => navigate(link.href)}
                  className={`relative px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    active ? "text-foreground bg-white/8" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  {link.label}
                  {active && (
                    <motion.div
                      layoutId="nav-active-indicator"
                      className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-gradient-to-r from-violet-500 to-cyan-500"
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  )}
                </button>
              );
            })}

            {/* Studio CTA — highlighted */}
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate("/studio")}
              className="relative ml-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-violet-500/30 text-violet-300 hover:bg-violet-500/10 hover:border-violet-500/50 transition-all"
            >
              <Sparkles className="w-3 h-3" />
              <span>Studio</span>
              <PulseDot color="#8B5CF6" size={5} className="ml-0.5" />
              <motion.span
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="ml-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r from-violet-500 to-cyan-500 text-white"
              >
                NEW
              </motion.span>
            </motion.button>
          </div>

          {/* Mobile: Studio + hamburger */}
          <div className="flex md:hidden items-center gap-2">
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate("/studio")}
              className="relative flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-violet-500/30 text-violet-300 hover:bg-violet-500/10"
            >
              <Sparkles className="w-3 h-3" />
              <span>Studio</span>
              <PulseDot color="#8B5CF6" size={4} className="ml-0.5" />
            </motion.button>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
            >
              {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="fixed top-12 left-0 right-0 z-[59] glass-strong border-b border-violet-500/10 shadow-2xl md:hidden"
          >
            <div className="p-3 space-y-1">
              {/* Studio highlight */}
              <button
                onClick={() => { navigate("/studio"); setMobileOpen(false); }}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-violet-600/10 to-cyan-600/10 border border-violet-500/20"
              >
                <Sparkles className="w-4 h-4 text-violet-400" />
                <div className="text-left flex-1">
                  <span className="text-sm font-semibold text-foreground">Resume Studio</span>
                  <p className="text-[10px] text-muted-foreground">Chat with AI to edit your resume</p>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-gradient-to-r from-violet-500 to-cyan-500 text-white">
                  NEW
                </span>
              </button>

              {visibleLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <button
                    key={link.href}
                    onClick={() => { navigate(link.href); setMobileOpen(false); }}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors ${
                      isActivePath(link.href) ? "text-foreground bg-violet-500/10" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="text-sm">{link.label}</span>
                  </button>
                );
              })}

              {!user && (
                <button
                  onClick={() => { navigate("/auth"); setMobileOpen(false); }}
                  className="w-full p-3 rounded-xl text-sm font-medium text-violet-400 hover:bg-violet-500/5 transition-colors text-center"
                >
                  Sign In
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spacer */}
      <div className="h-12" />
    </>
  );
}
