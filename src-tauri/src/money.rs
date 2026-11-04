//! All authoritative amounts are bounded integer cents. No floating point money.
pub const MAX_CENTS: i64 = 10_000_000_000;

pub fn cents(text: &str) -> Result<i64, String> {
    let text = text.trim();
    let parts: Vec<_> = text.split('.').collect();
    if parts.is_empty()
        || parts.len() > 2
        || parts[0].is_empty()
        || !parts[0].bytes().all(|b| b.is_ascii_digit())
        || (parts.len() == 2
            && (parts[1].is_empty()
                || parts[1].len() > 2
                || !parts[1].bytes().all(|b| b.is_ascii_digit())))
    {
        return Err("Enter a positive dollar amount with at most two decimal places.".into());
    }
    let dollars = parts[0]
        .parse::<i64>()
        .map_err(|_| "Amount is too large.")?;
    let fraction = if parts.len() == 2 {
        parts[1].parse::<i64>().unwrap() * if parts[1].len() == 1 { 10 } else { 1 }
    } else {
        0
    };
    let amount = dollars
        .checked_mul(100)
        .and_then(|n| n.checked_add(fraction))
        .ok_or("Amount is too large.")?;
    if amount > MAX_CENTS {
        return Err("Amount exceeds the supported limit.".into());
    }
    Ok(amount)
}

pub fn allocation(total: i64, mode: &str, value: &str) -> Result<(i64, i64), String> {
    if !(1..=MAX_CENTS).contains(&total) {
        return Err("Amount must be greater than zero.".into());
    }
    let jacob = match mode {
        "personal" => total,
        "chelsea" => 0,
        "shared" => (total * 7000 + 5000) / 10000,
        "equal" => (total + 1) / 2,
        "percent" => {
            let basis_points = cents(value)?;
            if basis_points > 10000 {
                return Err("Jacob's percentage must be between 0 and 100.".into());
            }
            (total * basis_points + 5000) / 10000
        }
        "exact" => cents(value)?,
        _ => return Err("Choose a supported split.".into()),
    };
    if jacob > total {
        return Err("Jacob's share cannot exceed the expense.".into());
    }
    Ok((jacob, total - jacob))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_decimal_validation() {
        assert_eq!(cents("126.69"), Ok(12669));
        assert_eq!(cents("1.1"), Ok(110));
        for bad in [
            "NaN",
            "-1",
            "1e5",
            "1.001",
            "1,200",
            "",
            "1.",
            "99999999999999999999",
        ] {
            assert!(cents(bad).is_err(), "{bad}");
        }
    }
    #[test]
    fn agreed_split_examples_and_overrides() {
        assert_eq!(allocation(12669, "shared", ""), Ok((8868, 3801)));
        assert_eq!(allocation(195479, "shared", ""), Ok((136835, 58644)));
        assert_eq!(allocation(4800, "shared", ""), Ok((3360, 1440)));
        assert_eq!(allocation(1, "equal", ""), Ok((1, 0)));
        assert_eq!(allocation(10000, "percent", "33.33"), Ok((3333, 6667)));
        assert_eq!(allocation(10000, "exact", "12.34"), Ok((1234, 8766)));
        assert!(allocation(100, "exact", "1.01").is_err());
        assert!(allocation(100, "percent", "100.01").is_err());
    }
    #[test]
    fn shares_always_sum_to_full_payment() {
        for n in 1..100000 {
            let (j, c) = allocation(n, "shared", "").unwrap();
            assert_eq!(j + c, n);
            assert!(j >= 0 && c >= 0);
        }
    }
}
