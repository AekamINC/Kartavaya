/**
 * The pickers barrel.
 *
 * One import for a form that needs to point at an entity:
 *
 *     import EntityPicker, { EntityField, contactSource } from '../components/pickers';
 *
 * The sources are exported alongside the component on purpose. A form that
 * reaches past this file and builds its own `EntitySource` inline is the moment
 * `serverSearch` gets guessed, and guessing it `false` on a capped endpoint is
 * the silent 92-missing-contacts defect `entitySource.ts` exists to prevent.
 * Add a source THERE, next to the others, where the endpoint's LIMIT is on the
 * page next to the flag that answers for it.
 */
export { default, default as EntityPicker, EntityField } from './EntityPicker';
export type { EntityPickerProps, EntityFieldProps } from './EntityPicker';

export {
  assigneeSource, clientSource, contactSource, productSource,
  listMeta, localFilter, localMatch, looksLikeId, paramSignature, requestParams,
  shouldAskServer, toOptions, truncationNotice, unwrapRows,
} from './entitySource';
export type { EntitySource, ListMeta, Normalised, PickerNotice, PickerOption, Row }
  from './entitySource';
