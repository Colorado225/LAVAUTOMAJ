import { useNavigate } from "react-router-dom"
import { AnimatePresence, motion } from "framer-motion"
import {
  STAGES,
  STAGE_LABELS,
  type OnboardingProgress,
} from "@/lib/onboarding-api"
import { StationStep } from "./station-step"
import { ServicesStep } from "./services-step"
import { WorkersStep } from "./workers-step"
import { PlanStep } from "./plan-step"
import { ReviewStep } from "./review-step"

export interface OnboardingWizardProps {
  progress: OnboardingProgress | null
  /** Appelé quand l'étape courante est enregistrée : recharge la progression. */
  onDone: () => void
  onQuit: () => void | Promise<void>
}

const STEP_INDEX = (stage: string) => Math.max(0, STAGES.indexOf(stage as (typeof STAGES)[number]))

export function OnboardingWizard({
  progress,
  onDone,
  onQuit,
}: OnboardingWizardProps) {
  const navigate = useNavigate()
  const stage = progress?.current_stage ?? "station"
  const idx = STEP_INDEX(stage)
  const percent = Math.round(((idx + 1) / (STAGES.length + 1)) * 100)

  const props: OnboardingWizardProps = { progress, onDone, onQuit }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">
          Configurez votre station
        </h1>
        <p className="text-muted-foreground">
          Étape {idx + 1} sur {STAGES.length + 1} — {STAGE_LABELS[stage] ?? "Station"}.
          Vous pouvez quitter à tout moment et reprendre plus tard.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          {STAGES.map((s, i) => (
            <span
              key={s}
              className={`transition-colors duration-300 ${
                i <= idx ? "font-medium text-foreground" : ""
              }`}
            >
              {STAGE_LABELS[s]}
            </span>
          ))}
          <span className="text-muted-foreground">Terminé</span>
        </div>
        {/* Barre de progression animée en `scaleX` : aucune reprise de mise en
            page, donc fluide même sur un téléphone d'entrée de gamme. */}
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progression de la configuration"
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="progress-fill h-full w-full rounded-full bg-primary"
            style={{ transform: `scaleX(${percent / 100})` }}
          />
        </div>
      </div>

      {/* Une étape remplace l'autre en glissant dans le sens de la navigation. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={stage}
          // L'assistant ne se parcourt que vers l'avant : l'étape suivante
          // entre par la droite, la précédente sort vers la gauche.
          initial={{ opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          {stage === "station" && <StationStep {...props} />}
          {stage === "services" && <ServicesStep {...props} />}
          {stage === "workers" && <WorkersStep {...props} />}
          {stage === "plan" && <PlanStep {...props} />}
          {stage === "review" && (
            <ReviewStep
              progress={progress}
              onDone={onDone}
              onQuit={onQuit}
              onCompleted={() => navigate("/dashboard")}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
