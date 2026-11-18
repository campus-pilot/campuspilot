// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SortableTable } from '../sortable-table';
import { DataTable } from './data-table';

afterEach(cleanup);

type Row = { id: string; name: string };
const columns = [{ accessorKey: 'name', header: 'Name' }];
const sortableColumns = [{ id: 'name', header: 'Name', cell: (row: Row) => row.name }];

describe('empty table actions', () => {
  it('shows the empty action under the message when there are no rows', () => {
    render(<DataTable<Row> ariaLabel="Things" columns={columns} data={[]} emptyMessage="Nothing yet." emptyAction={<button type="button">Add thing</button>} />);
    expect(screen.getByText('Nothing yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add thing' })).toBeTruthy();
  });

  it('hides the empty action once rows exist', () => {
    render(<DataTable<Row> ariaLabel="Things" columns={columns} data={[{ id: '1', name: 'One' }]} emptyMessage="Nothing yet." emptyAction={<button type="button">Add thing</button>} />);
    expect(screen.queryByRole('button', { name: 'Add thing' })).toBeNull();
  });

  it('shows only the message when no action is given', () => {
    render(<DataTable<Row> ariaLabel="Things" columns={columns} data={[]} emptyMessage="No things match this search." />);
    expect(screen.getByText('No things match this search.').closest('td')?.textContent).toBe('No things match this search.');
  });

  it('gives sortable tables the same empty action', () => {
    render(<SortableTable<Row> ariaLabel="Things" columns={sortableColumns} data={[]} emptyMessage="Nothing yet." emptyAction={<button type="button">Add thing</button>} getRowId={(row) => row.id} getRowLabel={(row) => row.name} />);
    expect(screen.getByRole('button', { name: 'Add thing' })).toBeTruthy();
  });
});
