/**
 * The clockwise quarter turns a person may apply to an uploaded page photo on
 * top of its EXIF orientation (`exam_question_paper_page.rotation`). A page
 * photographed with the phone held sideways is still on its side once EXIF
 * orientation is applied; the teacher turns it upright. Shared by the table's
 * CHECK and the API's schemas.
 */
export const QUESTION_PAPER_PAGE_ROTATIONS = [0, 90, 180, 270] as const;
export type QuestionPaperPageRotation = (typeof QUESTION_PAPER_PAGE_ROTATIONS)[number];
