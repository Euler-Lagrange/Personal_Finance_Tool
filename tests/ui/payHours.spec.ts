import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const w = window as any;
    w.isTauri = true;
    w.calls = [];
    w.receipts = {};
    w.paySources = [];
    w.payDocuments = {};
    w.payCashPlans = [];
    w.paySchedules = [];
    w.payTakeovers = {};
    w.payFinalized = {};
    w.payBankDeposits = [];
    w.pay = {
      revision: 0,
      state: {
        employer: "Synthetic employer",
        usualWeek: [80000, 80000, 80000, 80000, 80000, 0, 0],
        rates: {},
        days: {},
        holidays: {},
        holidayYears: [],
        openingSickUsed: {},
        periods: {},
        observations: {},
        forecasts: {},
        selectedForecasts: {},
        taxProfiles: {},
        calibrations: {},
      },
      week: {
        start: "2026-11-02",
        end: "2026-11-08",
        worked: 0,
        sick: 0,
        forecastHours: 0,
        actualGrossCents: 0,
        forecastGrossCents: 0,
        unrecordedDays: 7,
        issues: [],
      },
      sickYear: {
        year: 2026,
        allowance: 40,
        openingUsed: null,
        recorded: 0,
        reserved: 0,
        remaining: null,
        holidaysComplete: false,
      },
      observationIssues: {},
      forecastStatus: [],
      calibrationCurrent: {},
    };
    w.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any = {}) => {
        w.calls.push({ cmd, args: structuredClone(args) });
        if (cmd === "snapshot")
          return {
            workspace: args.workspace,
            month: args.month,
            entries: [],
            householdEntries: [],
            accounts: [
              {
                id: "checking",
                name: "Synthetic checking",
                kind: "checking",
                archived: false,
                revision: 1,
                activityCents: 0,
              },
              {
                id: "savings",
                name: "Synthetic savings",
                kind: "savings",
                archived: false,
                revision: 1,
                activityCents: 0,
              },
            ],
            categories: [],
            spentCents: 0,
            consumptionCents: 0,
            debtPaymentCents: 0,
            incomeCents: 0,
            budgetCents: 0,
            remainingCents: 0,
            budgetConfigured: false,
            householdCents: 0,
            householdMonthSpentCents: 0,
            monthlyCount: 0,
            incompleteImports: 0,
            provisionalAllowanceCents: 0,
            unclassifiedCount: 0,
            pendingFundingCount: 0,
            fundingReviewEntries: [],
            goalExcludedCents: 0,
            allowanceCents: 0,
            dataPath: `synthetic-${args.workspace}.sqlite`,
            backups: [],
          };
        if (cmd === "pay_sources") return structuredClone(w.paySources);
        if (cmd === "pay_cash_view") {
          if (w.failCashRead) throw "Synthetic payroll cash read failure";
          return structuredClone({
            revision: w.pay.revision,
            plans: w.payCashPlans,
            schedules: w.paySchedules,
            takeovers: w.payTakeovers,
            finalized: w.payFinalized,
          });
        }
        if (cmd === "pay_deposit_candidates")
          return structuredClone(w.payBankDeposits);
        if (cmd === "pay_annual")
          return {
            year: args.year,
            work: Array.from({ length: 12 }, (_, i) => ({
              month: `${args.year}-${String(i + 1).padStart(2, "0")}`,
              recordedDays: i === 9 ? 20 : 0,
              unrecordedPlannedDays: 0,
              worked: i === 9 ? 1600000 : 0,
              sick: 0,
              unpaid: 0,
              earnedGrossCents: i === 9 ? 1488000 : null,
            })),
            paid: Array.from({ length: 12 }, (_, i) => ({
              month: `${args.year}-${String(i + 1).padStart(2, "0")}`,
              approvedNetCents: i === 9 ? 500000 : 0,
              allocatedNetCents: i === 9 ? 490000 : 0,
              knownPaychecks: [],
              plans: i === 9 ? w.payCashPlans : [],
              selectedPredictions: [],
              allocatedDeposits: [],
              finalized: [],
            })),
          };
        if (cmd === "preview_pay_calibration") {
          const o = w.pay.state.observations[args.observationId];
          if (!args.input.ytdConfirmed)
            throw "Complete historical YTD setup first";
          return {
            id: args.id,
            observation: structuredClone(o),
            estimate: w.taxEstimate(args.input, o.payDate),
          };
        }
        if (cmd === "preview_pay_forecast") {
          const input = structuredClone(args.input);
          if (w.delayPreview)
            await new Promise((resolve) => (w.finishPreview = resolve));
          return {
            modelVersion: input.tax ? 2 : 1,
            input,
            basis: {
              period: w.pay.state.periods[input.periodId],
              grossCents: 800000,
              worked: 800000,
              paidHours: 800000,
              sick: 0,
              uniformRate: 1000000,
              warnings: [],
              blockers: [],
              days: [],
            },
            empirical: null,
            netCents:
              input.method === "manual"
                ? Math.round(Number(input.manualNet) * 100)
                : input.tax
                  ? w.taxEstimate(input.tax, "2026-11-27").netCents
                  : null,
            tax: input.tax
              ? {
                  estimate: w.taxEstimate(input.tax, "2026-11-27"),
                  correction: null,
                }
              : null,
            warnings: [
              "Synthetic prediction boundary; calculations are tested in Rust.",
            ],
          };
        }
        if (cmd === "pay_scenarios")
          return [
            {
              hours: 800000,
              grossCents: 800000,
              estimate: {
                netCents: 550000,
                observations: [],
                distinctGrossPoints: 2,
                minGrossCents: 700000,
                maxGrossCents: 900000,
                withinPointSpreadCents: null,
                extrapolated: false,
                warnings: ["Synthetic comparison"],
              },
              extraHourNetCents: 5000,
            },
          ];
        if (cmd === "pay_source")
          return structuredClone(w.payDocuments[args.id]);
        if (
          ["ingest_import", "ingest_import_path", "paste_import"].includes(cmd)
        ) {
          if (w.holdIntake)
            await new Promise((resolve) => (w.finishIntake = resolve));
          return "synthetic-intake";
        }
        if (cmd === "export_pay_source") return "synthetic/calendar.docx";
        if (cmd === "bill_month" || cmd === "list_goals") return [];
        if (cmd === "payroll_view") {
          if (w.failRead) throw "Synthetic payroll read failure";
          const result = structuredClone(w.pay);
          result.sickYear.year = args.year;
          const d = new Date(`${args.day}T12:00:00Z`);
          d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
          result.week.start = d.toISOString().slice(0, 10);
          d.setUTCDate(d.getUTCDate() + 6);
          result.week.end = d.toISOString().slice(0, 10);
          if (w.delayDay === args.day)
            await new Promise((resolve) => (w.finishRead = resolve));
          return result;
        }
        if (cmd === "save_payroll") {
          if (w.failWrite) throw "Synthetic payroll write failure";
          if (w.receipts[args.operation]) return w.receipts[args.operation];
          if (args.revision !== w.pay.revision)
            throw "Pay & hours changed. Reload before saving these edits.";
          const c = args.change;
          if (c.kind === "payCash") {
            const i = c.input;
            const plan = {
              periodId: i.periodId,
              forecastId: i.forecastId,
              name: "Synthetic cash period",
              payDate: "2026-10-16",
              targets: i.targets.map((t: any) => ({
                accountId: t.accountId,
                cents: Math.round(Number(t.amount) * 100),
              })),
              complete: i.complete,
              cancelled: i.cancelled,
              note: i.note,
            };
            w.payCashPlans = [
              {
                plan,
                expectedCents: 500000,
                depositedCents: 0,
                varianceCents: -500000,
                remainingCents: 500000,
                changed: false,
                deposits: [],
              },
            ];
          }
          if (c.kind === "payTakeover")
            w.payTakeovers[c.input.scheduleId] = structuredClone(c.input);
          if (c.kind === "removePayTakeover")
            delete w.payTakeovers[c.scheduleId];
          if (c.kind === "finalizePay") w.payFinalized[c.periodId] = true;
          if (c.kind === "taxProfile")
            w.pay.state.taxProfiles[c.profile.id] = structuredClone(c.profile);
          if (c.kind === "removeTaxProfile")
            delete w.pay.state.taxProfiles[c.id];
          if (c.kind === "calibration") {
            w.pay.state.calibrations[c.observationId] =
              await w.__TAURI_INTERNALS__.invoke("preview_pay_calibration", {
                ...c,
                workspace: args.workspace,
              });
            w.pay.calibrationCurrent[c.observationId] = true;
          }
          if (c.kind === "removeCalibration")
            delete w.pay.state.calibrations[c.observationId];
          if (c.kind === "observation") {
            const o = c.input;
            if ("grossCents" in o || "netCents" in o)
              throw "Unknown read-model field in known-pay input";
            w.pay.state.observations[o.id] = {
              ...o,
              worked: Number(o.worked) * 10000,
              rate: Number(o.rate) * 10000,
              grossCents: Math.round(Number(o.gross) * 100),
              netCents: o.net === null ? null : Math.round(Number(o.net) * 100),
              otherGrossCents: Math.round(Number(o.otherGross) * 100),
              reimbursementCents: Math.round(Number(o.reimbursement) * 100),
              deductions: o.deductions.map((d: any) => ({
                name: d.name,
                cents: Math.round(Number(d.amount) * 100),
              })),
            };
          }
          if (c.kind === "removeObservation")
            delete w.pay.state.observations[c.id];
          if (c.kind === "forecast") {
            w.pay.state.forecasts[c.input.id] =
              await w.__TAURI_INTERNALS__.invoke("preview_pay_forecast", {
                workspace: args.workspace,
                input: c.input,
              });
            w.pay.state.selectedForecasts[c.input.periodId] = c.input.id;
            w.pay.forecastStatus.push({
              id: c.input.id,
              stale: false,
              createdAt: "2026-11-04T12:00:00Z",
              actualNetCents: null,
              actualMinusForecastCents: null,
            });
          }
          if (c.kind === "selectForecast") {
            if (c.id) w.pay.state.selectedForecasts[c.periodId] = c.id;
            else delete w.pay.state.selectedForecasts[c.periodId];
          }
          if (c.kind === "calendar") {
            for (const p of c.review.periods)
              w.pay.state.periods[p.id] = structuredClone(p);
            for (const id of c.review.removePeriods)
              delete w.pay.state.periods[id];
            for (const h of c.review.holidays)
              w.pay.state.holidays[h.date] = h.name;
          }
          if (c.kind === "days")
            for (const d of c.days)
              w.pay.state.days[d.date] = {
                planned: Number(d.planned) * 10000,
                worked: d.worked === null ? null : Number(d.worked) * 10000,
                sick: d.sick,
                plannedSick: d.plannedSick,
                unpaid: Number(d.unpaid) * 10000,
                note: d.note,
              };
          if (c.kind === "rate")
            w.pay.state.rates[c.effectiveDate] = Number(c.hourlyRate) * 10000;
          if (c.kind === "holiday") {
            w.pay.state.holidays[c.date] = c.name;
            w.pay.sickYear.holidaysComplete = false;
          }
          if (c.kind === "year")
            Object.assign(w.pay.sickYear, {
              openingUsed: c.openingSickUsed,
              holidaysComplete: c.holidaysComplete,
              remaining: 40 - c.openingSickUsed,
            });
          w.pay.revision++;
          w.receipts[args.operation] = w.pay.revision;
          if (w.loseResponse) {
            w.loseResponse = false;
            throw "Synthetic lost response";
          }
          if (w.failAfterWrite) w.failRead = true;
          return w.pay.revision;
        }
      },
    };
    w.taxEstimate = (input: any, payDate: string) => ({
      rules: "Synthetic boundary",
      profile: structuredClone(w.pay.state.taxProfiles[input.profileId]),
      inputs: structuredClone(input),
      context: {
        payDate,
        frequency: "biweekly",
        benefits: true,
        hourlyGrossCents: 400000,
      },
      cashGrossCents: 400000,
      noncashCents: 0,
      wages: {
        federal: 400000,
        kentucky: 400000,
        socialSecurity: 400000,
        medicare: 400000,
        local: 400000,
      },
      deductions: [],
      taxes: [{ name: "Federal withholding", cents: 54038 }],
      netCents:
        input.ytdConfirmed &&
        input.socialSecurityYtd !== null &&
        input.medicareYtd !== null
          ? 301814
          : null,
      ssPhase: "full",
      medicarePhase: "none",
      warnings: ["Synthetic tax response; Rust verifies calculations."],
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Pay & hours", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit this week" }),
  ).toBeVisible();
}

async function knownForm(page: Page) {
  await page.getByRole("tab", { name: "Pay variations" }).click();
  await page.getByRole("button", { name: "Add known paycheck" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Paid date", { exact: true }).fill("2026-10-16");
  await d.getByLabel("Worked hours", { exact: true }).fill("80");
  await d.getByLabel("Reported gross ($)", { exact: true }).fill("7440");
  await d.getByLabel("Withholding frequency").selectOption("biweekly");
  return d;
}
test("known pay preserves missing net, retries once, and edits without leaking read-model fields", async ({
  page,
}) => {
  await setup(page);
  const d = await knownForm(page);
  await page.evaluate(() => {
    (window as any).loseResponse = true;
  });
  await d.getByRole("button", { name: "Save known paycheck" }).click();
  await expect(d.getByRole("alert")).toContainText("lost response");
  await d.getByRole("button", { name: "Save known paycheck" }).click();
  await expect(d).toHaveCount(0);
  let calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_payroll"),
  );
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[0].args.change.input.net).toBeNull();
  expect(
    await page.evaluate(
      () => Object.keys((window as any).pay.state.observations).length,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await d.getByLabel("Take-home pay ($), blank if unknown").fill("5100");
  await d.getByRole("button", { name: "Save known paycheck" }).click();
  await expect(d).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "$5,100.00", exact: true }),
  ).toBeVisible();
  calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_payroll"),
  );
  expect(calls.at(-1).args.change.input).not.toHaveProperty("grossCents");
});
test("pay source proposals stay unreviewed and keep their exact evidence", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as any;
    const source = {
      id: "known-source",
      name: "Synthetic known.csv",
      format: "csv",
      mime: "text/csv",
      createdAt: "2026-11-04T12:00:00Z",
      applications: 0,
    };
    w.paySources = [source];
    w.payDocuments[source.id] = {
      source,
      document: {
        chunks: [
          { location: "Table row 2", text: "2026-10-16 | 90 | 9000 | 6000" },
        ],
        suggestions: [],
        warnings: [],
        payObservations: [
          {
            location: "Table row 2",
            quote: "2026-10-16 | 90 | 9000 | 6000",
            input: {
              id: "proposal",
              periodId: null,
              payDate: "2026-10-16",
              worked: "90",
              sick: 0,
              rate: "100",
              gross: "9000",
              net: "6000",
              otherGross: "0",
              reimbursement: "0",
              deductions: [],
              detailComplete: false,
              frequency: "biweekly",
              benefits: true,
              regime: "Standard",
              reviewed: false,
              evidence: [],
              note: "",
            },
          },
        ],
      },
    };
  });
  const d = await knownForm(page);
  await d
    .getByText("Attach or import from payroll evidence", { exact: true })
    .click();
  await d
    .getByLabel("Payroll source", { exact: true })
    .selectOption("known-source");
  await d.getByLabel("Use structured pay row").selectOption("0");
  await expect(d.getByLabel("Worked hours", { exact: true })).toHaveValue("90");
  await expect(
    d.getByRole("checkbox", { name: "I reviewed these paycheck facts" }),
  ).not.toBeChecked();
  await d
    .getByRole("checkbox", { name: "I reviewed these paycheck facts" })
    .check();
  await d.getByRole("button", { name: "Save known paycheck" }).click();
  await expect(d).toHaveCount(0);
  const c = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_payroll").at(-1),
  );
  expect(c.args.change.input.evidence).toEqual([
    {
      sourceId: "known-source",
      location: "Table row 2",
      quote: "2026-10-16 | 90 | 9000 | 6000",
    },
  ]);
  expect(c.args.change.input.id).not.toBe("proposal");
  expect(c.args.change.input.reviewed).toBe(true);
});
async function predictionForm(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    w.pay.state.periods.period = {
      id: "period",
      name: "Synthetic period",
      payDate: "2026-11-27",
      weeks: ["2026-11-09", "2026-11-16"],
      frequency: "biweekly",
      benefits: true,
      note: "",
      evidence: [],
    };
  });
  await page.getByLabel("Week containing").fill("2026-11-09");
  await page.getByRole("tab", { name: "Paychecks", exact: true }).click();
  await page.getByRole("button", { name: "Predict pay" }).click();
  return page.getByRole("dialog");
}
async function cashFixture(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    const period = {
      id: "cash-period",
      name: "Synthetic cash period",
      payDate: "2026-10-16",
      weeks: ["2026-10-05", "2026-10-12"],
      frequency: "biweekly",
      benefits: true,
      note: "",
      evidence: [],
    };
    w.pay.state.periods[period.id] = period;
    w.pay.state.selectedForecasts[period.id] = "cash-forecast";
    w.pay.state.forecasts["cash-forecast"] = {
      modelVersion: 1,
      input: {
        id: "cash-forecast",
        periodId: period.id,
        method: "manual",
        regime: "Standard",
        manualNet: "5000",
        reason: "Synthetic estimate",
        useUsual: true,
        extrapolate: false,
      },
      basis: {
        period,
        grossCents: 800000,
        worked: 800000,
        paidHours: 800000,
        sick: 0,
        uniformRate: 1000000,
        warnings: [],
        blockers: [],
        days: [],
      },
      empirical: null,
      netCents: 500000,
      warnings: [],
    };
    w.paySchedules = [
      {
        id: "generic-pay",
        revision: 1,
        anchor: "2026-10-16",
        cadence: "biweekly",
        archived: false,
        plan: {
          name: "Generic paycheck",
          amount: "5000",
          accountId: "checking",
        },
      },
    ];
    w.payBankDeposits = [
      {
        eventId: "bank-pay",
        revision: 3,
        date: "2026-10-16",
        description: "Synthetic employer",
        accountId: "checking",
        amountCents: 490000,
        availableCents: 490000,
        allocatedCents: 0,
        suggested: true,
      },
    ];
  });
  await page.getByLabel("Week containing").fill("2026-10-05");
  await page.getByRole("tab", { name: "Pay & deposits", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve expected pay", exact: true }),
  ).toBeVisible();
}
test("payroll cash approval reviews duplicate schedules and split destinations, resetting confirmation after edits", async ({
  page,
}) => {
  await setup(page);
  await cashFixture(page);
  await page
    .getByRole("button", { name: "Approve expected pay", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await expect(d.getByLabel("Expected deposit 1 ($)")).toHaveValue("5000.00");
  await d.getByRole("button", { name: "Add deposit destination" }).click();
  await d.getByLabel("Destination 2", { exact: true }).selectOption("savings");
  await d.getByLabel("Expected deposit 1 ($)").fill("4000");
  await d.getByLabel("Expected deposit 2 ($)").fill("1000");
  await d.getByLabel("I reviewed other income plans").check();
  await d.getByRole("button", { name: "Remove destination" }).last().click();
  await expect(d.getByLabel("I reviewed other income plans")).not.toBeChecked();
  await d.getByLabel("Expected deposit 1 ($)").fill("5000");
  await d.getByLabel("I reviewed other income plans").check();
  await page.evaluate(() => {
    (window as any).loseResponse = true;
  });
  await d
    .getByRole("button", { name: "Approve expected pay", exact: true })
    .click();
  await expect(d.getByRole("alert")).toContainText("lost response");
  await d
    .getByRole("button", { name: "Approve expected pay", exact: true })
    .click();
  await expect(d).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_payroll"),
  );
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[1].args.change.input.targets).toEqual([
    { accountId: "checking", amount: "5000" },
  ]);
  await expect(
    page.getByRole("button", { name: "Match deposits", exact: true }),
  ).toBeVisible();
});
test("payroll deposit matching passes the chosen event revision and decimal partial allocation without posting income", async ({
  page,
}) => {
  await setup(page);
  await cashFixture(page);
  await page
    .getByRole("button", { name: "Approve expected pay", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("I reviewed other income plans").check();
  await d
    .getByRole("button", { name: "Approve expected pay", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Match deposits", exact: true })
    .click();
  await d
    .getByLabel("Recorded income deposit", { exact: true })
    .selectOption("bank-pay");
  await d.getByLabel("Amount allocated to this period ($)").fill("2400.15");
  await d.getByLabel("This is pay for this period").check();
  await page.evaluate(() => {
    (window as any).failWrite = true;
  });
  await d.getByRole("button", { name: "Save deposit allocation" }).click();
  await expect(d.getByRole("alert")).toContainText("write failure");
  await expect(d.getByLabel("Amount allocated to this period ($)")).toHaveValue(
    "2400.15",
  );
  await page.evaluate(() => {
    (window as any).failWrite = false;
  });
  await d.getByRole("button", { name: "Save deposit allocation" }).click();
  await expect(d).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter(
      (c: any) =>
        c.cmd === "save_payroll" && c.args.change.kind === "payDeposit",
    ),
  );
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[0].args.change).toMatchObject({
    eventId: "bank-pay",
    eventRevision: 3,
    amount: "2400.15",
    confirmed: true,
  });
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) =>
        ["save_entry", "save_income"].includes(c.cmd),
      ),
    ),
  ).toBe(false);
});
test("payroll schedule takeover and timesheet review are explicit and annual worked-paid views remain contained", async ({
  page,
}) => {
  await setup(page);
  await cashFixture(page);
  await page.getByRole("button", { name: "Take over schedule" }).click();
  const d = page.getByRole("dialog");
  await d
    .getByLabel("Takeover review notes")
    .fill("Replace this generic payroll estimate");
  await d.getByLabel("I confirmed this generic schedule").check();
  await d.getByRole("button", { name: "Save schedule takeover" }).click();
  await expect(page.getByText(/Managed from 2026-10-16/)).toBeVisible();
  await page.getByRole("button", { name: "Review timesheet" }).click();
  await d
    .getByLabel("Timesheet review notes")
    .fill("Reviewed recorded hours for both weeks");
  await d.getByLabel("I reviewed the actual hours").check();
  await d.getByRole("button", { name: "Finalize timesheet" }).click();
  await expect(
    page.getByRole("cell").filter({ hasText: "Finalized" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 820 });
  for (const theme of ["light", "dracula"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({
      path: `.qa/pay-cash-${theme}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.getByRole("tab", { name: "Annual payroll", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "$14,880.00", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "$4,900.00", exact: true }),
  ).toBeVisible();
  for (const theme of ["light", "dracula"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({
      path: `.qa/pay-annual-${theme}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
});
async function taxProfileForm(page: Page) {
  await page.getByRole("tab", { name: "Pay settings", exact: true }).click();
  await page.getByRole("button", { name: "Add withholding profile" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Profile name").fill("Synthetic withholding");
  await d.getByLabel("W-4 filing status").selectOption("single");
  await d.getByLabel("Ordinary US-resident").check();
  await d.getByText("Kentucky and local withholding", { exact: true }).click();
  await d.getByLabel("I reviewed local withholding").check();
  await d.getByLabel("I reviewed this profile").check();
  return d;
}
test("withholding profiles preserve reviewed choices, rule treatment and unchanged retry identity", async ({
  page,
}) => {
  await setup(page);
  const d = await taxProfileForm(page);
  await d
    .getByText("Benefits and other deductions (0)", { exact: true })
    .click();
  await d.getByRole("button", { name: "Add deduction rule" }).click();
  await d.getByLabel("Deduction name").fill("Retirement");
  await d.getByLabel("Amount method").selectOption("percent");
  await d.getByLabel("Deduction percentage").fill("5");
  await d.getByLabel("Federal", { exact: true }).check();
  await expect(
    d.getByLabel("Social Security", { exact: true }),
  ).not.toBeChecked();
  await expect(d.getByLabel("I reviewed this profile")).not.toBeChecked();
  await d.getByLabel("I reviewed this profile").check();
  await page.setViewportSize({ width: 1100, height: 820 });
  for (const theme of ["light", "dracula"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({ path: `.qa/pay-tax-profile-${theme}.png` });
    expect(
      await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBeTruthy();
  }
  await page.evaluate(() => {
    (window as any).loseResponse = true;
  });
  await d.getByRole("button", { name: "Save withholding profile" }).click();
  await expect(d.getByRole("alert")).toContainText("lost response");
  await d.getByRole("button", { name: "Save withholding profile" }).click();
  await expect(d).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_payroll"),
  );
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(
    calls[0].args.change.profile.deductions[0].reduces.socialSecurity,
  ).toBe(false);
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await expect(d.getByLabel("Profile name")).toHaveValue(
    "Synthetic withholding",
  );
  await d.getByLabel("Step 4(c) extra per paycheck ($)").fill("10");
  await expect(d.getByLabel("I reviewed this profile")).not.toBeChecked();
});
test("tax prediction retains unknown YTD, invalidates previews on edits and clears tax inputs when switching method", async ({
  page,
}) => {
  await setup(page);
  let d = await taxProfileForm(page);
  await d.getByRole("button", { name: "Save withholding profile" }).click();
  await page.getByRole("tab", { name: "Weekly hours", exact: true }).click();
  d = await predictionForm(page);
  await d.getByLabel("Prediction method").selectOption("tax");
  const pid = await page.evaluate(
    () => Object.keys((window as any).pay.state.taxProfiles)[0],
  );
  await d.getByLabel("Withholding profile", { exact: true }).selectOption(pid);
  await d.getByLabel("Reason / assumptions").fill("Synthetic forecast");
  await d.getByRole("button", { name: "Preview prediction" }).click();
  await expect(
    d.getByRole("button", { name: "Save and select prediction" }),
  ).toBeDisabled();
  await d.getByLabel("SS taxable wages before this payment ($)").fill("0");
  await d
    .getByLabel("Medicare taxable wages before this payment ($)")
    .fill("0");
  await d.getByLabel("I confirmed all YTD values").check();
  await d.getByRole("button", { name: "Preview prediction" }).click();
  await expect(
    d.getByRole("region", { name: "Prediction preview" }),
  ).toContainText("$3,018.14");
  await page.setViewportSize({ width: 1100, height: 820 });
  for (const theme of ["light", "dracula"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({ path: `.qa/pay-tax-prediction-${theme}.png` });
    expect(
      await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBeTruthy();
  }
  await d
    .getByLabel("Medicare taxable wages before this payment ($)")
    .fill("1000");
  await expect(d.getByLabel("I confirmed all YTD values")).not.toBeChecked();
  await expect(
    d.getByRole("region", { name: "Prediction preview" }),
  ).toHaveCount(0);
  await d.getByLabel("Prediction method").selectOption("manual");
  await d.getByLabel("Estimated take-home ($)").fill("3000");
  await d.getByRole("button", { name: "Preview prediction" }).click();
  const call = await page.evaluate(() =>
    (window as any).calls
      .filter((c: any) => c.cmd === "preview_pay_forecast")
      .at(-1),
  );
  expect(call.args.input.tax).toBeUndefined();
});
test("known paycheck withholding comparison retains historical context through retry without adding income", async ({
  page,
}) => {
  await setup(page);
  let d = await taxProfileForm(page);
  await d.getByRole("button", { name: "Save withholding profile" }).click();
  d = await knownForm(page);
  await d.getByLabel("Take-home pay ($), blank if unknown").fill("5000");
  await d.getByLabel("I reviewed these paycheck facts").check();
  await d.getByRole("button", { name: "Save known paycheck" }).click();
  await page
    .getByRole("button", { name: "Compare withholding", exact: true })
    .click();
  const pid = await page.evaluate(
    () => Object.keys((window as any).pay.state.taxProfiles)[0],
  );
  await d.getByLabel("Withholding profile", { exact: true }).selectOption(pid);
  await d.getByLabel("SS taxable wages before this payment ($)").fill("170000");
  await d
    .getByLabel("Medicare taxable wages before this payment ($)")
    .fill("180000");
  await d.getByLabel("I confirmed all YTD values").check();
  await d
    .getByRole("button", { name: "Preview withholding comparison" })
    .click();
  await expect(
    d.getByRole("region", { name: "Withholding comparison preview" }),
  ).toContainText("Actual minus modeled net");
  await page.evaluate(() => {
    (window as any).loseResponse = true;
  });
  await d.getByRole("button", { name: "Save withholding comparison" }).click();
  await expect(d.getByRole("alert")).toContainText("lost response");
  await d.getByRole("button", { name: "Save withholding comparison" }).click();
  await expect(d).toHaveCount(0);
  await expect(
    page.getByText("Comparison saved", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) =>
        ["save_entry", "save_income"].includes(c.cmd),
      ),
    ),
  ).toBe(false);
});
test("prediction edits invalidate the preview and retained versions can be selected without extra income", async ({
  page,
}) => {
  await setup(page);
  const d = await predictionForm(page);
  await d.getByLabel("Estimated take-home ($)").fill("5500");
  await d
    .getByLabel("Reason / assumptions")
    .fill("Synthetic planning estimate");
  await d.getByRole("button", { name: "Preview prediction" }).click();
  await expect(
    d.getByRole("region", { name: "Prediction preview" }),
  ).toContainText("$5,500.00");
  await page.setViewportSize({ width: 1100, height: 820 });
  for (const theme of ["light", "dracula"]) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.screenshot({ path: `.qa/pay-forecast-prediction-${theme}.png` });
  }
  await d.getByLabel("Estimated take-home ($)").fill("5600");
  await expect(
    d.getByRole("button", { name: "Save and select prediction" }),
  ).toHaveCount(0);
  await d.getByRole("button", { name: "Preview prediction" }).click();
  await page.evaluate(() => {
    (window as any).loseResponse = true;
  });
  await d.getByRole("button", { name: "Save and select prediction" }).click();
  await expect(d.getByRole("alert")).toContainText("lost response");
  await d.getByRole("button", { name: "Save and select prediction" }).click();
  await expect(d).toHaveCount(0);
  await page.getByRole("button", { name: "Predict pay" }).click();
  await d.getByText("$5,600.00 · manual · Selected", { exact: true }).click();
  await expect(d).toContainText("Synthetic planning estimate");
  await d.getByRole("button", { name: "Clear selection" }).click();
  await expect(d).toHaveCount(0);
  expect(
    await page.evaluate(
      () => Object.keys((window as any).pay.state.forecasts).length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) =>
        ["save_entry", "save_income"].includes(c.cmd),
      ),
    ),
  ).toBe(false);
});
test("hour scenarios distinguish average net from extra-hour net and clear on input edits", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("tab", { name: "Pay variations" }).click();
  await page
    .getByRole("button", { name: "Compare hours", exact: true })
    .click();
  await page.getByLabel("Withholding frequency").selectOption("biweekly");
  await page.getByRole("button", { name: "Compare scenarios" }).click();
  await expect(
    page.getByRole("cell", { name: "$68.75", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "$50.00", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Hourly rate ($)", { exact: true }).fill("95");
  await expect(
    page.getByRole("cell", { name: "$68.75", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) => c.cmd === "save_payroll"),
    ),
  ).toBe(false);
});
test("known-pay save succeeds even if refresh fails, with compact theme evidence", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1100, height: 820 });
  const d = await knownForm(page);
  for (const theme of ["light", "dracula"]) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await page.screenshot({ path: `.qa/pay-forecast-known-${theme}.png` });
  }
  await page.evaluate(() => {
    (window as any).failAfterWrite = true;
  });
  await d.getByRole("button", { name: "Save known paycheck" }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "Known pay saved locally",
  );
  await expect(page.getByRole("alert")).toContainText("read failure");
  await page.evaluate(() => {
    (window as any).failRead = false;
  });
  await page.getByRole("button", { name: "Reload Pay & hours" }).click();
  await expect(
    page.getByRole("button", { name: "Add known paycheck" }),
  ).toBeVisible();
});
test("weekly plans stay separate from actuals and retry a lost response exactly once", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("Week containing").fill("2026-11-04");
  await page.getByRole("button", { name: "Edit this week" }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Copy usual week into plan" }).click();
  await expect(d.getByLabel("Monday planned", { exact: true })).toHaveValue(
    "8",
  );
  await expect(d.getByLabel("Monday worked", { exact: true })).toHaveValue("");
  await d.getByLabel("Monday worked", { exact: true }).fill("7");
  await d.getByLabel("Monday sick", { exact: true }).fill("1");
  await page.evaluate(() => ((window as any).loseResponse = true));
  await d.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Synthetic lost response");
  await expect(d.getByLabel("Monday worked", { exact: true })).toHaveValue("7");
  page.once("dialog", (x) => x.dismiss());
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(d).toBeVisible();
  await d.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(d).toHaveCount(0);
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_payroll"),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[1].args.change.days[0]).toMatchObject({
    date: "2026-11-02",
    worked: "7",
    planned: "8",
    sick: 1,
  });
  expect(await page.evaluate(() => (window as any).pay.revision)).toBe(1);
});
test("weekly pasted rows remain a draft and require matching dates and whole sick hours", async ({
  page,
}) => {
  await setup(page);
  await page.getByLabel("Week containing").fill("2026-11-04");
  await page.getByRole("button", { name: "Edit this week" }).click();
  const d = page.getByRole("dialog");
  await d
    .getByText("Paste weekly rows from a spreadsheet", { exact: true })
    .click();
  await d
    .getByLabel("Weekly rows", { exact: true })
    .fill("2026-11-02\t8\t7\t0.5\t0\t0\tSynthetic");
  await d.getByRole("button", { name: "Use pasted rows in draft" }).click();
  await expect(d.getByRole("alert")).toContainText("whole numbers");
  await d
    .getByLabel("Weekly rows", { exact: true })
    .fill("2026-11-02\t8\t7\t1\t0\t0\tSynthetic");
  await d.getByRole("button", { name: "Use pasted rows in draft" }).click();
  await expect(d.getByLabel("Monday note")).toHaveValue("Synthetic");
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "save_payroll")
          .length,
    ),
  ).toBe(0);
  await d.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(d).toHaveCount(0);
});
test("rate and official holiday setup is explicit and read failures cannot imply unsaved writes", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("tab", { name: "Pay settings" }).click();
  await page.getByRole("button", { name: "Add rate", exact: true }).click();
  let d = page.getByRole("dialog");
  await expect(d.getByLabel("Hourly rate ($)", { exact: true })).toHaveValue(
    "93",
  );
  await d.getByLabel("Effective date", { exact: true }).fill("2026-01-01");
  await page.evaluate(() => ((window as any).failAfterWrite = true));
  await d.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic payroll read failure",
  );
  await expect(page.getByRole("status")).toContainText("saved locally");
  await page.evaluate(() => {
    (window as any).failRead = false;
    (window as any).failAfterWrite = false;
  });
  await page.getByRole("button", { name: "Reload Pay & hours" }).click();
  await expect(page.getByText("$93 / hour", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Holidays & allowance" }).click();
  await page.getByRole("button", { name: "Add holiday", exact: true }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Holiday date", { exact: true }).fill("2026-11-26");
  await d
    .getByLabel("Holiday name", { exact: true })
    .fill("Synthetic PSW holiday");
  await d.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("Synthetic PSW holiday", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review year setup" }).click();
  d = page.getByRole("dialog");
  await expect(d.getByRole("checkbox")).not.toBeChecked();
  await d.getByLabel("Sick hours used outside these records").fill("8");
  await d.getByRole("checkbox").check();
  await d.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("32 h available", { exact: true })).toBeVisible();
});
test("stale reads cannot replace the selected week and no stale editor is offered", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => ((window as any).delayDay = "2026-11-09"));
  await page.getByLabel("Week containing").fill("2026-11-09");
  await expect(
    page.getByRole("button", { name: "Edit this week" }),
  ).toHaveCount(0);
  await page.getByLabel("Week containing").fill("2026-11-16");
  await expect(
    page.getByRole("heading", { name: "2026-11-16 – 2026-11-22" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).finishRead());
  await expect(
    page.getByRole("heading", { name: "2026-11-16 – 2026-11-22" }),
  ).toBeVisible();
});
test("compact light and dark payroll pages and editors retain help and contain table scrolling", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1100, height: 820 });
  for (const theme of ["light", "dracula"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page
      .getByRole("button", { name: "Help: Pay & hours", exact: true })
      .click();
    await expect(page.getByRole("tooltip")).toContainText("Weekly hours");
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: `.qa/pay-hours-${theme}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await page.getByRole("button", { name: "Edit this week" }).click();
    const d = page.getByRole("dialog");
    await d
      .getByRole("button", {
        name: "Help: Planned and recorded hours",
        exact: true,
      })
      .click();
    await expect(page.getByRole("tooltip")).toContainText("regular rate");
    await page.keyboard.press("Escape");
    await expect(d).toBeVisible();
    await page.screenshot({ path: `.qa/pay-hours-editor-${theme}.png` });
    expect(
      await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBeTruthy();
    await d.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

test("calendar source tables stay proposals until reviewed, retain conflict drafts and apply one transition period", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as any;
    const source = {
      id: "synthetic-source",
      name: "Synthetic transition.csv",
      format: "csv",
      mime: "text/csv",
      createdAt: "2026-11-04T12:00:00Z",
      applications: 0,
    };
    w.paySources = [source];
    const chunks = ["2026-05-25", "2026-06-01", "2026-06-08"].map(
      (date, i) => ({
        location: `Table row ${i + 2}`,
        text: `${date} | 2026-06-19`,
      }),
    );
    w.payDocuments[source.id] = {
      source,
      document: {
        chunks,
        warnings: ["Synthetic dates require review."],
        suggestions: chunks.map((c, i) => ({
          kind: "week",
          date: ["2026-05-25", "2026-06-01", "2026-06-08"][i],
          payDate: "2026-06-19",
          name: "Transition paycheck",
          frequency: "biweekly",
          benefits: true,
          location: c.location,
          quote: c.text,
        })),
      },
    };
  });
  await page.getByRole("tab", { name: "Paychecks", exact: true }).click();
  await page
    .getByText("1 saved source · open for review", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review source", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByRole("button", { name: "Use table proposals (3)", exact: true })
    .click();
  const p = d.getByRole("region", { name: "Period 1", exact: true });
  await expect(
    p.getByLabel("Workweeks (Monday dates, separated by commas)"),
  ).toHaveValue("2026-05-25, 2026-06-01, 2026-06-08");
  await expect(p.getByLabel("Withholding frequency")).toHaveValue("biweekly");
  await expect(
    d.getByRole("button", { name: "Apply reviewed calendar" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as any).calls.filter((c: any) => c.cmd === "save_payroll")
          .length,
    ),
  ).toBe(0);
  await d
    .getByLabel("Review / conflict decision")
    .fill("Compared all three workweeks and the June 19 exception.");
  await d.getByRole("checkbox", { name: "I reviewed" }).check();
  await page.evaluate(() => {
    (window as any).failWrite = true;
  });
  await d.getByRole("button", { name: "Apply reviewed calendar" }).click();
  await expect(d.getByRole("alert")).toContainText(
    "Synthetic payroll write failure",
  );
  await expect(p.getByLabel("Pay date", { exact: true })).toHaveValue(
    "2026-06-19",
  );
  await page.evaluate(() => {
    (window as any).failWrite = false;
  });
  await d.getByRole("button", { name: "Apply reviewed calendar" }).click();
  await expect(d).toHaveCount(0);
  await expect(
    page.getByText("Three-week period", { exact: true }),
  ).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "save_payroll"),
  );
  expect(calls[0].args.operation).toBe(calls[1].args.operation);
  expect(calls[1].args.change.review.periods[0].evidence).toHaveLength(3);
  await expect(
    page.getByRole("status").filter({ hasText: "Reviewed calendar saved" }),
  ).toContainText("calendar saved locally");
});

test("manual periods keep explicit payday and deduction exceptions, and calendar views remain contained", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("tab", { name: "Paychecks", exact: true }).click();
  await page.getByRole("button", { name: "Add period", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Period name").fill("Year-end paycheck");
  await d.getByLabel("Pay date", { exact: true }).fill("2026-12-31");
  await d
    .getByLabel("Workweeks (Monday dates, separated by commas)")
    .fill("2026-12-21, 2026-12-28");
  await d.getByLabel("Withholding frequency").selectOption("biweekly");
  await d.getByLabel("Benefits normally deducted").uncheck();
  await d
    .getByLabel("Review / conflict decision")
    .fill("Confirmed Thursday payday and benefits exception.");
  await page.setViewportSize({ width: 1100, height: 820 });
  for (const theme of ["light", "dracula"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({ path: `.qa/pay-calendar-editor-${theme}.png` });
    expect(
      await d.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBeTruthy();
  }
  await d.getByRole("checkbox", { name: "I reviewed" }).check();
  await d.getByRole("button", { name: "Apply reviewed calendar" }).click();
  await expect(
    page.getByText("Deduction holiday", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Holidays & allowance" }).click();
  await page
    .getByRole("combobox", { name: "Calendar view", exact: true })
    .selectOption("12");
  await expect(
    page.getByText("Payday: Year-end paycheck", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Week for 2026-12-31 pay", { exact: true }),
  ).toHaveCount(2);
  await page.setViewportSize({ width: 1100, height: 820 });
  for (const theme of ["light", "dracula"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({
      path: `.qa/pay-calendar-${theme}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
});

test("payroll browse drop and paste bind the destination at enqueue even while navigating", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("tab", { name: "Paychecks", exact: true }).click();
  await page.evaluate(() => {
    (window as any).holdIntake = true;
  });
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: "Synthetic one.docx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("synthetic"),
    },
    {
      name: "Synthetic two.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("synthetic"),
    },
  ]);
  await expect(
    page.getByText("Reading locally…", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Monthly budget", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).holdIntake = false;
    (window as any).finishIntake();
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).calls.filter((c: any) => c.cmd === "ingest_import")
            .length,
      ),
    )
    .toBe(2);
  let calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) => c.cmd === "ingest_import"),
  );
  expect(calls.every((c: any) => c.args.purpose === "payroll")).toBeTruthy();
  await page.getByRole("button", { name: "Pay & hours", exact: true }).click();
  await page.getByRole("tab", { name: "Paychecks", exact: true }).click();
  await page.getByRole("button", { name: "Paste calendar screenshot" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).calls.filter((c: any) => c.cmd === "paste_import")
            .length,
      ),
    )
    .toBe(1);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["synthetic"], "Dropped calendar.docx"));
    window.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: dt }),
    );
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).calls.filter((c: any) => c.cmd === "ingest_import")
            .length,
      ),
    )
    .toBe(3);
  calls = await page.evaluate(() =>
    (window as any).calls.filter((c: any) =>
      ["ingest_import", "paste_import"].includes(c.cmd),
    ),
  );
  expect(calls.every((c: any) => c.args.purpose === "payroll")).toBeTruthy();
  expect(
    await page.evaluate(() =>
      (window as any).calls.some((c: any) => c.cmd === "save_payroll"),
    ),
  ).toBeFalsy();
});

test("overlapping workweeks display both paydays and require replacement instead of duplicate approval", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const w = window as any;
    w.pay.state.periods.old = {
      id: "old",
      name: "Existing paycheck",
      payDate: "2026-08-26",
      weeks: ["2026-08-17"],
      frequency: "biweekly",
      benefits: true,
      note: "",
      evidence: [],
    };
  });
  // Reload the pay view through a date change before opening the editor.
  await page.getByLabel("Week containing").fill("2026-08-17");
  await page.getByRole("tab", { name: "Paychecks", exact: true }).click();
  await page.getByRole("button", { name: "Add period", exact: true }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Pay date", { exact: true }).fill("2026-08-28");
  await d
    .getByLabel("Workweeks (Monday dates, separated by commas)")
    .fill("2026-08-17");
  await d.getByLabel("Withholding frequency").selectOption("biweekly");
  await expect(d.getByRole("alert")).toContainText("2026-08-26 → 2026-08-28");
  await d
    .getByLabel("Review / conflict decision")
    .fill("Confirmed the annotated Friday date.");
  await d.getByRole("checkbox", { name: "I reviewed" }).check();
  await expect(
    d.getByRole("button", { name: "Apply reviewed calendar" }),
  ).toBeDisabled();
  await d.getByLabel("Apply as").selectOption("old");
  await expect(d.getByRole("alert")).toHaveCount(0);
  await d.getByRole("checkbox", { name: "I reviewed" }).check();
  await d.getByRole("button", { name: "Apply reviewed calendar" }).click();
  await expect(d).toHaveCount(0);
  expect(
    await page.evaluate(() => Object.keys((window as any).pay.state.periods)),
  ).toEqual(["old"]);
  expect(
    await page.evaluate(() => (window as any).pay.state.periods.old.payDate),
  ).toBe("2026-08-28");
});
