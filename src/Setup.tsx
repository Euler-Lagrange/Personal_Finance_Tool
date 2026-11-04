import { HelpHeading } from "./HelpTip";
import Balances, { AccountBalance } from "./Balances";
import { useState, type ReactNode } from "react";
import {
  Archive,
  CreditCard,
  Landmark,
  Pencil,
  PiggyBank,
  Plus,
  Search,
  Tags,
} from "lucide-react";
import { command, dollars, money, monthName } from "./api";
import { Modal } from "./EntryDialog";
import { CategoryIcon, categoryIconOptions } from "./CategoryIcon";
import {
  accountKindLabel,
  type Account,
  type Category,
  type Snapshot,
} from "./types";

export function AccountIcon({ kind }: { kind: Account["kind"] }) {
  const Icon =
    kind === "credit" ? CreditCard : kind === "savings" ? PiggyBank : Landmark;
  return <Icon size={19} aria-hidden="true" />;
}

type Saved = (message: string) => Promise<void>;
export default function Setup({
  data,
  saved,
}: {
  data: Snapshot;
  saved: Saved;
}) {
  const [tab, setTab] = useState<"accounts" | "categories">("accounts");
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [balanceAccount, setBalanceAccount] = useState<Account | null>(null);
  const [account, setAccount] = useState<Account | "new" | null>(null);
  const [category, setCategory] = useState<Category | "new" | null>(null);
  const matches = (item: Account | Category) =>
    (archived || !item.archived) &&
    item.name.toLowerCase().includes(search.toLowerCase());
  const accounts = data.accounts.filter(matches);
  const categories = data.categories.filter(matches);
  return (
    <>
      <div className="setup-toolbar">
        <div
          className="segmented setup-tabs"
          role="tablist"
          aria-label="Account and category setup"
        >
          {(["accounts", "categories"] as const).map((value) => (
            <button
              key={value}
              role="tab"
              id={`setup-tab-${value}`}
              aria-selected={tab === value}
              aria-controls="setup-content"
              tabIndex={tab === value ? 0 : -1}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                  return;
                e.preventDefault();
                const next =
                  e.key === "Home"
                    ? "accounts"
                    : e.key === "End"
                      ? "categories"
                      : tab === "accounts"
                        ? "categories"
                        : "accounts";
                setTab(next);
                setSearch("");
                document.getElementById(`setup-tab-${next}`)?.focus();
              }}
              className={tab === value ? "selected" : ""}
              onClick={() => {
                setTab(value);
                setSearch("");
              }}
            >
              {value === "accounts" ? (
                <Landmark size={16} />
              ) : (
                <Tags size={16} />
              )}
              {value === "accounts" ? "Accounts" : "Categories & defaults"}
            </button>
          ))}
        </div>
        <button
          className="primary"
          onClick={() =>
            tab === "accounts" ? setAccount("new") : setCategory("new")
          }
        >
          <Plus size={16} />
          {tab === "accounts" ? "Add account" : "Add category"}
        </button>
      </div>
      <section
        className="panel setup-panel"
        id="setup-content"
        role="tabpanel"
        aria-labelledby={`setup-tab-${tab}`}
      >
        <div className="panel-heading">
          <div>
            <HelpHeading
              topic={
                tab === "accounts" ? "balanceEvidence" : "categoryDefaults"
              }
            >
              {" "}
              <h2>
                {tab === "accounts" ? "Your accounts" : "Spending categories"}
              </h2>
            </HelpHeading>
            <p>
              {tab === "accounts"
                ? "Manage your checking, credit card, and separate savings accounts."
                : "Organize spending and set defaults to copy into monthly budgets."}
            </p>
          </div>
          <span className="small-tag">
            {
              (tab === "accounts" ? data.accounts : data.categories).filter(
                (item) => !item.archived,
              ).length
            }{" "}
            active
          </span>
        </div>
        <div className="setup-filters">
          <label className="setup-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label={
                tab === "accounts" ? "Search accounts" : "Search categories"
              }
              placeholder={
                tab === "accounts" ? "Find an account" : "Find a category"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
        <div className="table-scroll">
          {tab === "accounts" ? (
            <table className="setup-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Type</th>
                  <th className="numeric">Balance estimate</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="setup-name">
                        <span className="setup-symbol">
                          <AccountIcon kind={item.kind} />
                        </span>
                        <strong>{item.name}</strong>
                      </span>
                    </td>
                    <td>
                      {accountKindLabel[item.kind]}
                      <small className="muted">
                        {item.trackingMode === "untracked"
                          ? "Owned · untracked"
                          : item.trackingMode === "manual"
                            ? "Manual balance"
                            : "Imported activity"}
                      </small>
                    </td>
                    <td className="numeric">
                      <AccountBalance account={item} />
                    </td>
                    <td>
                      <Status archived={item.archived} />
                    </td>
                    <td>
                      <div className="setup-account-actions">
                        <button
                          className="text-button"
                          aria-label={`Edit account ${item.name}`}
                          onClick={() => setAccount(item)}
                        >
                          <Pencil size={14} />
                          Edit
                        </button>
                        <button
                          className="text-button"
                          aria-label={`Balances for ${item.name}`}
                          onClick={() => setBalanceAccount(item)}
                        >
                          Balances
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="setup-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Group</th>
                  <th className="numeric">Monthly default</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {categories.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="setup-name">
                        <CategoryIcon category={item} color={item.color} />
                        <strong>{item.name}</strong>
                      </span>
                    </td>
                    <td>{item.groupName}</td>
                    <td className="numeric">{money(item.defaultLimitCents)}</td>
                    <td>
                      <Status archived={item.archived} />
                    </td>
                    <td>
                      <button
                        className="text-button"
                        aria-label={`Edit category ${item.name}`}
                        onClick={() => setCategory(item)}
                      >
                        <Pencil size={14} />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {!(tab === "accounts" ? accounts : categories).length && (
          <p className="setup-empty">
            No {tab} match. Try a different search or show archived items.
          </p>
        )}
        <div className="panel-footnote">
          {tab === "accounts"
            ? "Estimates start from a confirmed end-of-day balance and include later recorded movements. Missing activity may change the estimate. Chelsea-paid expenses do not move your accounts."
            : "Changing a default does not change any monthly budget. Use Copy budget limits in Monthly budget to apply defaults or copy an earlier month."}
        </div>
      </section>
      <p className="soft-note">
        Archived items stay in transaction history and existing budgets. Restore
        them here to use them for new entries.
      </p>
      {balanceAccount && (
        <Balances
          key={balanceAccount.id}
          account={balanceAccount}
          workspace={data.workspace}
          close={() => setBalanceAccount(null)}
          saved={saved}
        />
      )}
      {account && (
        <AccountDialog
          key={account === "new" ? "new-account" : account.id}
          account={account === "new" ? undefined : account}
          data={data}
          saved={saved}
          close={() => setAccount(null)}
        />
      )}
      {category && (
        <CategoryDialog
          key={category === "new" ? "new-category" : category.id}
          category={category === "new" ? undefined : category}
          data={data}
          saved={saved}
          close={() => setCategory(null)}
        />
      )}
    </>
  );
}

function Status({ archived }: { archived: boolean }) {
  return (
    <span className={archived ? "setup-status archived" : "setup-status"}>
      {archived && <Archive size={12} />}
      {archived ? "Archived" : "Active"}
    </span>
  );
}

function Editor({
  title,
  close,
  submit,
  children,
  isNew,
  submitLabel,
}: {
  title: string;
  close: () => void;
  submit: () => Promise<void>;
  children: ReactNode;
  isNew: boolean;
  submitLabel?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={title} onClose={close} busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await submit();
            close();
          } catch (error) {
            setError(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          {children}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button className="primary" type="submit">
              {busy
                ? "Saving…"
                : (submitLabel ?? (isNew ? "Create" : "Save changes"))}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function AccountDialog({
  account,
  data,
  saved,
  close,
}: {
  account?: Account;
  data: Snapshot;
  saved: Saved;
  close: () => void;
}) {
  const [input, setInput] = useState(() => ({
    id: account?.id ?? crypto.randomUUID(),
    revision: account?.revision ?? 0,
    name: account?.name ?? "",
    kind: account?.kind ?? "checking",
    archived: account?.archived ?? false,
    trackingMode: account?.trackingMode ?? "imported",
  }));
  return (
    <Editor
      title={account ? "Edit account" : "Add account"}
      close={close}
      isNew={!account}
      submit={async () => {
        await command("save_account", { workspace: data.workspace, input });
        await saved(
          input.archived
            ? "Account archived. Its history is preserved."
            : "Account saved.",
        );
      }}
    >
      <label>
        Account name
        <input
          autoFocus
          required
          maxLength={100}
          value={input.name}
          placeholder="e.g. Capital One · Gift Fund"
          onChange={(e) => setInput({ ...input, name: e.target.value })}
        />
      </label>
      <label>
        Account type
        <select
          value={input.kind}
          disabled={!!account}
          onChange={(e) =>
            setInput({ ...input, kind: e.target.value as Account["kind"] })
          }
        >
          {Object.entries(accountKindLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tracking mode
        <select
          value={input.trackingMode}
          onChange={(e) =>
            setInput({
              ...input,
              trackingMode: e.target.value as NonNullable<
                Account["trackingMode"]
              >,
            })
          }
        >
          <option value="imported">Imported activity</option>
          <option value="manual">Manual balance</option>
          <option value="untracked">Owned endpoint · no running balance</option>
        </select>
      </label>
      <p className="form-intro">
        These accounts belong to you. Untracked destinations can receive
        transfers without a balance or a second import. Payments to merchants
        are expenses. Switching modes preserves transactions and balance
        history.
      </p>
      <p className="form-intro">
        {account
          ? "Account type stays fixed to preserve how cash and card activity are recorded."
          : "Create one account for each checking, card, or separate savings account. This does not connect to your bank."}
      </p>
      {account && (
        <label>
          Status
          <select
            value={input.archived ? "archived" : "active"}
            onChange={(e) =>
              setInput({ ...input, archived: e.target.value === "archived" })
            }
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      )}
      {input.archived && (
        <p className="soft-note">
          Existing transactions remain available. New entries will use your
          other active accounts.
        </p>
      )}
    </Editor>
  );
}

function CategoryDialog({
  category,
  data,
  saved,
  close,
}: {
  category?: Category;
  data: Snapshot;
  saved: Saved;
  close: () => void;
}) {
  const [input, setInput] = useState(() => ({
    id: category?.id ?? crypto.randomUUID(),
    revision: category?.revision ?? 0,
    name: category?.name ?? "",
    groupName: category?.groupName ?? "Needs",
    color: category?.color ?? "#7488c1",
    icon: category?.icon ?? "auto",
    defaultLimit: dollars(category?.defaultLimitCents ?? 0),
    archived: category?.archived ?? false,
  }));
  const fallback = category?.id === "uncategorized";
  return (
    <Editor
      title={category ? "Edit category" : "Add category"}
      close={close}
      isNew={!category}
      submit={async () => {
        await command("save_category", { workspace: data.workspace, input });
        await saved(
          input.archived
            ? "Category archived. Its history and monthly limits are preserved."
            : "Category saved. Existing monthly limits are unchanged.",
        );
      }}
    >
      <label>
        Category name
        <input
          autoFocus
          required
          disabled={fallback}
          maxLength={100}
          value={input.name}
          placeholder="e.g. Electric bill"
          onChange={(e) => setInput({ ...input, name: e.target.value })}
        />
      </label>
      <div className="form-grid">
        <label>
          Category group
          <select
            value={input.groupName}
            disabled={fallback}
            onChange={(e) => setInput({ ...input, groupName: e.target.value })}
          >
            {["Needs", "Wants", "Other"].map((group) => (
              <option key={group}>{group}</option>
            ))}
          </select>
        </label>
        <label>
          Default monthly limit ($)
          <input
            required
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]{1,2})?"
            value={input.defaultLimit}
            onChange={(e) =>
              setInput({ ...input, defaultLimit: e.target.value })
            }
          />
        </label>
      </div>
      <div className="form-grid">
        <label>
          Category icon
          <select
            value={input.icon}
            onChange={(e) => setInput({ ...input, icon: e.target.value })}
          >
            {categoryIconOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category color
          <span className="color-field">
            <input
              type="color"
              aria-label="Category color"
              value={input.color}
              onChange={(e) => setInput({ ...input, color: e.target.value })}
            />
            <CategoryIcon category={input} color={input.color} size={23} />
          </span>
        </label>
      </div>
      <p className="form-intro">
        The default is used when you copy defaults into a month. It does not
        change any existing monthly limit.
      </p>
      {category && (
        <label>
          Status
          <select
            disabled={fallback}
            value={input.archived ? "archived" : "active"}
            onChange={(e) =>
              setInput({ ...input, archived: e.target.value === "archived" })
            }
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      )}
      {fallback && (
        <p className="soft-note">
          Uncategorized stays available for expenses that have not been assigned
          a category.
        </p>
      )}
      {input.archived && (
        <p className="soft-note">
          Existing spending and monthly limits stay in reports. This category
          will not be copied into new budgets.
        </p>
      )}
    </Editor>
  );
}

export function BudgetTemplateDialog({
  data,
  saved,
  close,
}: {
  data: Snapshot;
  saved: Saved;
  close: () => void;
}) {
  const [source, setSource] = useState("defaults");
  const previous = new Date(`${data.month}-02T12:00:00`);
  previous.setMonth(previous.getMonth() - 1);
  const [sourceMonth, setSourceMonth] = useState(
    `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`,
  );
  const [replace, setReplace] = useState(false);
  return (
    <Editor
      title="Copy budget limits"
      submitLabel="Copy limits"
      close={close}
      isNew={false}
      submit={async () => {
        const changed = await command<number>("apply_budget_template", {
          workspace: data.workspace,
          month: data.month,
          sourceMonth: source === "defaults" ? null : sourceMonth,
          replace,
        });
        await saved(
          changed
            ? `Updated ${changed} category limits for ${monthName(data.month)}.`
            : "Existing limits kept. Select Replace existing limits to overwrite them.",
        );
      }}
    >
      <p className="form-intro">
        Copy limits into <strong>{monthName(data.month)}</strong>. Spending and
        unused budget amounts are not carried over.
      </p>
      {source === "defaults" && (
        <p className="soft-note">
          {data.categories.filter((c) => !c.archived).length} active categories
          ·{" "}
          {money(
            data.categories
              .filter((c) => !c.archived)
              .reduce((total, c) => total + c.defaultLimitCents, 0),
          )}{" "}
          in monthly defaults. Review or adjust these in Accounts &amp;
          categories. If older broad categories overlap with new detailed ones,
          review both their defaults and this month’s limits before copying.
          Archiving keeps saved monthly limits intact.
        </p>
      )}
      <label>
        Copy from
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="defaults">Category defaults</option>
          <option value="month">An earlier month</option>
        </select>
      </label>
      {source === "month" && (
        <label>
          Source month
          <input
            type="month"
            required
            max={`${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`}
            value={sourceMonth}
            onChange={(e) => setSourceMonth(e.target.value)}
          />
        </label>
      )}
      <label className="check-label">
        <input
          type="checkbox"
          checked={replace}
          onChange={(e) => setReplace(e.target.checked)}
        />
        Replace existing limits for this month
      </label>
      <p className="soft-note">
        {replace
          ? "Existing limits for active categories in this month will be replaced. Archived categories and other months stay unchanged."
          : "Fill only missing limits. Existing limits, including $0, are kept. Archived categories are excluded."}
      </p>
    </Editor>
  );
}
