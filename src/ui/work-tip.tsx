"use client";

import Link from "next/link";
import { ChevronRight, Lightbulb, X } from "lucide-react";
import { useStoredPref } from "./stored-pref";
import type { WorkTip } from "./work-tips";

/**
 * The rail's tip card: one documented rule that applies to what is currently on screen.
 *
 * ## Why it can be dismissed, and why dismissal is permanent
 *
 * A panel of hints is worth having the first week and is clutter by the second, and the
 * reader is the only one who knows which week they are in. The X hides the card for good in
 * this browser — not "for this tip", because the tips are contextual: hiding one would just
 * surface the next one tomorrow, and someone reaching for the X wants the corner of their
 * screen back, not a different sentence in it.
 *
 * `localStorage` and not a column: this is a browser preference, invisible to the server and
 * to everyone else, so it belongs nowhere near the record. See `stored-pref.ts`.
 *
 * A client island for the dismissal alone — the tip itself is CHOSEN on the server
 * (`work-tips.ts`, from the viewer's queue) and handed in as data, so no policy text and no
 * queue state crosses into the browser bundle beyond the one sentence being displayed.
 */

const TIPS_KEY = "qams-work-tips";

export function WorkTipCard({ tip }: { tip: WorkTip }) {
  const [hidden, setHidden] = useStoredPref(TIPS_KEY, "");

  /* The fallback is "", so the first server render and the first client render agree and
     hydration is clean; someone who dismissed this earlier sees it for one frame and then
     it goes. The same trade the sidebar makes for its collapse and theme preferences. */
  if (hidden === "off") return null;

  return (
    <section className="card work-rail-card work-tip" aria-label="Tip">
      <div className="work-tip-head">
        <span className="work-tip-icon" aria-hidden>
          <Lightbulb size={15} />
        </span>
        <h2 className="work-tip-title">{tip.title}</h2>
        {/* A real button with a real name: an unlabelled X is a mystery to a screen reader,
            and this one throws something away permanently. */}
        <button
          type="button"
          className="icon-btn work-tip-close"
          onClick={() => setHidden("off")}
          aria-label="Hide tips"
          title="Hide tips"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      <p className="work-tip-body">{tip.body}</p>
      {tip.href && tip.linkLabel ? (
        /* An in-app destination, never an external "Learn more": there is no docs site to
           send anyone to, and a link that leaves the tool mid-run is a poor trade for a
           sentence that already said the thing. */
        <Link className="work-tip-link" href={tip.href}>
          {tip.linkLabel}
          <ChevronRight size={13} aria-hidden />
        </Link>
      ) : null}
    </section>
  );
}
