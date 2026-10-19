'use client';
import { useId } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { ConfirmationDialog } from '../confirmation-dialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, X } from 'lucide-react';
import { ExamButton, ExamSelect, Issues } from './exam-controls';
import {
  nextTimetableDate,
  removeTimetableColumn,
  type TimetableConfig,
  type TimetableClass,
  type TimetableRow,
} from './timetable-builder-model';
import { TimetableGridRow } from './timetable-grid-row';

type Props = {
  config: TimetableConfig;
  classes: TimetableClass[];
  selectedClassId: string;
  disabled: boolean;
  issues: z.ZodIssue[];
  onChange: (config: TimetableConfig) => void;
  onSelectClass: (classId: string) => void;
};

type BuilderProps = Props & { onRemoveClass: (classId: string) => void };

/** Adapts the old platform's date/time × class grid to the current design system.
 * Desktop edits every class side by side; mobile edits one class without ever
 * narrowing the submitted shared grid. All values belong to the parent form.
 */
export function TimetableBuilder(props: Props) {
  const { config, disabled, onChange } = props;
  const patch = (id: string, changes: Partial<TimetableRow>) =>
    onChange({
      ...config,
      rows: config.rows.map((row) =>
        row.id === id ? { ...row, ...changes } : row,
      ),
    });
  const ui = useForm({
    defaultValues: {
      removal: null as { kind: 'class' | 'slot'; id: string } | null,
    },
    validators: {
      onChange: z.object({
        removal: z
          .object({
            kind: z.enum(['class', 'slot']),
            id: z.string(),
          })
          .nullable(),
      }),
    },
  });
  const remove = (id: string) =>
    ui.setFieldValue('removal', { kind: 'slot', id });
  const builderProps = {
    ...props,
    onRemoveClass: (id: string) =>
      ui.setFieldValue('removal', { kind: 'class', id }),
  };
  const confirmRemoval = () => {
    const removal = ui.getFieldValue('removal');
    if (!removal || disabled) return;
    const next =
      removal.kind === 'class'
        ? removeTimetableColumn(config, removal.id)
        : {
            ...config,
            rows: config.rows.filter((row) => row.id !== removal.id),
          };
    onChange(next);
    if (removal.kind === 'class' && props.selectedClassId === removal.id)
      props.onSelectClass(next.columns[0] ?? '');
    ui.setFieldValue('removal', null);
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-4">
      <BuilderToolbar {...builderProps} />
      <Issues
        errors={props.issues.filter(
          (issue) => issue.path[0] !== 'rows' || issue.path.length === 1,
        )}
      />
      <div className="hidden min-h-0 min-w-0 lg:block">
        <BuilderGrid {...builderProps} onPatch={patch} onRemove={remove} />
      </div>
      <div className="min-h-0 min-w-0 lg:hidden">
        <BuilderGrid
          {...builderProps}
          onPatch={patch}
          onRemove={remove}
          visibleColumns={props.selectedClassId ? [props.selectedClassId] : []}
        />
      </div>
      <ui.Subscribe selector={(state) => state.values.removal}>
        {(removal) => (
          <ConfirmationDialog
            open={removal !== null}
            title={
              removal?.kind === 'class'
                ? 'Remove class column?'
                : 'Delete time slot?'
            }
            description={
              removal?.kind === 'class'
                ? `Remove ${props.classes.find((item) => item.id === removal.id)?.label ?? 'this class'} and its timetable assignments? Other classes will be preserved.`
                : 'Delete this date and time slot for every class?'
            }
            confirmLabel={
              removal?.kind === 'class' ? 'Remove class' : 'Delete slot'
            }
            onOpenChange={(open) => {
              if (!open) ui.setFieldValue('removal', null);
            }}
            onConfirm={confirmRemoval}
          />
        )}
      </ui.Subscribe>
    </div>
  );
}
function BuilderToolbar({
  config,
  classes,
  selectedClassId,
  onSelectClass,
  onChange,
  disabled,
}: BuilderProps) {
  const available = classes.filter(
    (entry) => !config.columns.includes(entry.id),
  );
  return (
    <div
      className={`flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end ${available.length ? '' : 'lg:hidden'}`}
    >
      <div className="min-w-0 flex-1 lg:hidden">
        <ExamSelect
          label="Class to edit"
          value={selectedClassId}
          onChange={onSelectClass}
        >
          <option value="">Choose a class</option>
          {config.columns.map((id) => (
            <option key={id} value={id}>
              {classes.find((entry) => entry.id === id)?.label ?? id}
            </option>
          ))}
        </ExamSelect>
      </div>
      {available.length > 0 && (
        <div className="min-w-0 flex-1">
          <ExamSelect
            label="Add class column"
            value=""
            disabled={disabled || config.columns.length >= 200}
            onChange={(id) => {
              if (!id || config.columns.includes(id)) return;
              onChange({ ...config, columns: [...config.columns, id] });
              onSelectClass(id);
            }}
          >
            <option value="">Choose a class to add</option>
            {available.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </ExamSelect>
        </div>
      )}
    </div>
  );
}
type RowCallbacks = {
  onPatch: (id: string, changes: Partial<TimetableRow>) => void;
  onRemove: (id: string) => void;
};
function BuilderGrid(
  props: BuilderProps & RowCallbacks & { visibleColumns?: string[] },
) {
  // Dnd-kit's default counter differs between server renders. A React ID keeps
  // drag instructions correctly associated after hydration and across editors.
  const id = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const reorder = ({ active, over }: DragEndEvent) => {
    if (props.disabled || !over || active.id === over.id) return;
    const from = props.config.columns.indexOf(String(active.id));
    const to = props.config.columns.indexOf(String(over.id));
    if (from >= 0 && to >= 0)
      props.onChange({
        ...props.config,
        columns: arrayMove(props.config.columns, from, to),
      });
  };
  const addRow = () =>
    props.onChange({
      ...props.config,
      rows: [
        ...props.config.rows,
        {
          id: crypto.randomUUID(),
          date: nextTimetableDate(props.config.rows),
          startTime: props.config.rows.at(-1)?.startTime ?? '',
          endTime: props.config.rows.at(-1)?.endTime ?? '',
          cells: Object.fromEntries(
            props.config.columns.map((id) => [id, null]),
          ),
        },
      ],
    });
  const visibleColumnCount = (
    props.visibleColumns ?? props.config.columns
  ).length;
  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={reorder}
    >
      <SortableContext
        items={props.config.columns}
        strategy={horizontalListSortingStrategy}
      >
        <div
          className="max-h-[60dvh] overflow-auto rounded-lg border"
          role="region"
          aria-label="Shared timetable grid"
          tabIndex={0}
        >
          <table className="w-full border-separate border-spacing-0 text-xs">
            <GridHead {...props} visibleColumns={props.visibleColumns} />
            <tbody>
              {props.config.rows.map((row, index) => (
                <TimetableGridRow
                  key={row.id}
                  {...props}
                  row={row}
                  index={index}
                />
              ))}
              <tr>
                <td colSpan={visibleColumnCount + 3} className="p-2">
                  <ExamButton
                    type="button"
                    variant="outline"
                    className="h-auto w-full justify-start border-dashed py-3 text-muted-foreground hover:text-foreground"
                    disabled={props.disabled || props.config.rows.length >= 500}
                    onClick={addRow}
                  >
                    <Plus aria-hidden /> Add date and time slot
                  </ExamButton>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </SortableContext>
    </DndContext>
  );
}
function GridHead(props: BuilderProps & { visibleColumns?: string[] }) {
  return (
    <thead className="sticky top-0 z-20 bg-muted">
      <tr>
        <th
          scope="col"
          className="sticky left-0 z-30 min-w-40 border-b border-r bg-muted p-2 text-left"
        >
          Date
        </th>
        <th
          scope="col"
          className="min-w-60 border-b border-r bg-muted p-2 text-left"
        >
          Time
        </th>
        {(props.visibleColumns ?? props.config.columns).map((id) => (
          <ClassHeader key={id} {...props} classId={id} />
        ))}
        <th scope="col" className="border-b p-3">
          <span className="sr-only">Slot actions</span>
        </th>
      </tr>
    </thead>
  );
}
function ClassHeader({
  classId,
  ...props
}: BuilderProps & { classId: string }) {
  const drag = useSortable({ id: classId, disabled: props.disabled });
  const label =
    props.classes.find((entry) => entry.id === classId)?.label ?? classId;
  return (
    <th
      ref={drag.setNodeRef}
      style={{
        transform: CSS.Transform.toString(drag.transform),
        transition: drag.transition,
        opacity: drag.isDragging ? 0.5 : 1,
      }}
      scope="col"
      className="min-w-56 border-b border-r bg-muted p-2 align-top"
    >
      <div className="flex items-center gap-1">
        <ExamButton
          type="button"
          variant="ghost"
          disabled={props.disabled}
          aria-label={`Drag ${label} column`}
          {...drag.attributes}
          {...drag.listeners}
        >
          <GripVertical aria-hidden className="size-4" />
        </ExamButton>
        <span className="min-w-0 flex-1 break-words text-left">{label}</span>
        <ExamButton
          type="button"
          variant="ghost"
          disabled={props.disabled}
          aria-label={`Remove ${label} column`}
          onClick={() => props.onRemoveClass(classId)}
        >
          <X aria-hidden className="size-4" />
        </ExamButton>
      </div>
    </th>
  );
}
