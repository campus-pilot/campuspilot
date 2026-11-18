'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SCHOOL_LOGO_MIME_TYPES } from '@campuspilot/api/routers/system-admin/school/school.constants';
import { DocumentPreview } from '@campuspilot/components/documents/document-controls';
import { Dropzone, formatFileSize } from '@campuspilot/components/dropzone';
import { Label } from '@campuspilot/ui/components/label';
import { RadioGroup, RadioGroupItem } from '@campuspilot/ui/components/radio-group';
import { ImageUp } from 'lucide-react';
import { orpc } from '@/lib/orpc';
import type { OnboardingForm } from './onboarding-form';
import { ONBOARDING_PAPER_DESIGNS, type OnboardingPaperDesign } from './onboarding-model';
import { StepHeading } from './onboarding-steps';

/** The optional logo, uploaded when the guide saves. */
function LogoField({ form }: { form: OnboardingForm }) {
  return (
    <form.Field name="logo">
      {(field) => (
        <div className="flex flex-col gap-2">
          <Label htmlFor="onboarding-logo">School logo (optional)</Label>
          <Dropzone
            key={field.state.value?.name ?? 'empty-logo'}
            id="onboarding-logo"
            name={field.name}
            accept={SCHOOL_LOGO_MIME_TYPES.join(',')}
            title={field.state.value?.name ?? 'Add your school logo'}
            description="JPEG, PNG or WebP. You can add it later."
            icon={ImageUp}
            footer={field.state.value ? <span className="text-xs text-muted-foreground">{formatFileSize(field.state.value.size)}</span> : undefined}
            onFileSelect={(files) => field.handleChange(files[0] ?? null)}
            onFilesRejected={() => field.handleChange(null)}
          />
        </div>
      )}
    </form.Field>
  );
}

/** One design to choose, as a labelled radio card. */
function DesignOption({ slug, label, description }: { slug: OnboardingPaperDesign; label: string; description: string }) {
  const id = `onboarding-design-${slug}`;
  return (
    <Label htmlFor={id} className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 has-data-[state=checked]:border-primary has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary">
      <RadioGroupItem id={id} value={slug} className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs font-normal text-muted-foreground">{description}</span>
      </span>
    </Label>
  );
}

/**
 * The chosen design as the marketplace previews it. The preview uses the
 * marketplace's sample school, never this school's details: marketplace
 * previews are rendered from synthetic data only (docs/document-system.md).
 */
function DesignPreview({ schoolId, design }: { schoolId: string; design: OnboardingPaperDesign }) {
  const preview = useQuery({
    ...orpc.school.getMarketplaceTemplate.queryOptions({ input: { schoolId, documentType: 'question_paper', slug: design } }),
    placeholderData: keepPreviousData,
  });
  if (preview.isError) return <p className="text-xs text-muted-foreground">The preview could not be loaded. You can still choose this design.</p>;
  return <DocumentPreview html={preview.data?.html} label="Design preview" sample fitPageWidth placeholder="Loading the preview…" />;
}

/** The paper header: the optional logo and one of the marketplace's question paper designs, with its preview. */
export function HeaderStep({ form, schoolId }: { form: OnboardingForm; schoolId: string }) {
  return (
    <>
      <StepHeading title="Your question paper header">Every paper prints with this header. You can change it any time.</StepHeading>
      <LogoField form={form} />
      <form.Field name="design">
        {(field) => (
          <div className="flex flex-col gap-3">
            <RadioGroup aria-label="Question paper design" value={field.state.value} onValueChange={(value) => field.handleChange(value as OnboardingPaperDesign)} className="grid grid-cols-2 gap-2">
              {ONBOARDING_PAPER_DESIGNS.map((design) => (
                <DesignOption key={design.slug} {...design} />
              ))}
            </RadioGroup>
            <DesignPreview schoolId={schoolId} design={field.state.value} />
          </div>
        )}
      </form.Field>
    </>
  );
}
