import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function StepSummary({ value, onChange }: Props) {
  return (
    <div>
      <Label className="mb-1.5 block">Professional Summary *</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="A passionate software engineer with 2+ years of experience building web applications..."
        rows={5}
        maxLength={1000}
      />
      <p className="text-xs text-muted-foreground mt-1">{value.length}/1000 characters. AI will enhance this.</p>
    </div>
  );
}
