import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BasicInfo } from "@/lib/resume-builder-types";
import { User, Mail, Phone, Linkedin, Github } from "lucide-react";

interface Props {
  data: BasicInfo;
  onChange: (data: BasicInfo) => void;
}

export function StepBasicInfo({ data, onChange }: Props) {
  const update = (field: keyof BasicInfo, value: string) => {
    onChange({ ...data, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="flex items-center gap-1.5 mb-1.5">
          <User className="h-3.5 w-3.5" /> Full Name *
        </Label>
        <Input value={data.fullName} onChange={(e) => update("fullName", e.target.value)} placeholder="John Doe" />
      </div>
      <div>
        <Label className="flex items-center gap-1.5 mb-1.5">
          <Mail className="h-3.5 w-3.5" /> Email *
        </Label>
        <Input type="email" value={data.email} onChange={(e) => update("email", e.target.value)} placeholder="john@example.com" />
      </div>
      <div>
        <Label className="flex items-center gap-1.5 mb-1.5">
          <Phone className="h-3.5 w-3.5" /> Phone
        </Label>
        <Input value={data.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+91 98765 43210" />
      </div>
      <div>
        <Label className="flex items-center gap-1.5 mb-1.5">
          <Linkedin className="h-3.5 w-3.5" /> LinkedIn
        </Label>
        <Input value={data.linkedin} onChange={(e) => update("linkedin", e.target.value)} placeholder="linkedin.com/in/johndoe" />
      </div>
      <div>
        <Label className="flex items-center gap-1.5 mb-1.5">
          <Github className="h-3.5 w-3.5" /> GitHub
        </Label>
        <Input value={data.github} onChange={(e) => update("github", e.target.value)} placeholder="github.com/johndoe" />
      </div>
    </div>
  );
}
