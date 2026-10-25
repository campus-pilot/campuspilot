ALTER TABLE "exam_result" DROP CONSTRAINT "exam_result_exam_plan_id_exam_plan_id_fk";
--> statement-breakpoint
ALTER TABLE "exam_result" ADD CONSTRAINT "exam_result_exam_plan_id_exam_plan_id_fk" FOREIGN KEY ("exam_plan_id") REFERENCES "public"."exam_plan"("id") ON DELETE cascade ON UPDATE no action;