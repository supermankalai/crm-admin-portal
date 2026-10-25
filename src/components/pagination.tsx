import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Server-rendered pagination that keeps the other query parameters (filters) intact. */
export function Pagination({
  page,
  pageCount,
  total,
  noun,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  total: number;
  noun: string;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const href = (p: number) => {
    const search = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
    if (p > 1) search.set("page", String(p));
    else search.delete("page");
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-2 border-t p-4 text-sm text-muted-foreground">
      <span>
        {total.toLocaleString("en-IN")} {noun}
      </span>
      <div className="flex items-center gap-2">
        <span>
          Page {page} of {pageCount}
        </span>
        {page > 1 ? (
          <Button asChild variant="outline" size="icon" aria-label="Previous page">
            <Link href={href(page - 1)}>
              <ChevronLeft />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="icon" disabled aria-label="Previous page">
            <ChevronLeft />
          </Button>
        )}
        {page < pageCount ? (
          <Button asChild variant="outline" size="icon" aria-label="Next page">
            <Link href={href(page + 1)}>
              <ChevronRight />
            </Link>
          </Button>
        ) : (
          <Button variant="outline" size="icon" disabled aria-label="Next page">
            <ChevronRight />
          </Button>
        )}
      </div>
    </nav>
  );
}
