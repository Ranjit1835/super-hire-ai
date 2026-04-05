import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Download, ImageIcon } from "lucide-react";

interface ScoreCardProps {
  score: number;
  fileName?: string;
}

export function ScoreCardDownload({ score, fileName }: ScoreCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const generateAndDownload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 628;
    const ctx = canvas.getContext("2d")!;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 1200, 628);
    bg.addColorStop(0, "#0a0a1a");
    bg.addColorStop(0.5, "#12103a");
    bg.addColorStop(1, "#0a1628");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1200, 628);

    // Grid lines (subtle)
    ctx.strokeStyle = "rgba(139, 92, 246, 0.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x < 1200; x += 60) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 628); ctx.stroke();
    }
    for (let y = 0; y < 628; y += 60) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke();
    }

    // Glow circle behind score
    const glow = ctx.createRadialGradient(600, 280, 0, 600, 280, 200);
    glow.addColorStop(0, "rgba(139, 92, 246, 0.3)");
    glow.addColorStop(1, "rgba(139, 92, 246, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1200, 628);

    // Score arc
    const cx = 600, cy = 290, radius = 150;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI * 0.75, Math.PI * 2.25);
    ctx.stroke();

    const scoreAngle = (score / 100) * Math.PI * 1.5;
    const scoreColor = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";
    const grad = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
    grad.addColorStop(0, "#8b5cf6");
    grad.addColorStop(1, scoreColor);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 16;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI * 0.75, Math.PI * 0.75 + scoreAngle);
    ctx.stroke();

    // Score number
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 96px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(score), cx, cy);

    // "/100" sub text
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "28px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("/ 100", cx, cy + 60);

    // Label above score
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("ATS SCORE", cx, cy - 130);

    // Rating label
    const rating = score >= 80 ? "Strong & Market Ready ✓" :
      score >= 60 ? "Competitive but Optimizable" :
      score >= 40 ? "Needs Strategic Improvement" : "High Risk – Immediate Fix Required";
    const ratingColor = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";
    ctx.fillStyle = ratingColor;
    ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText(rating, cx, cy + 110);

    // Brand name top left
    ctx.textAlign = "left";
    ctx.fillStyle = "#8b5cf6";
    ctx.font = "bold 32px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("HireResume", 60, 60);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("AI Resume Checker", 60, 90);

    // URL bottom
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("Check your resume free → hiresume.in", 600, 590);

    // CTA badge bottom right
    const badgeBg = ctx.createLinearGradient(900, 550, 1140, 610);
    badgeBg.addColorStop(0, "#7c3aed");
    badgeBg.addColorStop(1, "#2563eb");
    ctx.fillStyle = badgeBg;
    ctx.roundRect(900, 555, 240, 44, 22);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.fillText("Check Yours Free →", 1020, 578);

    // Download
    const link = document.createElement("a");
    link.download = `hiresume-score-${score}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <Button variant="outline" size="sm" onClick={generateAndDownload} className="gap-2 border-purple-500/40 text-purple-400 hover:bg-purple-500/10">
      <ImageIcon className="h-4 w-4" />
      Download Score Card
    </Button>
  );
}
