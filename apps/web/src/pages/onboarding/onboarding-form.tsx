import { useForm } from "@tanstack/react-form";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, LoaderCircle } from "lucide-react";

import { ClassesStep } from "./classes-step";
import { ContactStep } from "./contact-step";
import { NotesStep } from "./notes-step";
import { submitSchoolOnboarding } from "./onboarding-submit";
import { defaultOnboardingValues, onboardingFormSchema, STEPS, stepIndex, toSubmission, type StepId } from "./onboarding-model";
import { SchoolStep } from "./school-step";
import { SubjectsStep } from "./subjects-step";

/**
 * The School Onboarding form. "Continue" validates the step in view and moves
 * on; on the last step, submitting solves the proof-of-work and sends the
 * answers with the logo and voice note, retrying lost tries with the same
 * submission id (`onboarding-submit.ts`). A failure keeps every answer.
 */
export function useOnboardingForm() {
  const form = useForm({
    defaultValues: defaultOnboardingValues(),
    validators: { onSubmit: onboardingFormSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      if (value.step === "sent") return;
      if (value.step !== "notes") {
        goToStep(STEPS[stepIndex(value.step) + 1]!.id);
        return;
      }
      const submissionId = value.submissionId || crypto.randomUUID();
      form.setFieldValue("submissionId", submissionId);
      const outcome = await submitSchoolOnboarding(toSubmission(value, submissionId), {
        logo: value.logo?.file ?? null,
        voiceNote: value.voiceNote ? { blob: value.voiceNote.blob, mimeType: value.voiceNote.mimeType } : null,
      });
      if (outcome.kind === "saved") {
        goToStep("sent");
        return;
      }
      const message =
        outcome.kind === "invalid"
          ? `${outcome.message} Check your answers and try again.`
          : "We could not send the form just now. Check your connection and try again.";
      form.setErrorMap({ onSubmit: { form: message, fields: {} } });
    },
  });
  /** Moves to a step (forward after validation, or back freely) and brings the card into view. */
  function goToStep(step: StepId | "sent") {
    form.setFieldValue("step", step);
    if (typeof window !== "undefined") document.getElementById("ob-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return Object.assign(form, { goToStep });
}

export type OnboardingFormApi = ReturnType<typeof useOnboardingForm>;

function StepDot({ index, state }: { index: number; state: "done" | "current" | "todo" }) {
  return <span className="ob-step-dot">{state === "done" ? <Check aria-hidden="true" /> : index + 1}</span>;
}

/** Every step by name, with the finished ones clickable to go back. */
function Stepper({ form, current }: { form: OnboardingFormApi; current: number }) {
  return (
    <ol className="ob-steps" aria-label="Form steps">
      {STEPS.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";
        return (
          <li key={step.id} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <button type="button" disabled={state !== "done"} onClick={() => form.goToStep(step.id)}>
              <StepDot index={index} state={state} />
              <span className="ob-step-label">{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepHeader({ step }: { step: StepId }) {
  const index = stepIndex(step);
  const { title, description } = STEPS[index]!;
  return (
    <div className="ob-head">
      <span className="ob-progress">
        Step {index + 1} of {STEPS.length}
      </span>
      <h2 id="ob-title">{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function CurrentStep({ form, step }: { form: OnboardingFormApi; step: StepId }) {
  if (step === "school") return <SchoolStep form={form} />;
  if (step === "contact") return <ContactStep form={form} />;
  if (step === "classes") return <ClassesStep form={form} />;
  if (step === "subjects") return <SubjectsStep form={form} />;
  return <NotesStep form={form} />;
}

function FormError({ form }: { form: OnboardingFormApi }) {
  return (
    <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
      {(error) =>
        typeof error === "string" ? (
          <p className="pg-book-form-alert" role="alert">
            {error} If it keeps failing, <a href="/contact">contact us</a>.
          </p>
        ) : null
      }
    </form.Subscribe>
  );
}

function SubmitLabel({ submitting, last }: { submitting: boolean; last: boolean }) {
  if (submitting) return <>{last ? "Sending…" : "Checking…"}</>;
  return (
    <>
      {last ? "Send details" : "Continue"}
      <ArrowRight aria-hidden="true" />
    </>
  );
}

function FormActions({ form, step }: { form: OnboardingFormApi; step: StepId }) {
  const index = stepIndex(step);
  const last = index === STEPS.length - 1;
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <div className="ob-actions">
          {index > 0 ? (
            <button type="button" className="cp-btn cp-btn-light" disabled={isSubmitting} onClick={() => form.goToStep(STEPS[index - 1]!.id)}>
              <ArrowLeft aria-hidden="true" /> Back
            </button>
          ) : null}
          <button type="submit" className="cp-btn cp-btn-primary" disabled={isSubmitting}>
            {isSubmitting ? <LoaderCircle className="pg-book-spin" aria-hidden="true" /> : null}
            <SubmitLabel submitting={isSubmitting} last={last} />
          </button>
        </div>
      )}
    </form.Subscribe>
  );
}

/** Shown once the request is saved. */
function SentNote() {
  return (
    <div className="ob-sent" role="status">
      <CheckCircle2 aria-hidden="true" />
      <h2 id="ob-title">Thank you. We have your details.</h2>
      <p>You will hear from us in 1 to 2 business days.</p>
      <p>
        If you want to contact us, please see our <a href="/contact">contact page</a>.
      </p>
    </div>
  );
}

function OnboardingSteps({ form, step }: { form: OnboardingFormApi; step: StepId }) {
  return (
    <form
      className="ob-body"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <Stepper form={form} current={stepIndex(step)} />
      <StepHeader step={step} />
      <CurrentStep form={form} step={step} />
      <FormError form={form} />
      <FormActions form={form} step={step} />
    </form>
  );
}

/** The page's card: the steps, then the thank-you note. */
export function OnboardingCard() {
  const form = useOnboardingForm();
  return (
    <section className="ob-card" id="ob-card" aria-labelledby="ob-title">
      <form.Subscribe selector={(state) => state.values.step}>
        {(step) => (step === "sent" ? <SentNote /> : <OnboardingSteps form={form} step={step} />)}
      </form.Subscribe>
    </section>
  );
}
