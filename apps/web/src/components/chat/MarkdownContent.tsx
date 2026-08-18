import React from "react";

export function parseInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/);
  return (
    <>
      {parts.map((part, i) => {
        if (/^\*\*[^*]+\*\*$/.test(part))
          return (
            <strong key={i} className="font-semibold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        if (/^`[^`]+`$/.test(part))
          return (
            <code
              key={i}
              className="rounded bg-secondary px-1 py-0.5 font-mono text-[11.5px] text-foreground"
            >
              {part.slice(1, -1)}
            </code>
          );
        if (/^\*[^*]+\*$/.test(part))
          return (
            <em key={i} className="italic text-muted-foreground">
              {part.slice(1, -1)}
            </em>
          );
        return part;
      })}
    </>
  );
}

export function MarkdownContent({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      // Three levels, three sizes, one ink. Three ink strengths for three
      // heading levels is the hand-made fourth weight the rule forbids.
      const cls =
        level === 1
          ? "text-[13.5px] font-bold text-foreground mt-3 mb-1 first:mt-0"
          : level === 2
            ? "text-[13px] font-semibold text-foreground mt-2.5 mb-0.5 first:mt-0"
            : "text-[12px] font-semibold text-foreground mt-2 mb-0.5 first:mt-0";
      elements.push(
        <div key={i} className={cls}>
          {parseInline(headingMatch[2])}
        </div>,
      );
      i++;
      continue;
    }

    if (/^[-*•]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^[-*•]\s+/, "");
        items.push(
          <li key={i} className="flex gap-2.5 items-start">
            <span className="w-1.5 h-1.5 rounded-full bg-dim flex-shrink-0 mt-[5px] ml-0.5 select-none" />
            <span>{parseInline(itemText)}</span>
          </li>,
        );
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="flex flex-col gap-0.5 my-1">
          {items}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      let num = 1;
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\d+\.\s+/, "");
        items.push(
          <li key={i} className="flex gap-2 items-start">
            <span className="text-dim font-mono text-[11px] flex-shrink-0 w-4">
              {num}.
            </span>
            <span>{parseInline(itemText)}</span>
          </li>,
        );
        i++;
        num++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="flex flex-col gap-0.5 my-1">
          {items}
        </ol>,
      );
      continue;
    }

    if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }

    elements.push(
      <p key={i} className="leading-relaxed">
        {parseInline(line)}
      </p>,
    );
    i++;
  }

  return <>{elements}</>;
}
