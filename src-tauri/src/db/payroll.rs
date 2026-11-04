use super::*;
use crate::payroll::{self as model, Change, State as PayState};
use serde::Serialize;

fn json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(err)
}
fn hash<T: Serialize>(value: &T) -> Result<String> {
    Ok(crate::imports::parse::hash(json(value)?.as_bytes()))
}
pub(super) fn read(conn: &Connection) -> Result<(i64, PayState)> {
    let saved: Option<(i64, String)> = conn
        .query_row(
            "SELECT revision,state_json FROM payroll_state WHERE singleton=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    match saved {
        Some((revision, raw)) => {
            let state = serde_json::from_str(&raw).map_err(err)?;
            model::validate(&state)?;
            Ok((revision, state))
        }
        None => Ok((0, PayState::default())),
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub revision: i64,
    pub state: PayState,
    pub week: model::Week,
    pub sick_year: model::SickYear,
    pub observation_issues: std::collections::BTreeMap<String, Vec<String>>,
    pub forecast_status: Vec<crate::pay_forecast::ForecastStatus>,
    pub calibration_current: std::collections::BTreeMap<String, bool>,
}
impl Store {
    pub fn payroll_view(&self, day: &str, year: i32) -> Result<View> {
        if !(1900..=2100).contains(&year) {
            return Err("Choose a year between 1900 and 2100.".into());
        }
        let (revision, state) = read(&self.conn)?;
        let week = model::week(&state, day)?;
        let sick_year = model::sick_year(&state, year);
        let observation_issues = state
            .observations
            .iter()
            .map(|(id, o)| (id.clone(), crate::pay_forecast::observation_issues(o)))
            .collect();
        let mut forecast_status = Vec::new();
        let calibration_current = state
            .calibrations
            .iter()
            .map(|(id, c)| (id.clone(), crate::pay_tax::calibration_current(&state, c)))
            .collect();
        for f in state.forecasts.values() {
            let created:String=self.conn.query_row("SELECT created_at FROM payroll_changes WHERE json_extract(change_json,'$.kind')='forecast' AND json_extract(change_json,'$.input.id')=?1",[&f.input.id],|r|r.get(0)).map_err(err)?;
            forecast_status.push(crate::pay_forecast::status(&state, f, created));
        }
        Ok(View {
            revision,
            state,
            week,
            sick_year,
            observation_issues,
            forecast_status,
            calibration_current,
        })
    }
    pub fn preview_pay_forecast(
        &self,
        input: crate::pay_forecast::ForecastInput,
    ) -> Result<crate::pay_forecast::Forecast> {
        crate::pay_forecast::forecast(&read(&self.conn)?.1, &input)
    }
    pub fn pay_scenarios(
        &self,
        input: crate::pay_forecast::ScenarioInput,
    ) -> Result<Vec<crate::pay_forecast::Scenario>> {
        crate::pay_forecast::scenarios(&read(&self.conn)?.1, &input)
    }
    pub fn preview_pay_calibration(
        &self,
        id: &str,
        observation_id: &str,
        input: crate::pay_tax::Inputs,
    ) -> Result<crate::pay_tax::Calibration> {
        crate::pay_tax::calibration(&read(&self.conn)?.1, id, observation_id, &input)
    }
    pub fn save_payroll(&mut self, operation: &str, revision: i64, change: Change) -> Result<i64> {
        Uuid::parse_str(operation).map_err(|_| "Invalid payroll operation identifier.")?;
        let payload_hash = hash(&(revision, &change))?;
        let prior: Option<(i64, String)> = self
            .conn
            .query_row(
                "SELECT revision,payload_hash FROM payroll_changes WHERE id=?1",
                [operation],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if let Some((saved_revision, old_hash)) = prior {
            if old_hash != payload_hash {
                return Err(
                    "This payroll save identifier was already used for different changes.".into(),
                );
            }
            return Ok(saved_revision);
        }
        self.backup()?;
        let tx = self.conn.transaction().map_err(err)?;
        let (current, mut state) = read(&tx)?;
        if current != revision {
            return Err("Pay & hours changed. Reload before saving these edits.".into());
        }
        super::pay_calendar::validate_change(&tx, &change)?;
        super::pay_cash::validate_change(&tx, &state, &change)?;
        model::apply(&mut state, &change)?;
        super::pay_cash::validate_references(&tx, &state)?;
        let next = current
            .checked_add(1)
            .ok_or("Payroll revision is too large.")?;
        tx.execute("INSERT INTO payroll_state VALUES(1,?1,?2) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json",params![next,json(&state)?]).map_err(err)?;
        tx.execute("INSERT INTO payroll_changes(id,revision,payload_hash,change_json,state_hash) VALUES(?1,?2,?3,?4,?5)",params![operation,next,payload_hash,json(&change)?,hash(&state)?]).map_err(err)?;
        tx.execute(
            "INSERT INTO audit(action,payload) VALUES('payroll_change',?1)",
            [operation],
        )
        .map_err(err)?;
        periods::commit(tx)?;
        Ok(next)
    }
}
pub(super) fn validate(conn: &Connection) -> Result<()> {
    conn.prepare("SELECT singleton,revision,state_json FROM payroll_state LIMIT 0")
        .map_err(err)?;
    let (revision, state) = read(conn)?;
    model::validate(&state)?;
    let mut q=conn.prepare("SELECT id,revision,payload_hash,change_json,state_hash,created_at FROM payroll_changes ORDER BY revision").map_err(err)?;
    let mut rows = q.query([]).map_err(err)?;
    let mut replay = PayState::default();
    let mut expected = 1;
    while let Some(row) = rows.next().map_err(err)? {
        let id: String = row.get(0).map_err(err)?;
        let step: i64 = row.get(1).map_err(err)?;
        let payload: String = row.get(2).map_err(err)?;
        let raw: String = row.get(3).map_err(err)?;
        let state_hash: String = row.get(4).map_err(err)?;
        let created: String = row.get(5).map_err(err)?;
        Uuid::parse_str(&id).map_err(|_| "Invalid saved payroll operation.")?;
        chrono::DateTime::parse_from_rfc3339(&created)
            .map_err(|_| "Invalid payroll history time.")?;
        let change: Change = serde_json::from_str(&raw).map_err(err)?;
        if step != expected || payload != hash(&(step - 1, &change))? {
            return Err("Payroll change history is inconsistent.".into());
        }
        super::pay_calendar::validate_change(conn, &change)?;
        model::apply(&mut replay, &change)?;
        if state_hash != hash(&replay)? {
            return Err("Payroll history does not match its retained calculation inputs.".into());
        }
        expected += 1;
    }
    if revision != expected - 1 || state != replay {
        return Err("Pay & hours records do not match their revision history.".into());
    }
    super::pay_cash::validate_references(conn, &state)?;
    Ok(())
}
