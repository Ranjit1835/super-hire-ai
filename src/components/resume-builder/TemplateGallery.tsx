import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Eye } from "lucide-react";
import { motion } from "framer-motion";
import {
  TEMPLATE_IDS,
  TEMPLATE_METADATA,
  TEMPLATE_CATEGORIES,
  type TemplateId,
  type TemplateCategory,
} from "@/lib/resume-builder-types";

interface TemplateGalleryProps {
  selected: TemplateId | null;
  onSelect: (id: TemplateId) => void;
  onPreview?: (id: TemplateId) => void;
}

export function TemplateGallery({ selected, onSelect, onPreview }: TemplateGalleryProps) {
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | "All">("All");

  const filtered =
    activeCategory === "All"
      ? TEMPLATE_IDS
      : TEMPLATE_IDS.filter((id) => TEMPLATE_METADATA[id].category === activeCategory);

  return (
    <div>
      {/* Category tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        {(["All", ...TEMPLATE_CATEGORIES] as const).map((cat) => (
          <Button
            key={cat}
            size="sm"
            variant={activeCategory === cat ? "default" : "outline"}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </Button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-1">
        {filtered.map((id, i) => {
          const meta = TEMPLATE_METADATA[id];
          const isSelected = selected === id;
          return (
            <motion.div
              key={id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02 }}
            >
              <Card
                className={`cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
                  isSelected ? "border-2 border-primary bg-primary/5" : "border-border hover:border-primary/40"
                }`}
                onClick={() => onSelect(id)}
              >
                <CardContent className="p-3">
                  {/* Placeholder preview block */}
                  <div className="h-20 bg-secondary/40 rounded-md mb-2 flex items-center justify-center relative">
                    <div className="space-y-1 w-3/4">
                      <div className="h-2 bg-muted-foreground/30 rounded" />
                      <div className="h-1.5 bg-muted-foreground/20 rounded w-3/4" />
                      <div className="h-1 bg-muted-foreground/15 rounded" />
                      <div className="h-1 bg-muted-foreground/15 rounded w-5/6" />
                    </div>
                    {isSelected && (
                      <CheckCircle2 className="absolute top-1.5 right-1.5 h-4 w-4 text-primary" />
                    )}
                    {meta.isNew && !isSelected && (
                      <Badge className="absolute top-1 right-1 text-[9px] px-1 py-0 bg-primary text-primary-foreground">New</Badge>
                    )}
                  </div>
                  <p className="text-xs font-semibold truncate">{meta.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{meta.description}</p>
                  {onPreview && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-1 h-6 text-[10px]"
                      onClick={(e) => { e.stopPropagation(); onPreview(id); }}
                    >
                      <Eye className="h-3 w-3 mr-1" /> Preview
                    </Button>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-3">{filtered.length} templates · Click to select</p>
    </div>
  );
}
