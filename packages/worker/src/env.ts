export interface Env {
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  ACCESS_AUD: string;
  ACCESS_TEAM_DOMAIN: string;
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_PRIVATE_KEY: string;
  /** Set to "1" in local dev to bypass Access and act as DEV_USER. */
  DEV_BYPASS_AUTH?: string;
  DEV_USER?: string;
}
