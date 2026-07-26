/**
 * Vikram Samvat — the year, and deliberately nothing else.
 * 05-today-dashboard.md §"Six real bugs", item 6.
 *
 * The date line used to render a month name too, computed as a naive `+1`
 * offset from the Gregorian month. Vikram Samvat months follow a lunar calendar
 * and do not align to Gregorian boundaries at all, so the named month was wrong
 * for most of any given month.
 *
 * The YEAR is a different case. It rolls over at Chaitra Śukla Pratipadā, a
 * lunar date that lands anywhere from mid-March to mid-April, so approximating
 * the rollover at 1 April is right to within a couple of weeks once a year —
 * honest enough for a decorative line. The month name was not, and showing a
 * specific Hindu month that is wrong is worse than showing none, particularly
 * to the audience most likely to notice.
 *
 * If a real panchāng source is ever wired in, `vikramLabel` is the one place
 * that has to learn about months.
 */
export function vikramYear(now = new Date()) {
  return now.getFullYear() + 56 + (now.getMonth() >= 3 ? 1 : 0);
}

/** The decorative date-line fragment. Year only — see above. */
export function vikramLabel(now = new Date()) {
  return `विक्रम संवत् ${vikramYear(now)}`;
}
