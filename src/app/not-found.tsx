import Link from "next/link";
import { Compass } from "lucide-react";

export const metadata = { title: "Not found · REX" };

/** Unknown URL (e.g. a stale deep link): one clear way back into the workbench. */
export default function NotFound() {
  return (
    <div className="fixed inset-0 grid place-items-center bg-bg p-6 text-fg">
      <div className="max-w-[420px] text-center">
        <Compass size={26} strokeWidth={1.5} className="mx-auto text-faint" aria-hidden />
        <h1 className="mt-3 text-[15px] font-semibold">This page doesn’t exist</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">The link may be from an older version of REX. Everything lives in the workbench.</p>
        <Link href="/" className="btn btn-primary mt-4 no-underline">
          Open REX
        </Link>
      </div>
    </div>
  );
}
