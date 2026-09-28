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
  phoneNo: string;
  email: string | null;
  dob: string;
  fatherName: string;
  motherName: string;
  registered: boolean;
  photoS3Key: string | null;
  documents: AdmissionDocumentGroup[];
};

export type AdmissionFormValue = Omit<
  AdmissionRecord,
  'id' | 'documents' | 'photoS3Key' | 'registered'
>;

export type AcademicPlacement = {
  rollNo: number | null;
  classLabel: string | null;
  sectionLabel: string | null;
};
