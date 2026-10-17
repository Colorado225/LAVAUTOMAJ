import { useNavigate } from "react-router-dom"
import { Progress } from "@/components/ui/progress"
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
  onQuit: () => void
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
            <span key={s} className={i <= idx ? "font-medium text-foreground" : ""}>
              {STAGE_LABELS[s]}
            </span>
          ))}
          <span className="text-muted-foreground">Terminé</span>
        </div>
        <Progress value={percent} />
      </div>

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
    </div>
  )
}
