import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Certification } from "@/lib/resume-builder-types";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  items: Certification[];
  onChange: (items: Certification[]) => void;
}

export function StepCertifications({ items, onChange }: Props) {
  const update = (index: number, field: keyof Certification, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const add = () => onChange([...items, { name: "", issuer: "", year: "" }]);
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">This step is optional. Add certifications if you have any.</p>
      )}
      {items.map((item, i) => (
        <div key={i} className="p-4 border border-border rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Certification {i + 1}</span>
            <Button variant="ghost" size="icon" onClick={() => remove(i)}>
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Certification Name</Label>
            <Input value={item.name} onChange={(e) => update(i, "name", e.target.value)} placeholder="AWS Solutions Architect" />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Issuer</Label>
            <Input value={item.issuer} onChange={(e) => update(i, "issuer", e.target.value)} placeholder="Amazon Web Services" />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Year</Label>
            <Input value={item.year} onChange={(e) => update(i, "year", e.target.value)} placeholder="2024" />
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4 mr-1" /> Add Certification
      </Button>
    </div>
  );
}
