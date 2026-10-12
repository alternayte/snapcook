export {
  CONTAINER,
  type DetectedItem,
  DetectionOutput,
  detect,
  detectionHint,
  normaliseQuantity,
  toProposals,
} from "./detect";
export {
  type Canonical,
  createIngredientMatcher,
  type IngredientMatcher,
  ingredientText,
  NEAREST_MIN_SIMILARITY,
} from "./matcher";
export { nameForms } from "./names";
