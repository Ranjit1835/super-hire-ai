import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Experience } from "@/lib/resume-builder-types";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  items: Experience[];
  onChange: (items: Experience[]) => void;
}

export function StepExperience({ items, onChange }: Props) {
  const update = (index: number, field: keyof Experience, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const add = () => onChange([...items, { company: "", role: "", duration: "", responsibilities: "" }]);
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">This step is optional. Add work experience if you have any.</p>
      )}
      {items.map((item, i) => (
        <div key={i} className="p-4 border border-border rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Experience {i + 1}</span>
            <Button variant="ghost" size="icon" onClick={() => remove(i)}>
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Company</Label>
            <Input value={item.company} onChange={(e) => update(i, "company", e.target.value)} placeholder="Google" />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Role</Label>
            <Input value={item.role} onChange={(e) => update(i, "role", e.target.value)} placeholder="Software Engineer" />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Duration</Label>
            <Input value={item.duration} onChange={(e) => update(i, "duration", e.target.value)} placeholder="Jan 2023 - Present" />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Responsibilities</Label>
            <Textarea value={item.responsibilities} onChange={(e) => update(i, "responsibilities", e.target.value)} placeholder="Developed RESTful APIs serving 10K+ daily users..." rows={3} />
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4 mr-1" /> Add Experience
      </Button>
    </div>
  );
}
