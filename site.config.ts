/**
 * Personalise the site here. The profile links are already set; edit the title,
 * tagline, or introduction if you want different wording.
 */
export interface SiteConfig {
  /** Wordmark in the header and the browser tab title. */
  siteTitle: string;
  /** Small line next to the wordmark. */
  tagline: string;
  /** Your name, used in the About dialog and the sample-data notice. */
  authorName: string;
  /** Your X handle without the @. Leave empty to hide the X link. */
  xHandle: string;
  /** A sentence or two shown in the About dialog. */
  intro: string;
  /** Optional Substack (or any newsletter) URL. Leave empty to hide. */
  substackUrl: string;
  /** Optional LinkedIn profile URL. Leave empty to hide. */
  linkedinUrl: string;
  /**
   * Which dataset to show:
   *  - 'auto': your posts from content/posts.json; falls back to the labelled sample set while that file is empty
   *  - 'real': only your posts (shows the empty state until you add some)
   *  - 'demo': always the sample set
   */
  dataMode: 'auto' | 'real' | 'demo';
  /** Locale for dates on post cards, e.g. 'en-GB' -> 12 Mar 2026, 'en-US' -> Mar 12, 2026. */
  dateLocale: string;
}

export const siteConfig: SiteConfig = {
  siteTitle: 'Apoorav’s Field Notes',
  tagline: 'a map of the ideas I return to',
  authorName: 'Apoorav',
  xHandle: 'apoorav_vyas',
  intro:
    'A map of what I write about and how I write it. Explore a theme or tone to find the posts behind it.',
  substackUrl: 'https://apoorav.substack.com',
  linkedinUrl: 'https://www.linkedin.com/in/apooravvyas',
  dataMode: 'auto',
  dateLocale: 'en-GB',
};
