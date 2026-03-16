import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { User } from "lucide-react";

export function CreatorSection() {
  return (
    <section className="py-16 sm:py-20 px-4">
      <div className="container max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <Card className="glass">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-semibold mb-2">Built by Ranjith</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    "Hi, I'm Ranjith, a software engineer who noticed that many talented people lose job opportunities because their resumes fail ATS systems. HiResume was built to help job seekers understand and fix their resumes before applying."
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </section>
  );
}
