/**
 * Shared primitives for resource detail pages.
 *
 * Use the named exports rather than importing from the individual modules so
 * that the public surface of `components/detail` is greppable in one place.
 */
export { formatDate, formatRelative } from "./formatting";
export { useDetailStyles } from "./useDetailStyles";
export { Meta } from "./Meta";
export { DateWithRelative } from "./DateWithRelative";
export {
  IdentifiersAccordion,
  type IdentifierItem,
} from "./IdentifiersAccordion";
