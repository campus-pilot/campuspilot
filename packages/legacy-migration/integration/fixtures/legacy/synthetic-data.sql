INSERT INTO school (id,slug,name,location,"registrationNo",logo_s3_key,finance_schema,active_session_id,"defaultSessionConfig",has_completed_onboarding,features,"createdAt","updatedAt") VALUES (
  'sch_n6q4pmirqg7dpct1pr8pr','synthetic-prem','Synthetic Prem Chandra School','Fixture City','FIXTURE-001',
  'legacy/logo.png',
  '{"recurring":"monthly","currency":"INR","elements":{"tuition":{"name":"Tuition","scopes":["school"],"requiredAtLevel":"school","defaultValue":"100.00"}}}',
  'sess_aaaaaaaaaaaaaaaaaaaaa','{"examConfig":{"term-1":{"name":"Term 1"}}}',true,
  '{"template:ai":true}','2026-04-01 09:00:00','2026-04-01 09:00:00'
);
INSERT INTO school (id,slug,name,location,"registrationNo",logo_s3_key,finance_schema,active_session_id,"defaultSessionConfig",has_completed_onboarding,features,"createdAt","updatedAt") VALUES (
  'sch_72v99bp6lrxlsdhxtoc9l','synthetic-excluded','Synthetic Excluded Test School','Fixture City','FIXTURE-EXCLUDED',
  NULL,'{}','sess_excluded_fixture','{}',false,'{}','2026-04-01 09:00:00','2026-04-01 09:00:00'
);
INSERT INTO school_session (id,school_id,"sessionStartYear","sessionEndYear","sessionConfig","createdAt","updatedAt",slug) VALUES (
  'sess_aaaaaaaaaaaaaaaaaaaaa','sch_n6q4pmirqg7dpct1pr8pr',2026,2027,
  '{"examConfig":{"term-1":{"name":"Term 1","order":1}},"coScholasticAreas":{"discipline":{"name":"Discipline"}},"gradingScale":{"a":{"label":"A","minScore":75}},"attendanceTracking":{"enabled":true}}',
  '2024-04-01 09:00:00','2024-04-01 09:00:00','2026-2027'
);
INSERT INTO class (id,school_id,slug,label,attributes,config,finance_config,"createdAt","updatedAt") VALUES (
  'cls_bbbbbbbbbbbbbbbbbbbbb','sch_n6q4pmirqg7dpct1pr8pr','3','Class 3','{}',
  '{"subjects":{"math":{"name":"Mathematics","books":[],"examModes":{"written":{"name":"Written","percentage":100}}}}}',
  NULL,'2024-04-01 09:00:00','2024-04-01 09:00:00'
);
INSERT INTO section (id,school_id,class_id,slug,label,attributes,"createdAt","updatedAt") VALUES (
  'sec_ccccccccccccccccccccc','sch_n6q4pmirqg7dpct1pr8pr','cls_bbbbbbbbbbbbbbbbbbbbb','a','A','{}',
  '2024-04-01 09:00:00','2024-04-01 09:00:00'
);
INSERT INTO admission (id,school_id,name,"admissionNo",admission_class_id,address,"phoneNo",email,dob,"fatherName","motherName",registered,photo_s3_key,"createdAt","updatedAt") VALUES (
  'adm_ddddddddddddddddddddd','sch_n6q4pmirqg7dpct1pr8pr','Synthetic Student','FIX-001','cls_bbbbbbbbbbbbbbbbbbbbb',
  'Fixture address','+910000000001','student@example.invalid','2015-01-01','Fixture Father','Fixture Mother',true,NULL,
  '2024-04-01 09:00:00','2024-04-01 09:00:00'
);
INSERT INTO admission (id,school_id,name,"admissionNo",admission_class_id,address,"phoneNo",email,dob,"fatherName","motherName",registered,photo_s3_key,"createdAt","updatedAt") VALUES (
  'adm_lllllllllllllllllllll','sch_n6q4pmirqg7dpct1pr8pr','Synthetic Student Two','FIX-002','cls_bbbbbbbbbbbbbbbbbbbbb',
  'Second fixture address','+910000000002',NULL,'2015-02-02','Fixture Father Two','Fixture Mother Two',true,NULL,
  '2026-04-01 09:00:00','2026-04-01 09:00:00'
);
INSERT INTO student (id,school_id,admission_id,session_id,class_id,section_id,"rollNo",finance_config,"createdAt","updatedAt") VALUES (
  'stu_eeeeeeeeeeeeeeeeeeeee','sch_n6q4pmirqg7dpct1pr8pr','adm_ddddddddddddddddddddd','sess_aaaaaaaaaaaaaaaaaaaaa',
  'cls_bbbbbbbbbbbbbbbbbbbbb','sec_ccccccccccccccccccccc',1,NULL,
  '2024-04-01 09:00:00','2024-04-01 09:00:00'
);
INSERT INTO student (id,school_id,admission_id,session_id,class_id,section_id,"rollNo",finance_config,"createdAt","updatedAt") VALUES (
  'stu_mmmmmmmmmmmmmmmmmmmmm','sch_n6q4pmirqg7dpct1pr8pr','adm_lllllllllllllllllllll','sess_aaaaaaaaaaaaaaaaaaaaa',
  'cls_bbbbbbbbbbbbbbbbbbbbb','sec_ccccccccccccccccccccc',2,NULL,
  '2026-04-01 09:00:00','2026-04-01 09:00:00'
);
INSERT INTO staff (id,school_id,email,role,attributes,"createdAt","updatedAt") VALUES (
  'staff_fixture_principal','sch_n6q4pmirqg7dpct1pr8pr','principal@example.invalid','admin','{}',
  '2024-04-01 09:00:00','2024-04-01 09:00:00'
);
INSERT INTO "user" (id,name,email,email_verified,image,created_at,updated_at) VALUES (
  'usr_jjjjjjjjjjjjjjjjjjjjj','Synthetic Principal','principal@example.invalid',true,'https://legacy.invalid/provider-avatar.png',
  '2024-04-01 09:00:00','2024-04-01 09:00:00'
);
INSERT INTO account (id,account_id,provider_id,user_id,password,access_token,refresh_token,id_token,scope,created_at,updated_at) VALUES (
  'acc_kkkkkkkkkkkkkkkkkkkkk','usr_jjjjjjjjjjjjjjjjjjjjj','credential','usr_jjjjjjjjjjjjjjjjjjjjj',
  '00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  NULL,NULL,NULL,NULL,'2024-04-01 09:00:00','2024-04-01 09:00:00'
);
INSERT INTO account (id,account_id,provider_id,user_id,password,access_token,refresh_token,id_token,scope,created_at,updated_at) VALUES (
  'acc_oauth_fixture','oauth-subject','google','usr_jjjjjjjjjjjjjjjjjjjjj',NULL,
  'synthetic-access-token','synthetic-refresh-token','synthetic-id-token','openid',
  '2024-04-01 09:00:00','2024-04-01 09:00:00'
);
INSERT INTO session (id,user_id,token,expires_at,created_at,updated_at,is_student) VALUES (
  'session_fixture','usr_jjjjjjjjjjjjjjjjjjjjj','synthetic-session-token','2027-01-01 00:00:00','2026-01-01 00:00:00','2026-01-01 00:00:00',false
);
INSERT INTO verification (id,identifier,value,expires_at,created_at,updated_at) VALUES (
  'verification_fixture','principal@example.invalid','synthetic-verification-value','2027-01-01 00:00:00','2026-01-01 00:00:00','2026-01-01 00:00:00'
);
INSERT INTO apikey (id,reference_id,key,created_at,updated_at) VALUES (
  'apikey_fixture','usr_jjjjjjjjjjjjjjjjjjjjj','synthetic-api-key','2026-01-01 00:00:00','2026-01-01 00:00:00'
);
INSERT INTO school_onboarding (id,school_id,current_step,attributes) VALUES (
  'onboarding_fixture','sch_n6q4pmirqg7dpct1pr8pr',3,'{"step":"fixture"}'
);
INSERT INTO notice (id,school_id,session_id,title,content,created_by) VALUES (
  'notice_fixture','sch_n6q4pmirqg7dpct1pr8pr','sess_aaaaaaaaaaaaaaaaaaaaa',
  'Synthetic Notice','Synthetic notice body','staff_fixture_principal'
);
INSERT INTO ai_usage (id,school_id,usage_type,year,month,count) VALUES (
  'ai_usage_fixture','sch_n6q4pmirqg7dpct1pr8pr','template:ai',2026,7,4
);
INSERT INTO ai_quota (id,school_id,usage_type,monthly_limit) VALUES (
  'ai_quota_fixture','sch_n6q4pmirqg7dpct1pr8pr','template:ai',50
);
INSERT INTO exam_plan (id,school_id,session_id,"examSlug",class_id,"subjectSlug","totalMarks","modeConfig","totalWorkingDays",status,"createdAt","updatedAt") VALUES (
  'expl_fffffffffffffffffffff','sch_n6q4pmirqg7dpct1pr8pr','sess_aaaaaaaaaaaaaaaaaaaaa','term-1',
  'cls_bbbbbbbbbbbbbbbbbbbbb','math',100,'{"written":{"percentage":100,"maxMarks":100}}',81,'completed',
  '2024-09-01 09:00:00','2024-09-01 09:00:00'
);
INSERT INTO exam_result (id,school_id,session_id,exam_plan_id,student_id,marks,"coScholastics",days_attended,approved,"createdAt","updatedAt") VALUES (
  'exrs_ggggggggggggggggggggg','sch_n6q4pmirqg7dpct1pr8pr','sess_aaaaaaaaaaaaaaaaaaaaa',
  'expl_fffffffffffffffffffff','stu_eeeeeeeeeeeeeeeeeeeee','{"written":78}',
  '{"discipline":"A"}',52,true,'2024-09-15 09:00:00','2024-09-15 09:00:00'
);
INSERT INTO exam_timetable (id,school_id,session_id,"examSlug",config,"createdAt","updatedAt") VALUES (
  'ett_hhhhhhhhhhhhhhhhhhhhh','sch_n6q4pmirqg7dpct1pr8pr','sess_aaaaaaaaaaaaaaaaaaaaa','term-1',
  '{"columns":["cls_bbbbbbbbbbbbbbbbbbbbb"],"rows":[{"id":"slot-1","date":"2024-09-10","startTime":"09:00","endTime":"10:00","cells":{"cls_bbbbbbbbbbbbbbbbbbbbb":{"subjectSlug":"math","modeSlug":"written"}}}]}',
  '2024-09-01 09:00:00','2024-09-01 09:00:00'
);
INSERT INTO bill_generation_event (id,school_id,session_id,generated_by,meta,created_at,type) VALUES (
  'legacy_bill_run_fixture','sch_n6q4pmirqg7dpct1pr8pr','sess_aaaaaaaaaaaaaaaaaaaaa','staff_fixture_principal',
  '{"period":"2026-07","frequency":"monthly","totalAmount":"999.00","studentCount":9}',
  '2026-07-05 10:00:00','NEW'
);
INSERT INTO student_bill_event (id,student_id,bill_event_id,amount,line_items,version,created_at) VALUES (
  'legacy_bill_fixture','stu_eeeeeeeeeeeeeeeeeeeee','legacy_bill_run_fixture',100.00,
  '{"tuition":{"name":"Tuition","amount":"100.00","source":"school"}}',1,'2026-07-05 10:00:00'
);
INSERT INTO student_bill_event (id,student_id,bill_event_id,amount,line_items,version,created_at) VALUES (
  'legacy_manual_bill_fixture','stu_eeeeeeeeeeeeeeeeeeeee',NULL,25.00,
  '{"custom":{"name":"Approved synthetic manual charge","amount":"25.00","source":"manual"}}',2,'2026-07-05 11:00:00'
);
INSERT INTO student_bill_projection (student_id,total_billed,last_version) VALUES ('stu_eeeeeeeeeeeeeeeeeeeee',100.00,1);
INSERT INTO ledger_event (id,school_id,student_id,recorded_by,ref_bill_event_id,amount,discount,note,version,created_at) VALUES (
  'legacy_ledger_fixture','sch_n6q4pmirqg7dpct1pr8pr','stu_eeeeeeeeeeeeeeeeeeeee','staff_fixture_principal',
  'legacy_bill_run_fixture',40.00,10.00,'Synthetic payment and discount',1,'2026-07-06 10:00:00'
);
INSERT INTO ledger_projection (student_id,total_paid,total_discount,outstanding,last_bill_version,last_ledger_version) VALUES ('stu_eeeeeeeeeeeeeeeeeeeee',40.00,10.00,50.00,1,1);
INSERT INTO artifact (id,school_id,type,entity_type,entity_id,scope,s3_key,content_type,status,meta,"createdAt") VALUES (
  'art_iiiiiiiiiiiiiiiiiiiii','sch_n6q4pmirqg7dpct1pr8pr','bill_template','school',
  'sch_n6q4pmirqg7dpct1pr8pr',NULL,'legacy/templates/bill.hbs',
  'text/x-handlebars-template','current','{"size":"half"}','2024-04-01 09:00:00'
);
INSERT INTO artifact (id,school_id,type,entity_type,entity_id,scope,s3_key,content_type,status,meta,"createdAt") VALUES (
  'art_pdf_fixture','sch_n6q4pmirqg7dpct1pr8pr','result_pdf','student',
  'stu_eeeeeeeeeeeeeeeeeeeee','term-1','legacy/generated/result.pdf',
  'application/pdf','current','{}','2024-09-16 09:00:00'
);
INSERT INTO artifact (id,school_id,type,entity_type,entity_id,scope,s3_key,content_type,status,meta,"createdAt") VALUES (
  'art_notice_fixture','sch_n6q4pmirqg7dpct1pr8pr','notice_template','school',
  'sch_n6q4pmirqg7dpct1pr8pr',NULL,'legacy/templates/notice.hbs',
  'text/x-handlebars-template','current','{"size":"half"}','2024-04-01 09:00:00'
);
INSERT INTO artifact (id,school_id,type,entity_type,entity_id,scope,s3_key,content_type,status,meta,"createdAt") VALUES
  ('art_bulk_bill_fixture','sch_n6q4pmirqg7dpct1pr8pr','bulk_bill_pdf','school','sch_n6q4pmirqg7dpct1pr8pr','2026-07','legacy/generated/bulk-bill.pdf','application/pdf','current','{}','2026-07-05 12:00:00'),
  ('art_bulk_idcard_fixture','sch_n6q4pmirqg7dpct1pr8pr','bulk_idcard_pdf','school','sch_n6q4pmirqg7dpct1pr8pr','2026-2027','legacy/generated/bulk-idcard.pdf','application/pdf','current','{}','2026-04-05 12:00:00'),
  ('art_notice_pdf_fixture','sch_n6q4pmirqg7dpct1pr8pr','notice_pdf','notice','notice_fixture',NULL,'legacy/generated/notice.pdf','application/pdf','current','{}','2026-07-06 12:00:00');
