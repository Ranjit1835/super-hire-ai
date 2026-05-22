import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Lightbulb, MessageSquare, Loader2 } from "lucide-react";
import { ChatPanel } from "../components/ChatPanel/ChatPanel";
import { PreviewPanel } from "../components/PreviewPanel/PreviewPanel";
import { VersionSidebar } from "../components/VersionHistory/VersionSidebar";
import { SuggestionsList } from "../components/SuggestionsTab/SuggestionsList";
import { useStudioSession } from "../hooks/useStudioSession";
import { useChatStream } from "../hooks/useChatStream";
import { useVersionHistory } from "../hooks/useVersionHistory";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { PersonaId, StudioTemplateId, StudioSuggestion, ResumeJSON } from "../types/studio.types";

function StudioPage() {
  const { resumeId } = useParams<{ resumeId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const {
    resume,
    session,
    messages,
    suggestions,
    loading,
    error,
    isPaidSession,
    isExpired,
    messagesRemaining,
    addMessage,
    updateResume,
    updateSession,
    updateTemplate,
    updatePersona,
    markSuggestionApplied,
  } = useStudioSession(resumeId);

  const { versions, loading: versionsLoading, loadVersions, revertToVersion } = useVersionHistory(resumeId);

  const [showVersions, setShowVersions] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [mobileTab, setMobileTab] = useState<"chat" | "preview">("chat");
  const [sidePanel, setSidePanel] = useState<"chat" | "suggestions">("chat");

  const {
    sendMessage,
    isStreaming,
    streamingContent,
    pendingChanges,
  } = useChatStream({
    sessionId: session?.id,
    persona: (resume?.persona as string) || "big-tech",
    currentJson: resume?.current_json,
    onResumeUpdate: updateResume,
    onMessageAdd: addMessage,
    onSessionUpdate: updateSession,
    onFreeLimitReached: () => setShowPaywall(true),
  });

  const handlePersonaChange = useCallback(
    (persona: PersonaId) => {
      updatePersona(persona);
    },
    [updatePersona]
  );

  const handleTemplateChange = useCallback(
    (templateId: StudioTemplateId) => {
      updateTemplate(templateId);
    },
    [updateTemplate]
  );

  const handleDownloadPdf = useCallback(() => {
    // TODO: integrate existing PDF generator
    toast({ title: "PDF Export", description: "Generating your resume PDF..." });
  }, [toast]);

  const handleShare = useCallback(async () => {
    if (!resumeId) return;
    try {
      const { data } = await supabase.functions.invoke("studio-share-link", {
        body: { action: "create", resumeId },
      });
      if (data?.shareUrl) {
        await navigator.clipboard.writeText(data.shareUrl);
        toast({ title: "Link copied!", description: "Share link copied to clipboard" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to generate share link", variant: "destructive" });
    }
  }, [resumeId, toast]);

  const handleRevert = useCallback(
    async (versionId: string) => {
      const reverted = await revertToVersion(versionId);
      if (reverted) {
        updateResume(reverted);
        toast({ title: "Reverted", description: "Resume reverted to selected version" });
      }
    },
    [revertToVersion, updateResume, toast]
  );

  const handleApplySuggestion = useCallback(
    async (suggestion: StudioSuggestion) => {
      try {
        const { data } = await supabase.functions.invoke("studio-apply-suggestion", {
          body: { suggestionId: suggestion.id },
        });
        if (data?.chatPrompt) {
          markSuggestionApplied(suggestion.id);
          sendMessage(data.chatPrompt);
          setSidePanel("chat");
        }
      } catch {
        toast({ title: "Error", description: "Failed to apply suggestion", variant: "destructive" });
      }
    },
    [sendMessage, markSuggestionApplied, toast]
  );

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
          <p className="text-sm text-slate-400">Loading Resume Studio...</p>
        </motion.div>
      </div>
    );
  }

  if (error || !resume) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error || "Resume not found"}</p>
          <button
            onClick={() => navigate("/studio")}
            className="text-sm text-violet-400 hover:text-violet-300"
          >
            Back to Studio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0f] overflow-hidden">
      {/* Top bar */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-sm z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-sm font-semibold text-white">{resume.title}</h1>
            <p className="text-[10px] text-slate-500">Resume Studio</p>
          </div>
        </div>

        {/* Mobile tab switcher */}
        <div className="flex md:hidden items-center gap-1 bg-white/5 rounded-lg p-0.5">
          <button
            onClick={() => setMobileTab("chat")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              mobileTab === "chat" ? "bg-violet-600 text-white" : "text-slate-400"
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setMobileTab("preview")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              mobileTab === "preview" ? "bg-violet-600 text-white" : "text-slate-400"
            }`}
          >
            Preview
          </button>
        </div>

        {/* Desktop: side panel toggle */}
        <div className="hidden md:flex items-center gap-1">
          {suggestions.length > 0 && (
            <button
              onClick={() => setSidePanel(sidePanel === "suggestions" ? "chat" : "suggestions")}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                sidePanel === "suggestions"
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              <span>{suggestions.length}</span>
            </button>
          )}
        </div>
      </header>

      {/* Main content — split screen */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: Chat panel (40%) */}
        <div
          className={`flex-shrink-0 border-r border-white/5 overflow-hidden ${
            mobileTab === "chat" ? "flex" : "hidden"
          } md:flex flex-col`}
          style={{ width: "clamp(320px, 40%, 500px)" }}
        >
          {sidePanel === "chat" ? (
            <ChatPanel
              messages={messages}
              persona={(resume.persona as PersonaId) || "big-tech"}
              onPersonaChange={handlePersonaChange}
              onSendMessage={sendMessage}
              isStreaming={isStreaming}
              streamingContent={streamingContent}
              resumeJson={resume.current_json}
              messagesRemaining={messagesRemaining}
              isPaid={isPaidSession}
              isExpired={isExpired}
              expiresAt={session?.expires_at}
              onUpgradeClick={() => setShowPaywall(true)}
            />
          ) : (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-semibold text-white">Smart Suggestions</span>
                </div>
                <button
                  onClick={() => setSidePanel("chat")}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"
                >
                  <MessageSquare className="w-3 h-3" />
                  Chat
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <SuggestionsList suggestions={suggestions} onApply={handleApplySuggestion} />
              </div>
            </div>
          )}
        </div>

        {/* Right: Preview panel (60%) */}
        <div
          className={`flex-1 overflow-hidden relative ${
            mobileTab === "preview" ? "flex" : "hidden"
          } md:flex flex-col`}
        >
          <PreviewPanel
            currentJson={resume.current_json}
            originalJson={resume.parsed_json}
            templateId={(resume.template_id as StudioTemplateId) || "classic-ats"}
            pendingChanges={pendingChanges}
            onTemplateChange={handleTemplateChange}
            onDownloadPdf={handleDownloadPdf}
            onToggleVersions={() => setShowVersions(!showVersions)}
            onShare={handleShare}
            showVersions={showVersions}
          />

          {/* Version History Sidebar */}
          <VersionSidebar
            versions={versions}
            loading={versionsLoading}
            open={showVersions}
            onClose={() => setShowVersions(false)}
            onRevert={handleRevert}
            onLoad={loadVersions}
          />
        </div>
      </div>

      {/* Paywall modal */}
      {showPaywall && (
        <StudioPaywallModal
          resumeId={resumeId!}
          onClose={() => setShowPaywall(false)}
          onSuccess={() => {
            setShowPaywall(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

// Inline paywall modal
function StudioPaywallModal({
  resumeId,
  onClose,
  onSuccess,
}: {
  resumeId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [processing, setProcessing] = useState(false);

  const plans = [
    { id: "single" as const, name: "Studio Pass", price: 299, duration: "24 hours", model: "Claude Haiku 4.5", paymentType: "STUDIO_SINGLE", badge: "" },
    { id: "weekly" as const, name: "Pro Pass", price: 599, duration: "7 days", model: "Claude Sonnet 4.6", paymentType: "STUDIO_WEEKLY", badge: "RECOMMENDED" },
    { id: "yearly" as const, name: "Unlimited", price: 2499, duration: "1 year", model: "Claude Sonnet 4.6", paymentType: "STUDIO_YEARLY", badge: "BEST VALUE" },
  ];

  const handlePurchase = async (plan: typeof plans[0]) => {
    setProcessing(true);
    try {
      // Create payment order
      const { data: orderData, error: orderErr } = await supabase.functions.invoke("create-payment-order", {
        body: { paymentType: plan.paymentType },
      });
      if (orderErr || !orderData?.orderId) throw new Error("Failed to create order");

      // Load Razorpay
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      document.body.appendChild(script);

      await new Promise((resolve) => { script.onload = resolve; });

      const options = {
        key: orderData.keyId,
        amount: orderData.amount,
        currency: "INR",
        name: "HireResume.in",
        description: `Resume Studio ${plan.name}`,
        order_id: orderData.orderId,
        handler: async (response: any) => {
          // Create session
          const { error } = await supabase.functions.invoke("studio-create-session", {
            body: {
              action: "create-paid",
              resumeId,
              passType: plan.id,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            },
          });
          if (error) {
            toast({ title: "Error", description: "Payment verified but session creation failed", variant: "destructive" });
          } else {
            toast({ title: "Welcome to Studio!", description: `Your ${plan.name} is now active` });
            onSuccess();
          }
        },
        theme: { color: "#8B5CF6" },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-[#14141f] border border-white/10 rounded-2xl p-6 max-w-lg w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-white mb-1">Upgrade Resume Studio</h2>
        <p className="text-sm text-slate-400 mb-6">Unlock unlimited AI-powered resume editing</p>

        <div className="space-y-3">
          {plans.map((plan) => (
            <button
              key={plan.id}
              disabled={processing}
              onClick={() => handlePurchase(plan)}
              className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left ${
                plan.badge === "RECOMMENDED"
                  ? "border-violet-500/50 bg-violet-500/5 hover:bg-violet-500/10"
                  : "border-white/10 hover:border-white/20 hover:bg-white/5"
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{plan.name}</span>
                  {plan.badge && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      plan.badge === "RECOMMENDED"
                        ? "bg-violet-500/20 text-violet-300"
                        : "bg-cyan-500/20 text-cyan-300"
                    }`}>
                      {plan.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{plan.duration} · {plan.model}</p>
              </div>
              <div className="text-right">
                <span className="text-lg font-bold text-white">₹{plan.price}</span>
              </div>
            </button>
          ))}
        </div>

        <button onClick={onClose} className="w-full mt-4 text-xs text-slate-500 hover:text-slate-300 py-2">
          Continue with free trial
        </button>
      </motion.div>
    </motion.div>
  );
}

export default StudioPage;
