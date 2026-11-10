/** "1 record", "3 records": a count with the right noun form. */
export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
