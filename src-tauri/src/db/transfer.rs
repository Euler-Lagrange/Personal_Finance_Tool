use super::*;

pub(super) fn validate(
    conn: &Connection,
    input: &EntryInput,
    source_kind: Option<&str>,
) -> Result<()> {
    if !matches!(source_kind, Some("checking" | "savings")) {
        return Err("Choose a checking or savings account to pay from.".into());
    }
    if input.payer != "jacob"
        || input.category_id.is_some()
        || input.split_mode != "none"
        || !input.split_value.is_empty()
    {
        return Err(
            "Transfers move money between your accounts without a category or shared split.".into(),
        );
    }
    if input.date > Local::now().format("%Y-%m-%d").to_string() {
        return Err("Only record a transfer or card payment after it happens.".into());
    }
    let destination = input
        .destination_account_id
        .as_ref()
        .ok_or("Choose the destination account.")?;
    if Some(destination) == input.account_id.as_ref() {
        return Err("Choose two different accounts.".into());
    }
    let (kind, archived): (String, bool) = conn
        .query_row(
            "SELECT kind,archived FROM accounts WHERE id=?1",
            [destination],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| "Choose a valid destination account.")?;
    if archived {
        let previous: Option<String> = conn
            .query_row(
                "SELECT destination_account_id FROM events WHERE id=?1",
                [&input.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?
            .flatten();
        if previous.as_ref() != Some(destination) {
            return Err("This destination account is archived. Choose an active account.".into());
        }
    }
    if (input.kind == "card_payment" && kind != "credit")
        || (input.kind == "transfer" && kind == "credit")
    {
        return Err(
            "Use Card payment for a credit card, or Bank transfer for checking and savings.".into(),
        );
    }
    Ok(())
}
