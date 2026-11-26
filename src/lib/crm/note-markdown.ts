import { marked, type Token, type Tokens } from "marked";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function renderTokens(tokens: Token[]): string {
  return tokens.map(renderToken).join("");
}

function renderToken(token: Token): string {
  switch (token.type) {
    case "paragraph":
      return `<p>${renderTokens((token as Tokens.Paragraph).tokens)}</p>`;
    case "text": {
      const text = token as Tokens.Text;
      return text.tokens ? renderTokens(text.tokens) : esc(text.text);
    }
    case "strong":
      return `<strong>${renderTokens((token as Tokens.Strong).tokens)}</strong>`;
    case "em":
      return `<em>${renderTokens((token as Tokens.Em).tokens)}</em>`;
    case "codespan":
      return `<code>${esc((token as Tokens.Codespan).text)}</code>`;
    case "code":
      return `<pre><code>${esc((token as Tokens.Code).text)}</code></pre>`;
    case "br":
      return "<br>";
    case "space":
    case "html":
    case "hr":
      return "";
    case "link": {
      const link = token as Tokens.Link;
      const href = safeHref(link.href);
      const label = renderTokens(link.tokens);
      if (!href) return label;
      return `<a href="${esc(href)}" rel="noreferrer noopener" target="_blank">${label}</a>`;
    }
    case "heading": {
      const heading = token as Tokens.Heading;
      const level = heading.depth <= 2 ? 2 : 3;
      return `<h${level}>${renderTokens(heading.tokens)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${renderTokens((token as Tokens.Blockquote).tokens)}</blockquote>`;
    case "list": {
      const list = token as Tokens.List;
      const tag = list.ordered ? "ol" : "ul";
      const items = list.items
        .map((item) => `<li>${renderTokens(item.tokens)}</li>`)
        .join("");
      return `<${tag}>${items}</${tag}>`;
    }
    default:
      return "";
  }
}

/** Markdown for lead notes. Raw HTML is dropped. Links are http(s) only. */
export function renderNoteMarkdown(source: string): string {
  return renderTokens(marked.lexer(source, { gfm: true, breaks: true }));
}
