use super::*;
use crate::{
    assistance::{
        configuration::Configuration,
        proposal::{self, Proposal},
        settings::Config,
    },
    db::{ai_configuration::*, ai_jobs},
    imports::{parse, types::Mapping},
};
use serde_json::json;
fn op() -> String {
    Uuid::new_v4().to_string()
}
fn start(db: &mut Store, source: &str, kind: &str) -> String {
    let config = Config {
        enabled: true,
        revision: 1,
        model: "synthetic-model".into(),
    };
    let input = ai_jobs::Input {
        source_id: source.into(),
        source_revision: db.import_detail(source).unwrap().source.revision,
        provider: "openai".into(),
        task: kind.into(),
        scope: "text".into(),
        text: "Synthetic configuration material".into(),
    };
    let token = db.ai_prepare(&input, &config).unwrap().token;
    let id = op();
    db.ai_begin(
        &ai_jobs::Start {
            id: id.clone(),
            input,
            token,
            confirmed: true,
        },
        &config,
        "synthetic-session",
    )
    .unwrap();
    id
}
fn finish(db: &mut Store, id: &str, c: Configuration) {
    db.ai_finish(
        id,
        Ok(json!({"fields":[],"rows":[],"warnings":[],"configuration":c})),
    )
    .unwrap();
}
fn setup(db: &mut Store) -> (String, String, Mapping) {
    let bytes=b"Date,Description,Amount\n2026-10-01,Store,100.00\n2026-10-01,Store,100.00\n2026-10-02,Other,424.00\n2026-10-03,CARD PAYMENT,-624.00\n";
    let p = parse::prepare("synthetic.csv", bytes, None).unwrap();
    let mut m = parse::default_mapping(&p.dataset);
    m.amount_mode = "outflow_positive".into();
    m.date_format = "iso".into();
    let id = db.ingest("synthetic.csv", bytes.to_vec(), p).unwrap();
    let j = start(db, &id, "mapping");
    finish(db, &j, Configuration::Mapping(m.clone()));
    (id, j, m)
}
fn input(db: &Store, source: &str, job: &str, m: Mapping) -> Input {
    Input {
        job_id: job.into(),
        source_revision: db.import_detail(source).unwrap().source.revision,
        account: "amex".into(),
        mapping: m,
    }
}
fn save(db: &Store, i: Input) -> Save {
    Save {
        token: db.ai_mapping_preview(i.clone()).unwrap().token,
        input: i,
        confirmed: true,
    }
}
#[test]
fn ai_configuration_cannot_confirm_source_facts_enable_automation_or_return_executable_rules() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (_source, _j, m) = setup(&mut db);
    for change in [0, 1, 2, 3] {
        let mut m = m.clone();
        match change {
            0 => m.posted_confirmed = true,
            1 => m.stable_ids_confirmed = true,
            2 => m.year = Some(2026),
            _ => m.amount_column = Some(100),
        };
        assert!(Configuration::Mapping(m).validate().is_err());
    }
    let raw = json!({"kind":"script","definition":{"code":"execute"}});
    assert!(serde_json::from_value::<Configuration>(raw).is_err());
    let unsupported: Proposal = serde_json::from_value(
        json!({"fields":[],"rows":[],"warnings":["No reliable layout"],"configuration":null}),
    )
    .unwrap();
    proposal::validate(&unsupported, "pdf_table", Some(1)).unwrap();
    let old: Proposal =
        serde_json::from_value(json!({"fields":[],"rows":[],"warnings":[]})).unwrap();
    assert_eq!(
        serde_json::to_string(&old).unwrap(),
        "{\"fields\":[],\"rows\":[],\"warnings\":[]}"
    );
    for task in ["mapping", "pdf_template", "pdf_table"] {
        let schema = proposal::schema(task);
        assert_eq!(
            schema["properties"]["configuration"]["anyOf"][0]["properties"]["kind"]["enum"][0],
            task
        );
        assert!(proposal::instructions(task)
            .unwrap()
            .contains("configuration"));
    }
}
#[test]
fn ai_configuration_mapping_wire_uses_role_index_pairs_and_still_reads_stored_shape() {
    let wire = json!({"kind":"mapping","definition":{"columns":[{"role":"date","index":0},{"role":"description","index":1},{"role":"amount","index":2},{"role":"currency","index":5}],"amountMode":"outflow_positive","dateFormat":"iso","year":null,"postedConfirmed":false,"stableIdsConfirmed":false}});
    let Configuration::Mapping(m) = serde_json::from_value(wire.clone()).unwrap() else {
        panic!("wrong kind")
    };
    assert_eq!(m.date_column, Some(0));
    assert_eq!(m.description_column, Some(1));
    assert_eq!(m.amount_column, Some(2));
    assert_eq!(m.currency_column, Some(5));
    assert_eq!(m.debit_column, None);
    assert_eq!(m.year, None);
    assert!(!m.posted_confirmed && !m.stable_ids_confirmed);
    Configuration::Mapping(m.clone()).validate().unwrap();
    let stored = serde_json::to_value(Configuration::Mapping(m.clone())).unwrap();
    assert!(stored["definition"]["dateColumn"].is_number());
    let Configuration::Mapping(again) = serde_json::from_value(stored).unwrap() else {
        panic!("wrong kind")
    };
    assert_eq!(
        serde_json::to_value(again).unwrap(),
        serde_json::to_value(m).unwrap()
    );
    for (path, value) in [
        ("/definition/columns/0/role", json!("date")),
        ("/definition/columns/0/role", json!("balance")),
        ("/definition/columns/0/index", json!(-1)),
        ("/definition/columns/0/extra", json!(1)),
        ("/definition/year", json!(2026)),
    ] {
        let mut bad = wire.clone();
        if path.ends_with("extra") {
            bad["definition"]["columns"][0]["extra"] = value;
        } else if path.ends_with("/role") {
            bad["definition"]["columns"][1]["role"] = value;
        } else {
            *bad.pointer_mut(path).unwrap() = value;
        }
        let parsed = serde_json::from_value::<Configuration>(bad);
        assert!(
            parsed.is_err() || parsed.unwrap().validate().is_err(),
            "{path}"
        );
    }
    let mut far = wire;
    far["definition"]["columns"][2]["index"] = json!(80);
    assert!(serde_json::from_value::<Configuration>(far)
        .unwrap()
        .validate()
        .is_err());
    let schema = proposal::schema("mapping");
    let definition = &schema["properties"]["configuration"]["anyOf"][0]["properties"]["definition"];
    assert_eq!(
        definition["properties"]["columns"]["items"]["properties"]["role"]["enum"]
            .as_array()
            .unwrap()
            .len(),
        10
    );
    assert!(definition["properties"].get("dateColumn").is_none());
}
#[test]
fn ai_configuration_mapping_requires_review_keeps_twins_and_payment_signs_then_imports_once() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (source, j, mut m) = setup(&mut db);
    assert!(matches!(
        db.ai_configuration(&j, 1).unwrap(),
        Configuration::Mapping(_)
    ));
    assert!(db.snapshot("2026-10").unwrap().entries.is_empty());
    let i = input(&db, &source, &j, m.clone());
    let p = db.ai_mapping_preview(i.clone()).unwrap();
    assert_eq!(p.candidates[3].direction, "in");
    assert_eq!(p.candidates[3].amount_cents, Some(62400));
    assert_ne!(p.candidates[0].status, "posted");
    let mut stale = save(&db, i);
    stale.input.mapping.posted_confirmed = true;
    assert!(db.ai_mapping_apply(&op(), stale).is_err());
    m.posted_confirmed = true;
    let s = save(&db, input(&db, &source, &j, m));
    let raw = serde_json::to_string(&s).unwrap();
    let operation = op();
    db.ai_mapping_apply(&operation, s).unwrap();
    db.ai_mapping_apply(&operation, serde_json::from_str(&raw).unwrap())
        .unwrap();
    assert_eq!(db.import_detail(&source).unwrap().source.revision, 2);
    for index in 0..4 {
        let d = db.import_detail(&source).unwrap();
        let row = &d.rows[index];
        let mut decision = super::imports::add(row);
        decision.separate = true;
        if index == 3 {
            let e = decision.input.as_mut().unwrap();
            e.kind = "card_payment".into();
            e.account_id = Some("checking".into());
            e.destination_account_id = Some("amex".into());
            e.category_id = None;
            e.split_mode = "none".into();
        }
        super::imports::commit(&mut db, &d, vec![decision]).unwrap();
    }
    let s = db.snapshot("2026-10").unwrap();
    assert_eq!(s.spent_cents, 62400);
    assert_eq!(s.entries.len(), 4);
    assert_eq!(
        s.accounts
            .iter()
            .find(|a| a.id == "amex")
            .unwrap()
            .activity_cents,
        0
    );
    assert!(db
        .ai_configuration(&j, db.import_detail(&source).unwrap().source.revision)
        .is_err());
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
    assert_eq!(db.snapshot("2026-10").unwrap().spent_cents, 62400);
}
#[test]
fn ai_configuration_mapping_atomicity_staleness_workspace_and_corrupt_recovery() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (source, j, m) = setup(&mut db);
    let i = input(&db, &source, &j, m);
    let s = save(&db, i.clone());
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    c.execute_batch("CREATE TRIGGER fail_ai_mapping BEFORE INSERT ON audit WHEN NEW.action='ai_mapping_applied' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;").unwrap();
    assert!(db.ai_mapping_apply(&op(), s).is_err());
    assert_eq!(db.import_detail(&source).unwrap().source.revision, 1);
    assert!(db
        .import_detail(&source)
        .unwrap()
        .source
        .account_id
        .is_none());
    c.execute_batch("DROP TRIGGER fail_ai_mapping").unwrap();
    let other = Store::open(dir.path(), "demo").unwrap();
    assert!(other.ai_mapping_preview(i.clone()).is_err());
    let mut bad = i.clone();
    bad.mapping.amount_column = Some(70);
    assert!(db.ai_mapping_preview(bad).is_err());
    let s = save(&db, i);
    db.ai_mapping_apply(&op(), s).unwrap();
    assert!(db.ai_configuration(&j, 2).is_err());
    for sql in ["UPDATE ai_mapping_reviews SET input_json=json_set(input_json,'$.input.mapping.amountMode','inflow_positive')","UPDATE ai_mapping_reviews SET dataset_json=json_set(dataset_json,'$.rows[0][2]','999.00')","UPDATE ai_mapping_reviews SET proposal_hash='wrong'","DELETE FROM ai_mapping_reviews","DELETE FROM audit WHERE action='ai_mapping_applied'"]{let b=db.backup().unwrap();let c=rusqlite::Connection::open(dir.path().join("backups/personal").join(&b)).unwrap();c.execute_batch(sql).unwrap();drop(c);assert!(db.restore(&b).is_err(),"{sql}");assert_eq!(db.import_detail(&source).unwrap().source.revision,2);}
}
#[test]
fn ai_configuration_pdf_document_suggestion_uses_local_preview_and_approval_before_any_application()
{
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let source = super::pdf_documents::ingest(&mut db, "bill");
    let j = start(&mut db, &source, "pdf_template");
    finish(
        &mut db,
        &j,
        Configuration::Document(super::pdf_documents::definition("bill")),
    );
    let Configuration::Document(definition) = db.ai_configuration(&j, 1).unwrap() else {
        panic!("wrong proposal")
    };
    assert!(db.pdf_document(&source).unwrap().templates.is_empty());
    let i = crate::db::pdf_documents::Sample {
        source_id: source.clone(),
        source_revision: 1,
        id: op(),
        revision: 0,
        definition,
    };
    let p = db.preview_pdf_template(i.clone()).unwrap();
    assert_eq!(p.extraction.cents("amount_due"), Some(8600));
    db.approve_pdf_template(
        &op(),
        crate::db::pdf_documents::Approval {
            input: i.clone(),
            token: p.token,
            confirmed: true,
        },
    )
    .unwrap();
    assert!(db.snapshot("2026-11").unwrap().entries.is_empty());
    let mut bad = i.clone();
    bad.id = op();
    bad.definition.fields[0].label = "Missing invoice total".into();
    let p = db.preview_pdf_template(bad.clone()).unwrap();
    assert!(!p.extraction.errors.is_empty());
    assert!(db
        .approve_pdf_template(
            &op(),
            crate::db::pdf_documents::Approval {
                input: bad,
                token: p.token,
                confirmed: true
            }
        )
        .is_err());
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
}
#[test]
fn ai_configuration_pdf_table_suggestion_stays_manual_until_reviewed_approved_and_staged() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let bytes = include_bytes!("../../fixtures/pdf/transactions.pdf");
    let p = parse::prepare("table.pdf", bytes, None).unwrap();
    let source = db.ingest("table.pdf", bytes.to_vec(), p).unwrap();
    let j = start(&mut db, &source, "pdf_table");
    let mut definition = crate::imports::pdf_table::Definition {
        name: "Suggested card table".into(),
        identity: "SYNTHETIC CARD ACTIVITY".into(),
        currency: "Currency: USD".into(),
        start: "Transactions".into(),
        end: "End transactions".into(),
        headers: vec!["Date".into(), "Description".into(), "Amount".into()],
        separator: "pipe".into(),
        automatic: true,
    };
    assert!(Configuration::Table(definition.clone()).validate().is_err());
    definition.automatic = false;
    finish(&mut db, &j, Configuration::Table(definition.clone()));
    assert!(db.import_detail(&source).unwrap().rows.is_empty());
    db.ai_configuration(&j, 1).unwrap();
    let request = crate::db::pdf_tables::Request {
        source_id: source.clone(),
        source_revision: 1,
        template_id: op(),
        template_revision: 0,
        definition: Some(definition),
    };
    let stage = crate::db::pdf_tables::Request {
        definition: None,
        template_revision: 1,
        ..request.clone()
    };
    let p = db.preview_pdf_table(request.clone()).unwrap();
    db.save_pdf_table(
        &op(),
        crate::db::pdf_tables::Save {
            request,
            token: p.token,
            confirmed: true,
        },
    )
    .unwrap();
    assert!(db.import_detail(&source).unwrap().rows.is_empty());
    let p = db.preview_pdf_table(stage.clone()).unwrap();
    db.save_pdf_table(
        &op(),
        crate::db::pdf_tables::Save {
            request: stage,
            token: p.token,
            confirmed: true,
        },
    )
    .unwrap();
    assert_eq!(db.import_detail(&source).unwrap().rows.len(), 6);
    assert!(db.snapshot("2026-10").unwrap().entries.is_empty());
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
}
#[test]
fn ai_configuration_schema33_upgrade_preserves_configuration_requests() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let (source, j, m) = setup(&mut db);
    drop(db);
    let c = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    super::remove_ai_mapping_schema(&c);
    c.pragma_update(None, "user_version", 33).unwrap();
    drop(c);
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let s = save(&db, input(&db, &source, &j, m));
    db.ai_mapping_apply(&op(), s).unwrap();
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
}
#[test]
fn ai_configuration_excel_uses_normalized_excel_format_and_preserves_dates_and_money() {
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let bytes = include_bytes!("../fixtures/import.xlsx");
    let p = parse::prepare("fixture.xlsx", bytes, None).unwrap();
    assert_eq!(p.format, "excel");
    let mut m = parse::default_mapping(&p.dataset);
    m.amount_mode = "outflow_positive".into();
    m.date_format = "iso".into();
    let source = db.ingest("fixture.xlsx", bytes.to_vec(), p).unwrap();
    let j = start(&mut db, &source, "mapping");
    finish(&mut db, &j, Configuration::Mapping(m.clone()));
    db.ai_configuration(&j, 1).unwrap();
    m.posted_confirmed = true;
    let i = input(&db, &source, &j, m);
    let p = db.ai_mapping_preview(i.clone()).unwrap();
    assert_eq!(p.candidates[0].date.as_deref(), Some("2026-11-02"));
    assert_eq!(p.candidates[0].amount_cents, Some(12345));
    let s = save(&db, i);
    db.ai_mapping_apply(&op(), s).unwrap();
    assert!(db.snapshot("2026-11").unwrap().entries.is_empty());
    let b = db.backup().unwrap();
    db.restore(&b).unwrap();
}

#[test]
fn claude_api_upgrade_keeps_sheet_defaults_closed_month_and_reviewed_mapping() {
    use crate::assistance::client;
    let dir = tempfile::tempdir().unwrap();
    let mut db = Store::open(dir.path(), "personal").unwrap();
    let mut groceries = category_input(&db, "groceries");
    groceries.default_limit = "650".into();
    groceries.icon = "groceries".into();
    db.save_category(groceries).unwrap();
    db.apply_budget_template("2026-10", None, false).unwrap();
    let mut old = expense("100", "jacob");
    old.date = "2026-10-02".into();
    old.category_id = Some("electric".into());
    db.save(old.clone()).unwrap();
    let review = db.close_review("2026-10").unwrap();
    assert!(review.blockers.is_empty());
    db.close_month(crate::db::periods::CloseInput {
        id: op(),
        month: "2026-10".into(),
        revision: review.revision,
        token: review.token,
        carry: None,
        note: "Synthetic integrated close".into(),
        acknowledgements: review.warnings.into_iter().map(|w| w.id).collect(),
    })
    .unwrap();
    let closed =
        serde_json::to_value(db.annual_report(2026).unwrap()).unwrap()["months"][9].clone();
    let (old_source, old_job, _) = setup(&mut db);
    drop(db);
    let conn = rusqlite::Connection::open(dir.path().join("personal.sqlite")).unwrap();
    super::remove_ai_usage_schema(&conn);
    conn.pragma_update(None, "user_version", 36).unwrap();
    drop(conn);

    let mut db = Store::open(dir.path(), "personal").unwrap();
    let snapshot = db.snapshot("2026-10").unwrap();
    assert_eq!(snapshot.categories.len(), 26);
    assert_eq!(category_input(&db, "groceries").default_limit, "650.00");
    assert_eq!(category_input(&db, "electric").default_limit, "100.00");
    assert_eq!(
        (snapshot.spent_cents, snapshot.budget_cents),
        (7000, 578200)
    );
    assert!(!db.close_review("2026-10").unwrap().changed);
    assert_eq!(
        closed,
        serde_json::to_value(db.annual_report(2026).unwrap()).unwrap()["months"][9]
    );
    assert_eq!(db.ai_jobs(&old_source).unwrap()[0].status, "completed");
    assert!(matches!(
        db.ai_configuration(&old_job, 1).unwrap(),
        Configuration::Mapping(_)
    ));

    let bytes =
        b"Date,Description,Amount\n2026-11-02,Electric,100.00\n2026-11-03,Groceries,50.00\n";
    let prepared = parse::prepare("integration.csv", bytes, None).unwrap();
    let source = db
        .ingest("integration.csv", bytes.to_vec(), prepared)
        .unwrap();
    let config = Config {
        enabled: true,
        revision: 1,
        model: crate::assistance::settings::DEFAULT_CLAUDE_MODEL.into(),
    };
    let request = ai_jobs::Input {
        source_id: source.clone(),
        source_revision: 1,
        provider: "claude".into(),
        task: "mapping".into(),
        scope: "text".into(),
        text: String::from_utf8(bytes.to_vec()).unwrap(),
    };
    let token = db.ai_prepare(&request, &config).unwrap().token;
    let job = op();
    let (_, material) = db
        .ai_begin(
            &ai_jobs::Start {
                id: job.clone(),
                input: request,
                token,
                confirmed: true,
            },
            &config,
            "integration",
        )
        .unwrap();
    let payload = client::body(
        "claude",
        &config.model,
        &proposal::instructions("mapping").unwrap(),
        &material.unwrap(),
        &proposal::schema("mapping"),
    )
    .unwrap();
    assert_eq!(payload["output_config"]["effort"], "high");
    let wire = json!({"fields":[],"rows":[],"warnings":[],"configuration":{"kind":"mapping","definition":{"columns":[{"role":"date","index":0},{"role":"description","index":1},{"role":"amount","index":2}],"amountMode":"outflow_positive","dateFormat":"iso","year":null,"postedConfirmed":false,"stableIdsConfirmed":false}}});
    let envelope = json!({"stop_reason":"end_turn","content":[{"type":"thinking","thinking":"synthetic"},{"type":"text","text":wire.to_string()}],"usage":{"input_tokens":1200,"output_tokens":340}});
    let outcome = client::decode("claude", envelope.to_string().as_bytes()).unwrap();
    let completed = db.ai_finish(&job, Ok(outcome)).unwrap();
    assert_eq!(completed.status, "completed");
    assert_eq!(completed.usage.unwrap().output_tokens, 340);
    assert!(db.snapshot("2026-11").unwrap().entries.is_empty());
    let Configuration::Mapping(mut mapping) = db.ai_configuration(&job, 1).unwrap() else {
        panic!("expected mapping")
    };
    assert!(!mapping.posted_confirmed);
    mapping.posted_confirmed = true; // A human reviews this source property.
    let reviewed = save(&db, input(&db, &source, &job, mapping));
    db.ai_mapping_apply(&op(), reviewed).unwrap();
    let detail = db.import_detail(&source).unwrap();
    assert_eq!(detail.rows.len(), 2);
    assert!(db.snapshot("2026-11").unwrap().entries.is_empty());
    let mut decision = super::imports::add(&detail.rows[0]);
    let entry = decision.input.as_mut().unwrap();
    entry.category_id = Some("electric".into());
    entry.split_mode = "shared".into();
    super::imports::commit(&mut db, &detail, vec![decision]).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().spent_cents, 7000);
    db.apply_budget_template("2026-11", None, false).unwrap();
    assert_eq!(db.snapshot("2026-11").unwrap().budget_cents, 578200);
    let backup = db.backup().unwrap();
    db.restore(&backup).unwrap();
    assert_eq!(
        db.ai_jobs(&source).unwrap()[0]
            .usage
            .as_ref()
            .unwrap()
            .input_tokens,
        1200
    );
    assert!(!db.close_review("2026-10").unwrap().changed);
    old.revision = 1;
    old.amount = "200".into();
    assert!(db.save(old).unwrap_err().contains("closed"));
    assert_eq!(
        category_input(&Store::open(dir.path(), "demo").unwrap(), "groceries").default_limit,
        "700.00"
    );
}
