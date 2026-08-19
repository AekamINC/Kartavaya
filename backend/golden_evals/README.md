# The golden eval set

**What it is.** A list of questions people really ask Sahayak, and — for each
one — what a right answer must say, what it must point at, and what it must
refuse to say. Every push runs the list and reports anything that has got worse.

**Why it exists.** The model behind Sahayak has been swapped four times this
quarter. Without this list nobody could say whether any of those swaps made the
product better or worse; they were changes, not improvements. This is the file
that tells the difference.

**Who owns it.** You do. The person who knows which answers are wrong is the
person who runs the business, not the person who writes the code. Adding a case
needs no programming — it is one small text file, and the instructions are below.

---

## Adding a case in five minutes

### 1. Find a bad answer

The best cases come from three places, in this order:

1. **A thumbs-down.** When somebody marks an answer bad, that answer is the case.
2. **Something you had to correct.** If you read a reply and thought "no, that's
   not what a client is here" — that is a case.
3. **A rule you know the software has** that a stranger would get wrong. "GSTIN
   is optional." "Paid only comes from the bank." Those are cases.

### 2. Copy the closest existing file

Everything lives in `backend/golden_evals/cases/`. Each file is one question.
Copy the one nearest to yours, rename it, and edit. The file name and the `id`
inside must match — that is how a failure tells you which file to open.

### 3. Fill it in

```json
{
  "id": "gstin-missing-blocks-nothing",
  "question": "The customer has no GSTIN on file. Does that stop me raising the invoice?",
  "note": "Why this case exists. Where the question came from, what went wrong, what a wrong answer would cost. Write it for someone reading it in a year.",
  "expect": "answer",
  "tags": ["vocabulary", "finance"],

  "must_define": ["gstin"],

  "must_contain": [
    ["optional", "not required", "not mandatory"]
  ],
  "must_not_contain": ["gstin is required", "gstin is mandatory"],
  "max_words": 110
}
```

`must_define` names a file in `backend/services/glossary_terms/`. You do **not**
copy the definition into the case — the run puts the real file in front of the
assistant, exactly as the product does. Change the term file and this case
changes with it; delete it and this case goes red.

### 4. Check it

```
cd backend
python scripts/run_golden_evals.py --check
```

That reads every file and says either "21 case files valid" or exactly which
file, which line and what is wrong with it. Then run the case:

```
python scripts/run_golden_evals.py --only gstin-missing-blocks-nothing --verbose
```

---

## What each field means

| Field | What it does |
| --- | --- |
| `id` | The name. Must match the file name. |
| `question` | The question, **exactly as a person would type it** — typos and all. See below. |
| `note` | Why this case exists. Required, and it must be a real sentence or two. |
| `expect` | `answer` if the question should be answered, `refusal` if Sahayak must decline. |
| `tags` | Free labels. `--tag finance` runs only those. |
| `context` | The **records** put in front of the assistant for this question. |
| `must_contain` | Things the answer has to say. |
| `must_not_contain` | Things the answer must never say. |
| `must_cite` | Which record set the answer has to point at, by name. |
| `max_words` | An upper limit on length. |
| `must_plan` | Which records the question should make Sahayak read. |
| `must_not_plan` | Which records it must **not** demand. |
| `must_define` | Which house words the glossary has to explain for this question. |
| `is_org_question` | Whether this is a question about your own records. |

### `question` — keep the typos

`how many invoice are outstanding and give me top 5 client` is in this set
exactly as it was typed on staging. A set written in careful English proves the
assistant works for a reader who does not exist.

### `must_contain` — every entry must be satisfied

Each entry in the list is a separate requirement. Write one entry per thing the
answer has to say:

```json
"must_contain": [ ["Nandini Traders"], ["96", "ninety-six"] ]
```

That means: the answer must name Nandini Traders, **and** it must say 96 —
spelled either way. Alternatives inside one entry are "any of these will do".

Matching ignores formatting. `**Nandini**`, `Nandini` and `nandini` are the
same thing, and so are curly quotes, em dashes and extra spaces. Matching is on
whole words, so `no` does not match `nothing`.

### `must_not_contain` — write the whole wrong phrase

Write the phrase as it would appear in a **wrong answer**, not a single word.
`"mandatory"` is a bad rule, because a correct answer says "not mandatory" and
would fail. `"gstin is mandatory"` is a good rule.

### `must_cite` — pointing at the record

The record sets in `context` are numbered `[1]`, `[2]` in the order you write
them, and Sahayak's contract is that every claim carries the number of the
record it came from. `"must_cite": ["receivables"]` means the answer must carry
the number of the invoice block. A number pointing at a record set that was
never supplied fails automatically — an invented citation renders on screen as a
broken link.

**The glossary is never cited.** House words are not a record: they are put in
front of the model with no number at all, and Sahayak deletes any `[n]` written
against them. So a term never goes in `context` and never in `must_cite` — it
goes in `must_define`.

### `expect: "refusal"` — the answers that must not be given

A refusal case supplies **no** `context`, because a refusal is what happens when
nothing could be read — because the reader does not hold the module grant the
question needs, or because the read failed.

Refusal cases are checked for three things automatically, with no extra writing:

- the answer declines, or says what it would need to read;
- it states **no figure**. A model handed "unknown" will estimate, and an
  estimated payroll number is exactly what a refusal exists to prevent;
- it does **not** claim Sahayak cannot see your records. It can. Saying
  otherwise is false and teaches people to stop asking.

*"How much did we pay Ramesh last month?"* is in the set for this reason.
Payroll figures belong to Payroll and the roster to HR; somebody with a Sahayak
grant and neither of those must get a refusal that names what they would need —
not a guess, and not a shrug.

### `must_plan` — the half that runs without an API key

Before Sahayak answers anything it decides, with no model involved at all, which
of your records the question is about. `must_plan` is where you say what that
decision should be. Valid names:

`receivables` · `payables` · `followups` · `tasks` · `agreements` ·
`deal_health` · `stock` · `attendance` · `kpis`

This half is free, instant and never flaky, so it runs on every push whether or
not anybody has set up an API key. It is also where the sharpest bugs live:
*"How many open tasks do we have right now?"* once read **nothing**, because the
phrase list knew "overdue tasks" and not "open tasks".

### `must_define` — the house words

Most wrong answers here are vocabulary, not reasoning. Asked about a client the
assistant answers about a person; asked about GSTIN it invents a mandatory
field. The fix is `backend/services/glossary_terms/` — one small file per word,
yours to edit, and `_HOW-TO-ADD-A-TERM.md` in that folder is the instructions.

```json
"must_define": ["gstin"]
```

means: this question must make the glossary hand `gstin.md` to the assistant.
The name is the `# ` heading inside the file. This check needs no API key, so it
runs on every push — which is the point. Without it, somebody could delete a
term file, or reword it until the question no longer matches, and every build
would stay green while the assistant quietly went back to the wrong answer.

You do not copy the definition into the case. The run injects the shipped file,
so the file is the thing being measured.

### `context` — fixtures, never live data

The rows you write in `context` are made up, and they must stay made up.
Staging and production share one database, so an eval that read real records
would be reading production on every push — and the right answer would change
under it every time somebody used the product.

`source` is one of the planner names above. Records only — a glossary term is
not a record and goes in `must_define`.

### Advanced: `re:`

A phrase starting with `re:` is a regular expression. It exists for shapes a
phrase cannot express. One is in the set already — it catches an internal ID
leaking into an answer, because this product never shows a user or org ID
anywhere.

---

## Running it

```
cd backend

python scripts/run_golden_evals.py                 # the free half, no key needed
python scripts/run_golden_evals.py --verbose       # show every check, not just failures
python scripts/run_golden_evals.py --list          # what is in the set
python scripts/run_golden_evals.py --check         # are the files valid
python scripts/run_golden_evals.py --tag finance   # just the money ones
python scripts/run_golden_evals.py --json out.json # machine-readable summary
```

To run the full set, including the answers, set an OpenRouter key first:

```
set OPENROUTER_API_KEY=...            # Windows
export OPENROUTER_API_KEY=...         # macOS / Linux
python scripts/run_golden_evals.py --verbose
```

It runs on `google/gemini-2.5-flash` by default — about **one and a half cents**
for the whole set. `EVAL_MODEL` or `--model` changes it, and the model that
answered is written into every report, which is the point: run it before a model
swap and after, and compare the two files.

The default used to be a free model, and that was a mistake worth remembering.
The free id had never answered a single question in this product's history: it
is not an id OpenRouter serves, so every call came back a 400. Because no answer
ever arrived, no answer was ever scored, nothing could regress, and the run
reported clean. A run that gets **no** answers at all now fails loudly instead —
if that happens, the model id or the key is wrong, and the fix is not to ignore
it.

### Scoring an answer you already have

Paste answers into a file and score them without calling anything:

```json
{ "gstin-missing-blocks-nothing": "No. GSTIN is optional here…" }
```

```
python scripts/run_golden_evals.py --answers answers.json --verbose
```

---

## `baseline.json` — the list of things that are wrong today

Some cases fail. That is deliberate: they describe what Sahayak **should** do,
and a few of them describe things it does not do yet. Those are recorded in
`baseline.json` so they do not turn the build red every day, and each one names
the case file that explains it.

**The file only ever shrinks.** When you fix something, the run prints

```
FIXED — these are in the baseline and have started passing.
```

and you delete that line from `baseline.json`. Never add a line to quieten a new
failure — a new failure is the eval set doing its job.

To re-record the baseline after a deliberate change:

```
python scripts/run_golden_evals.py --update-baseline
```

---

## What happens in CI

The eval job runs on every push, inside the backend job.

- **No API key?** The answer half is skipped, loudly, and the build is not
  failed. A push from a fork has no secrets, and a missing secret must never be
  what turns a build red.
- **A key, and not one answer came back?** That **does** fail the build. It is
  not a skip: nothing was scored, so nothing could fail, and the report would
  otherwise read as coverage.
- **The `must_plan` and `must_define` half always runs**, key or no key, and a
  new failure there **does** fail the build. It is deterministic, so it cannot
  flake.
- **The answer half reports and does not gate**, until somebody records a run
  with a key (`--update-baseline`). Prose from a cheap model cannot be baselined
  by anyone who has not seen it.

This eval set is **not** part of `pytest`. The normal backend suite makes no
network calls and needs no key, and it stays that way. `tests/test_golden_evals.py`
is the eval set's presence in that suite: it checks the case files, the scoring
rules and the runner, all offline.

---

## Two rules for keeping this useful

**A case that flaps is a badly written case.** If it passes and fails on the
same commit, the rule is too tight — usually a `must_contain` demanding an exact
wording. Loosen it into alternatives, or lean on `must_not_contain` instead,
which is the more valuable half anyway: the wrong answers are a much smaller set
than the right ones.

**Nothing here judges an answer with another model.** Every rule is a plain text
or structure check. An LLM judge is a paid call per case per run, against a
product whose lifetime AI spend is $2.19 — and it would be scoring the assistant
with a model no more reliable than the one under test.
