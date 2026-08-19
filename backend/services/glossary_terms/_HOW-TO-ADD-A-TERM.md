# How to add a term

Every other file in this folder is one word the assistant kept getting wrong.
Copy the closest one, rename it, change the three parts. Nothing else has to
happen: no database, no migration, no screen to fill in.

A file is exactly this shape:

    # the word

    ## Also called
    the other words people type for it, separated by commas

    ## What it means here
    what it actually is in this product

    ## A wrong answer looks like
    the sentence you do not want to read, and why it is wrong

The rules that matter:

- **The first line is `# ` and then the word.** That word, plus everything under
  **Also called**, is what a question is matched against. A question containing
  none of them never sees the term at all — which is the point. A glossary that
  is sent in full teaches nothing.
- **Write the Hindi spellings under Also called as well.** Matching is on the
  letters, not on the meaning, so a file whose words are all English is invisible
  to every question typed in Devanagari — and those arrive: "इस क्लाइंट का कितना
  भुगतान बाकी है?" was asked on staging by a real user. Include the
  transliterations, not only the pure Hindi, because "पेमेंट" is typed far more
  often than "भुगतान". Devanagari is the only Indic script matched; a Gujarati or
  Tamil question reaches a term through whatever English word is left in it,
  which in practice is most of them.
- **But not a Hindi word that is also an ordinary Hindi word.** The module names
  are where this bites: पहचान is Pahchan and it is also just "identify", so a
  file carrying it would explain the attendance module to somebody who asked
  about neither attendance nor this product. That is why `module-names.md` has no
  Hindi spellings — the English names are what people type for the modules
  anyway.
- **At most four terms are sent with any one question**, most specific first. A
  short file that is right beats a long file that is thorough, and a fifth
  definition pushes the actual question further from where the model is reading.
- **Write the wrong answer as a sentence somebody might really read.** Naming
  the wrong answer works better than describing it on the small, cheap models
  this runs on — the rest of the assistant's prompt is written the same way for
  the same reason.
- **Do not put record numbers, `[1]` markers, table names or amounts in here.**
  This is vocabulary, not evidence. The assistant is told it may not cite it.
- **Files whose name starts with `_` are notes, not terms.** This one is.
- A file that cannot be read is skipped so the assistant keeps working, and
  `backend/tests/test_glossary.py` goes red so it does not stay broken quietly.

Layout inside a section is free — line breaks and blank lines are collapsed
before the text is sent, so write it however it reads best here.
