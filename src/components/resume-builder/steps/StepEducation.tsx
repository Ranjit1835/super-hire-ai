import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Education } from "@/lib/resume-builder-types";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  items: Education[];
  onChange: (items: Education[]) => void;
}

export function StepEducation({ items, onChange }: Props) {
  const update = (index: number, field: keyof Education, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const add = () => onChange([...items, { degree: "", college: "", year: "" }]);
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      {items.map((item, i) => (
        <div key={i} className="p-4 border border-border rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Education {i + 1}</span>
            {items.length > 1 && (
              <Button variant="ghost" size="icon" onClick={() => remove(i)}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
          </div>
          <div>
            <Label className="mb-1 block text-xs">Degree *</Label>
            <Input value={item.degree} onChange={(e) => update(i, "degree", e.target.value)} placeholder="B.Tech Computer Science" />
          </div>
          <div>
            <Label className="mb-1 block text-xs">College *</Label>
            <Input value={item.college} onChange={(e) => update(i, "college", e.target.value)} placeholder="IIT Bombay" />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Year</Label>
            <Input value={item.year} onChange={(e) => update(i, "year", e.target.value)} placeholder="2020 - 2024" />
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4 mr-1" /> Add Education
      </Button>
    </div>
  );
}
