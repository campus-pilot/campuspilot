'use client';

import { useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@campuspilot/ui/components/accordion';
import { Attachment, AttachmentAction, AttachmentActions, AttachmentContent, AttachmentDescription, AttachmentGroup, AttachmentMedia, AttachmentTitle } from '@campuspilot/ui/components/attachment';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import { Download, File as FileIcon, Files, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';

import { Dropzone, formatFileSize } from '../dropzone';
import { FormErrors } from './form-errors';
import type { AdmissionDocumentFile, AdmissionDocumentGroup, AdmissionDocumentType } from './types';

const MAX_DOCUMENT_TYPES = 10;
const MAX_FILES_PER_TYPE = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ADDITIONAL_DOCUMENT = '__additional__';

const uploadSchema = z.object({
  documentValue: z.string().min(1, 'Choose a document type.'),
  documentName: z.string().trim().max(200),
  files: z.array(z.instanceof(File)).min(1, 'Choose at least one file.').max(MAX_FILES_PER_TYPE, `Choose no more than ${MAX_FILES_PER_TYPE} files.`).refine((files) => files.every((file) => file.size <= MAX_FILE_BYTES), 'Each file must be 10 MB or smaller.'),
}).refine(({ documentValue, documentName }) => documentValue !== ADDITIONAL_DOCUMENT || documentName.length > 0, { path: ['documentName'], message: 'Document name is required.' });

function FileList({ files, getDownloadHref, canEdit, onDelete }: { files: AdmissionDocumentFile[]; getDownloadHref: (fileId: string) => string; canEdit: boolean; onDelete: (fileId: string) => Promise<void> }) {
  const [deletingId, setDeletingId] = useState<string>();
  return files.length === 0 ? <p className="text-sm text-muted-foreground">No files attached yet.</p> : <AttachmentGroup className="flex-col overflow-visible">{files.map((file) => <Attachment key={file.id} className="w-full"><AttachmentMedia><FileIcon aria-hidden /></AttachmentMedia><AttachmentContent><AttachmentTitle>{file.fileName}</AttachmentTitle><AttachmentDescription>{formatFileSize(file.sizeBytes)} · {new Date(file.uploadedAt).toLocaleDateString()}</AttachmentDescription></AttachmentContent><AttachmentActions><AttachmentAction asChild aria-label={`Download ${file.fileName}`}><a href={getDownloadHref(file.id)}><Download aria-hidden /></a></AttachmentAction>{canEdit ? <AttachmentAction aria-label={`Delete ${file.fileName}`} disabled={deletingId === file.id} onClick={() => { setDeletingId(file.id); void onDelete(file.id).finally(() => setDeletingId(undefined)); }}><Trash2 aria-hidden /></AttachmentAction> : null}</AttachmentActions></Attachment>)}</AttachmentGroup>;
}

function UploadDocumentsDialog({ open, configuredTypes, documents, onOpenChange, onUpload }: { open: boolean; configuredTypes: AdmissionDocumentType[]; documents: AdmissionDocumentGroup[]; onOpenChange: (open: boolean) => void; onUpload: (input: { value: string; label?: string; files: File[]; onProgress: (progress: number) => void }) => Promise<void> }) {
  const [progress, setProgress] = useState<number>();
  const configuredValues = new Set(configuredTypes.map(({ value }) => value));
  const options = [...configuredTypes, ...documents.filter(({ value }) => !configuredValues.has(value)).map(({ value, label }) => ({ value, label: label ?? value }))];
  const form = useForm({
    defaultValues: { documentValue: ADDITIONAL_DOCUMENT, documentName: '', files: [] as File[] },
    validators: { onSubmit: uploadSchema },
    onSubmit: async ({ value }) => {
      form.setErrorMap({});
      const parsed = uploadSchema.parse(value);
      const isAdditional = parsed.documentValue === ADDITIONAL_DOCUMENT;
      const existingGroup = isAdditional ? undefined : documents.find(({ value: groupValue }) => groupValue === parsed.documentValue);
      if (isAdditional && documents.length >= MAX_DOCUMENT_TYPES) {
        form.setErrorMap({ onSubmit: { form: `An admission can have at most ${MAX_DOCUMENT_TYPES} document types.`, fields: {} } });
        return;
      }
      if ((existingGroup?.files.length ?? 0) + parsed.files.length > MAX_FILES_PER_TYPE) {
        form.setErrorMap({ onSubmit: { form: `Each document type can contain at most ${MAX_FILES_PER_TYPE} files.`, fields: {} } });
        return;
      }
      const documentValue = isAdditional ? `custom-${crypto.randomUUID()}` : parsed.documentValue;
      const documentLabel = isAdditional ? parsed.documentName : undefined;
      setProgress(0);
      try {
        await onUpload({ value: documentValue, label: documentLabel, files: parsed.files, onProgress: setProgress });
        form.reset();
        setProgress(undefined);
        onOpenChange(false);
      } catch (error) {
        setProgress(undefined);
        form.setErrorMap({ onSubmit: { form: error instanceof Error ? error.message : 'Unable to upload these documents.', fields: {} } });
      }
    },
  });
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !form.state.isSubmitting) {
      form.reset();
      setProgress(undefined);
    }
    onOpenChange(nextOpen);
  }
  return <Dialog open={open} onOpenChange={handleOpenChange}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Add documents</DialogTitle><DialogDescription>Choose a requested type or name an additional document, then upload up to 10 files together.</DialogDescription></DialogHeader><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><form.Field name="documentValue">{(field) => <div className="flex flex-col gap-2"><Label>Document type</Label><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}<SelectItem value={ADDITIONAL_DOCUMENT}>Additional document</SelectItem></SelectContent></Select><FormErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Subscribe selector={(state) => state.values.documentValue}>{(documentValue) => documentValue === ADDITIONAL_DOCUMENT ? <form.Field name="documentName">{(field) => <div className="flex flex-col gap-2"><Label htmlFor="additional-document-name">Document name</Label><Input id="additional-document-name" placeholder="For example, transfer certificate" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><p className="text-xs text-muted-foreground">This is the name staff will see. CampusPilot creates the internal key automatically.</p><FormErrors errors={field.state.meta.errors} /></div>}</form.Field> : null}</form.Subscribe><form.Field name="files">{(field) => <div className="flex flex-col gap-2"><Dropzone key={field.state.value.map((file) => `${file.name}-${file.lastModified}`).join('|') || 'empty-documents'} multiple disabled={form.state.isSubmitting} title={field.state.value.length > 0 ? `${field.state.value.length} file${field.state.value.length === 1 ? '' : 's'} selected` : 'Drop documents here'} description="or click to choose up to 10 files" footer={progress === undefined ? 'Maximum 10 MB per file' : `Uploading ${progress}%`} onFileSelect={(files) => field.handleChange(files.slice(0, MAX_FILES_PER_TYPE))} /><FormErrors errors={field.state.meta.errors} />{field.state.value.length > 0 ? <ul className="flex flex-col gap-1 text-xs text-muted-foreground">{field.state.value.map((file) => <li key={`${file.name}-${file.lastModified}`} className="flex justify-between gap-3"><span className="truncate">{file.name}</span><span className="shrink-0">{formatFileSize(file.size)}</span></li>)}</ul> : null}</div>}</form.Field><form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, files: state.values.files, isSubmitting: state.isSubmitting })}>{({ canSubmit, errors, files, isSubmitting }) => <div className="flex flex-col gap-3"><FormErrors errors={errors} /><DialogFooter><Button type="button" variant="outline" disabled={isSubmitting} onClick={() => handleOpenChange(false)}>Cancel</Button><Button type="submit" disabled={!canSubmit || files.length === 0 || isSubmitting}>{isSubmitting ? 'Uploading…' : `Upload ${files.length || ''} file${files.length === 1 ? '' : 's'}`}</Button></DialogFooter></div>}</form.Subscribe></form></DialogContent></Dialog>;
}

export function AdmissionDocumentsView({ configuredTypes, documents, canEdit, onUpload, onDelete, getDownloadHref }: {
  configuredTypes: AdmissionDocumentType[];
  documents: AdmissionDocumentGroup[];
  canEdit: boolean;
  onUpload: (input: { value: string; label?: string; files: File[]; onProgress: (progress: number) => void }) => Promise<void>;
  onDelete: (fileId: string) => Promise<void>;
  getDownloadHref: (fileId: string) => string;
}) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const configuredValues = new Set(configuredTypes.map(({ value }) => value));
  const groups = [...configuredTypes.map((type) => ({ ...type, files: documents.find(({ value }) => value === type.value)?.files ?? [], configured: true })), ...documents.filter(({ value }) => !configuredValues.has(value)).map((document) => ({ value: document.value, label: document.label ?? document.value, files: document.files, configured: false }))];
  const fileCount = documents.reduce((total, document) => total + document.files.length, 0);
  return <div className="flex flex-col gap-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Admission documents</h2><p className="text-sm text-muted-foreground">Requested types are guidance; each type can hold up to 10 files.</p></div><div className="flex items-center gap-2"><Badge variant="secondary">{documents.length} / {MAX_DOCUMENT_TYPES} types · {fileCount} files</Badge>{canEdit ? <Button type="button" size="sm" onClick={() => setUploadOpen(true)}><Plus aria-hidden />Add documents</Button> : null}</div></div>{groups.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground"><Files className="mx-auto mb-2 size-8" aria-hidden />No document types are configured and no files have been attached.</div> : <Accordion type="multiple" className="rounded-xl border px-4" defaultValue={groups.filter(({ files }) => files.length > 0).map(({ value }) => value)}>{groups.map((group) => <AccordionItem key={group.value} value={group.value}><AccordionTrigger><span className="flex items-center gap-2">{group.label}<Badge variant={group.files.length > 0 ? 'default' : 'outline'}>{group.files.length}</Badge>{group.configured ? <span className="text-xs font-normal text-muted-foreground">Requested</span> : null}</span></AccordionTrigger><AccordionContent><FileList files={group.files} getDownloadHref={getDownloadHref} canEdit={canEdit} onDelete={onDelete} /></AccordionContent></AccordionItem>)}</Accordion>}{canEdit ? <UploadDocumentsDialog open={uploadOpen} configuredTypes={configuredTypes} documents={documents} onOpenChange={setUploadOpen} onUpload={onUpload} /> : null}</div>;
}
