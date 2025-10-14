
export const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const forceLog = process.env.FORCE_LOG === 'true';

/**
 * Outputs a message for general information.
 * This log will always be visible.
 * @param {...any[]} args - The message parts to log.
 */
export function infoLog(...args: any[]) {
  console.log(...args);
}

/**
 * Outputs a detailed message for debugging.
 * This log will be hidden in GitHub Actions unless FORCE_LOG is set to 'true'.
 * @param {...any[]} args - The message parts to log.
 */
export function debugLog(...args: any[]) {
  if (!isGitHubActions || forceLog) {
    console.log(...args);
  }
}

/**
 * Outputs an error message.
 * This log will always be visible.
 * @param {...any[]} args - The message parts to log.
 */
export function errorLog(...args: any[]) {
  console.error(...args);
}
