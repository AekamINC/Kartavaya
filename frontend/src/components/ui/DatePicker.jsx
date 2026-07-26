/**
 * DatePicker — 02-common-components.md §3 asks for one, because every date in
 * the build is a bare `<input type="date">` whose popup is the browser's and
 * therefore renders in a different language, a different first-day-of-week and
 * a different theme on every machine.
 *
 * 26-component-inventory.md §4 then folded the calendar into the unified Picker
 * as `mode="date"`, so this is the named entry point, not a second
 * implementation. There is exactly one calendar in the app.
 */
export { PickerDate as DatePicker, PickerDate as default } from './Picker';
