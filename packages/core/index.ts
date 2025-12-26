export { CommandAnalyzer, type AnalysisResult } from "./command-analyzer.js";
export { PathValidator } from "./path-validator.js";
export {
  DANGEROUS_COMMANDS,
  DANGEROUS_GIT_PATTERNS,
  DANGEROUS_PATTERNS,
  PLATFORM_PATHS,
  REDIRECT_PATTERN,
  SAFE_WRITE_PATHS,
  TEMP_PATHS,
} from "./constants.js";
export {
  checkForUpdates,
  CURRENT_VERSION,
  type UpdateCheckResult,
} from "./version-checker.js";
