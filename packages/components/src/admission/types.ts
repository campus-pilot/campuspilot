export type AdmissionDocumentType = { value: string; label: string };

export type AdmissionDocumentFile = {
  id: string;
  s3Key: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
};

export type AdmissionDocumentGroup = {
  value: string;
  label?: string;
  files: AdmissionDocumentFile[];
};

export type AdmissionRecord = {
  id: string;
  name: string;
  admissionNo: string;
  admissionClassId: string | null;
  address: string;
  /** E.164, or an unmigrated legacy value shown as stored. */
  phoneNo: string;
  whatsappNo: string | null;
  /** Null: no choice recorded yet (admission predates the WhatsApp fields). */
  whatsappSameAsPhone: boolean | null;
  whatsappVerified: boolean;
  whatsappConsent: boolean;
  email: string | null;
  dob: string;
  fatherName: string;
  motherName: string;
  registered: boolean;
  photoS3Key: string | null;
  documents: AdmissionDocumentGroup[];
};

/** The stored values an admission dialog starts from. */
export type AdmissionFormValue = Omit<
  AdmissionRecord,
  'id' | 'documents' | 'photoS3Key' | 'registered'
>;

/**
 * What the admission dialog submits: the phone numbers in E.164 and an
 * explicit WhatsApp choice.
 */
export type AdmissionFormSubmitValue = Omit<AdmissionFormValue, 'whatsappSameAsPhone'> & {
  whatsappSameAsPhone: boolean;
};

export type AcademicPlacement = {
  rollNo: number | null;
  classLabel: string | null;
  sectionLabel: string | null;
};
