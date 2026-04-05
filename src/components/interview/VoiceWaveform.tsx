import { memo } from "react";

interface VoiceWaveformProps {
  isActive: boolean;
  label?: string;
}

export const VoiceWaveform = memo(function VoiceWaveform({ isActive, label }: VoiceWaveformProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-end gap-1 h-8">
        {[0.4, 0.7, 1, 0.7, 0.4].map((scale, i) => (
          <div
            key={i}
            className="w-1.5 rounded-full bg-primary animate-pulse-glow"
            style={{
              height: isActive ? `${scale * 32}px` : "8px",
              animationDelay: `${i * 0.12}s`,
              transition: "height 0.2s ease",
              opacity: isActive ? 1 : 0.4,
            }}
          />
        ))}
      </div>
      {label && (
        <p className="text-xs text-muted-foreground">{label}</p>
      )}
    </div>
  );
});
