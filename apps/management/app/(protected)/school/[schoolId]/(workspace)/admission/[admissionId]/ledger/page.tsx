import { AdmissionLedger } from "@/components/billing/admission-ledger";
export default async function AdmissionLedgerPage({ params }: { params: Promise<{ schoolId: string; admissionId: string }> }) { const { schoolId, admissionId } = await params; return <AdmissionLedger schoolId={schoolId} admissionId={admissionId} />; }
