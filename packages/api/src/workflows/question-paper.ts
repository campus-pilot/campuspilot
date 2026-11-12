/**
 * The question paper generation Restate services, hosted by `apps/worker`.
 * Import from `@campuspilot/api/workflows/question-paper`.
 */
export { questionPaperControlService, type QuestionPaperControlService } from './question-paper/control-service';
export { questionPaperGenerationWorkflow, type QuestionPaperGenerationWorkflow } from './question-paper/workflow';
