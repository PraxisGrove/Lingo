const paragraph = 'This is the article content readers should see translated.';
const outside =
  '<footer><p>Outside the article and should remain original.</p></footer>';

// Representative layouts, kept local so regressions are reproducible and
// never depend on a live website or disclose user browsing content.
export const SITE_LAYOUTS = [
  {
    hostname: 'en.wikipedia.org',
    html: `<div id="bodyContent"><p>${paragraph}</p><div class="navbox"><p>Excluded navigation</p></div></div>${outside}`,
  },
  {
    hostname: 'developer.mozilla.org',
    html: `<main><p>${paragraph}</p><pre><p>Excluded code block</p></pre></main>${outside}`,
  },
  {
    hostname: 'github.com',
    html: `<div class="markdown-body"><p>${paragraph}</p><div class="highlight"><p>Excluded code example</p></div></div>${outside}`,
  },
  {
    hostname: 'stackoverflow.com',
    html: `<div class="s-prose"><p>${paragraph}</p><div class="js-voting-container"><p>Excluded vote controls</p></div></div>${outside}`,
  },
  {
    hostname: 'news.ycombinator.com',
    html: `<span class="commtext">${paragraph}</span><div class="reply"><p>Excluded reply controls</p></div>${outside}`,
  },
  {
    hostname: 'www.reddit.com',
    html: `<div slot="text-body"><p>${paragraph}</p><div data-testid="advertisement"><p>Excluded advertisement</p></div></div>${outside}`,
  },
  {
    hostname: 'arxiv.org',
    html: `<div id="abs"><blockquote class="abstract"><p>${paragraph}</p></blockquote><div class="metatable"><p>Excluded metadata</p></div></div>${outside}`,
  },
  {
    hostname: 'docs.python.org',
    html: `<div class="body"><p>${paragraph}</p></div><aside class="sphinxsidebar"><p>Excluded sidebar</p></aside>${outside}`,
  },
  {
    hostname: 'react.dev',
    html: `<main><p>${paragraph}</p><nav><p>Excluded navigation</p></nav></main>${outside}`,
  },
  {
    hostname: 'nextjs.org',
    html: `<article><p>${paragraph}</p><nav><p>Excluded navigation</p></nav></article>${outside}`,
  },
];

export const SITE_PARAGRAPH = paragraph;
