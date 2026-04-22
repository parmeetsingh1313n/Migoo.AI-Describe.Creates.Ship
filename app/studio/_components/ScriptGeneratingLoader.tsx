import { Loader2, CheckCircle, Globe } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
  hasDocument: boolean;
  hasTopic: boolean;
}

export default function ScriptGeneratingLoader({ hasDocument, hasTopic }: Props) {
  // We don't have real-time progress, so we display a static two-step UI.
  // The first step (Web research) is shown as completed with a check.
  // The second step (Script generation) shows a spinner.
  return (
    <motion.div
      className="flex flex-col items-center justify-center py-20 gap-6"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
    >
      {/* Step 1: Web research */}
      <div className="flex items-center gap-3 text-foreground">
        <CheckCircle className="w-6 h-6 text-green-500" />
        <span className="font-medium">Web research completed</span>
      </div>

      {/* Step 2: Script generation */}
      <div className="flex items-center gap-3 text-foreground">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
        <span className="font-medium">Migoo Engine is writing your script…</span>
      </div>
    </motion.div>
  );
}
