import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Project } from "@/lib/resume-builder-types";
import { Plus, Trash2 } from "lucide-react";

interface Props {
  items: Project[];
  onChange: (items: Project[]) => void;
}

export function StepProjects({ items, onChange }: Props) {
  const update = (index: number, field: keyof Project, value: string) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const add = () => onChange([...items, { name: "", description: "", techStack: "" }]);
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-4">
      {items.map((item, i) => (
        <div key={i} className="p-4 border border-border rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Project {i + 1}</span>
            {items.length > 1 && (
              <Button variant="ghost" size="icon" onClick={() => remove(i)}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
          </div>
          <div>
            <Label className="mb-1 block text-xs">Project Name *</Label>
            <Input value={item.name} onChange={(e) => update(i, "name", e.target.value)} placeholder="E-Commerce Platform" />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Description *</Label>
            <Textarea value={item.description} onChange={(e) => update(i, "description", e.target.value)} placeholder="Built a full-stack e-commerce platform with..." rows={3} />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Tech Stack</Label>
            <Input value={item.techStack} onChange={(e) => update(i, "techStack", e.target.value)} placeholder="React, Node.js, PostgreSQL" />
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="h-4 w-4 mr-1" /> Add Project
      </Button>
    </div>
  );
}
