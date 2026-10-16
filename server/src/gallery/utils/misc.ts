import { SystemConfig } from 'src/dtos/config.dto.js';
import { isMachineLearningEnabled } from 'src/utils/misc.js';

export const isPetDetectionEnabled = (machineLearning: SystemConfig['machineLearning']) =>
  isMachineLearningEnabled(machineLearning) && machineLearning.petDetection.enabled;
export const isPetRecognitionEnabled = (machineLearning: SystemConfig['machineLearning']) =>
  isMachineLearningEnabled(machineLearning) && machineLearning.petRecognition.enabled;
/**
 * Species eligible for individual pet recognition. The re-ID model is a DINOv2 backbone trained on
 * dog and cat identities only, so it has no notion of what distinguishes one bird or one horse from
 * another — embedding those produces arbitrary neighbours and arbitrary clusters. The detector is
 * RF-DETR, a general COCO model narrowed to six animal classes (bird, cat, dog, horse, sheep, cow),
 * so everything outside this set must stay on the species-bucket path it used before individual
 * recognition existed.
 */
export const RECOGNIZABLE_PET_SPECIES: ReadonlySet<string> = new Set(['dog', 'cat']);
export const isRecognizablePetSpecies = (species: string) => RECOGNIZABLE_PET_SPECIES.has(species.toLowerCase());
// Deliberately gated on `facialRecognition.enabled` rather than `isFacialRecognitionEnabled`: face
// suggestions are a pure vector query over embeddings that already exist and never call the machine
// learning service, so the ML master switch must not disable them. Turning that switch off to reclaim
// resources after a library is scanned is a supported configuration (the e2e stack runs that way),
// and it previously left suggestions working.
export const isFaceSuggestionEnabled = (machineLearning: SystemConfig['machineLearning']) =>
  machineLearning.facialRecognition.enabled &&
  machineLearning.facialRecognition.suggestions.enabled &&
  machineLearning.facialRecognition.suggestions.maxDistance > machineLearning.facialRecognition.maxDistance;
