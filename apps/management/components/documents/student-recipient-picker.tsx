"use client";
import { useForm } from "@tanstack/react-form";
import { useQueries, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  StudentRecipientCombobox,
  type StudentRecipient,
} from "@campuspilot/components/documents/student-recipient-combobox";
import { DocumentErrors } from "@campuspilot/components/documents/document-controls";
import { orpc } from "@/lib/orpc";
import type { DocumentScope } from "./document-common";

type PickerProps = {
  scope: DocumentScope;
  classId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  errors: readonly unknown[];
};
export function StudentPicker(props: PickerProps) {
  const form = useForm({
    defaultValues: {
      search: "",
      page: 1,
      known: {} as Record<string, StudentRecipient>,
    },
    validators: {
      onChange: z.object({
        search: z.string().max(200),
        page: z.number().int().positive(),
        known: z.record(
          z.string(),
          z.object({
            id: z.string(),
            name: z.string(),
            admissionNo: z.string(),
          }),
        ),
      }),
    },
  });
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <>
          <StudentOptions
            {...props}
            {...values}
            onSearch={(search) => {
              form.setFieldValue("search", search);
              form.setFieldValue("page", 1);
            }}
            onBlur={() => form.validateField("search", "blur")}
            onPage={(page) => form.setFieldValue("page", page)}
            onSelect={(values, resolved) => {
              form.setFieldValue(
                "known",
                Object.fromEntries(resolved.map((value) => [value.id, value])),
              );
              props.onChange(values.map((value) => value.id));
            }}
          />
          <form.Field name="search">
            {(field) => <DocumentErrors errors={field.state.meta.errors} />}
          </form.Field>
        </>
      )}
    </form.Subscribe>
  );
}
function StudentOptions(
  props: PickerProps & {
    search: string;
    page: number;
    known: Record<string, StudentRecipient>;
    onSearch: (value: string) => void;
    onBlur: () => void;
    onPage: (page: number) => void;
    onSelect: (
      values: StudentRecipient[],
      resolved: StudentRecipient[],
    ) => void;
  },
) {
  const students = useQuery(
    orpc.school.listStudents.queryOptions({
      input: {
        ...props.scope,
        filters: { classId: props.classId },
        page: props.page,
        ...(props.search.trim() ? { searchQuery: props.search.trim() } : {}),
      },
      enabled: props.search.length <= 200,
    }),
  );
  const options = students.data?.items.map(toRecipient) ?? [];
  const known = new Map(
    [...Object.values(props.known), ...options].map((value) => [
      value.id,
      value,
    ]),
  );
  // Deep links may select a student outside the current page. Load that exact
  // identity; never guess a label or clear the selection during a search.
  const missing = props.selected.filter((id) => !known.has(id));
  const identities = useQueries({
    queries: missing.map((studentId) =>
      orpc.school.getStudent.queryOptions({
        input: { ...props.scope, studentId },
      }),
    ),
  });
  for (const identity of identities)
    if (identity.data) known.set(identity.data.id, toRecipient(identity.data));
  const selected = props.selected.map(
    (id) =>
      known.get(id) ?? {
        id,
        name: "Loading selected student…",
        admissionNo: "",
      },
  );
  const identityError = identities.find((identity) => identity.isError)?.error;
  return (
    <StudentRecipientCombobox
      options={options}
      selected={selected}
      search={props.search}
      onSearch={props.onSearch}
      onChange={(values) =>
        props.onSelect(
          values,
          values.flatMap((value) => known.get(value.id) ?? []),
        )
      }
      onBlur={props.onBlur}
      loading={
        students.isFetching || identities.some((identity) => identity.isPending)
      }
      error={students.error?.message ?? identityError?.message}
      onRetry={() => {
        void students.refetch();
        identities.forEach((identity) => {
          if (identity.isError) void identity.refetch();
        });
      }}
      page={props.page}
      totalPages={Math.max(1, students.data?.pagination.totalPages ?? 1)}
      hasNext={Boolean(students.data?.pagination.nextCursor)}
      onPage={props.onPage}
      errors={props.errors}
    />
  );
}
function toRecipient(student: {
  id: string;
  admission: { name: string; admissionNo: string };
}): StudentRecipient {
  return {
    id: student.id,
    name: student.admission.name,
    admissionNo: student.admission.admissionNo,
  };
}
