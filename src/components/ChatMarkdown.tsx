import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// The assistant writes in markdown. Rendered raw, its bold markers and list dashes showed
// up as literal characters. HTML in the source is not parsed (no rehype-raw), so a reply
// can never inject markup into the page.
export default function ChatMarkdown({ children, tone = "assistant" }: {
  children: string;
  tone?: "assistant" | "user";
}) {
  const link = tone === "user" ? "underline underline-offset-2" : "text-primary underline underline-offset-2";
  const code = tone === "user"
    ? "rounded bg-primary-foreground/15 px-1 py-0.5 text-[0.85em]"
    : "rounded bg-background/70 px-1 py-0.5 text-[0.85em]";
  const rule = tone === "user" ? "border-primary-foreground/25" : "border-border";

  return (
    <div className="space-y-2 leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap break-words">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="break-words">{children}</li>,
          // Headings inside a chat bubble should read as emphasis, not as page titles.
          h1: ({ children }) => <p className="font-semibold">{children}</p>,
          h2: ({ children }) => <p className="font-semibold">{children}</p>,
          h3: ({ children }) => <p className="font-semibold">{children}</p>,
          h4: ({ children }) => <p className="font-semibold">{children}</p>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className={link}>{children}</a>
          ),
          code: ({ children }) => <code className={code}>{children}</code>,
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-lg bg-background/70 p-2 text-[0.85em]">{children}</pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className={`border-l-2 pl-3 opacity-90 ${rule}`}>{children}</blockquote>
          ),
          hr: () => <hr className={rule} />,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[0.9em]">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className={`border-b py-1 pr-3 font-semibold ${rule}`}>{children}</th>,
          td: ({ children }) => <td className="py-1 pr-3 align-top">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
