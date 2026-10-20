import { useEffect, useState } from "react";
import {
  StatsUnavailable,
  isCounted,
  loadActiveUsers,
  setCounted,
  type ActiveUsers,
} from "../lib/usage.ts";

const count = new Intl.NumberFormat();
const dayLong = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const dayShort = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

// Days come back as plain dates (UTC); read them as local noon so they never shift a day.
const asDate = (day: string) => new Date(`${day}T12:00:00`);
const people = (n: number) =>
  `${count.format(n)} ${n === 1 ? "person" : "people"}`;

function summary(s: ActiveUsers): string {
  const since = s.since ? ` since ${dayLong.format(asDate(s.since))}` : "";
  return (
    `PlayPen${since}: ${count.format(s.total)} active users, ${count.format(s.month)} in the last 30 days, ` +
    `${count.format(s.returning)} came back on another day.`
  );
}

/** The developer's active-users page at /stats. Not linked from the app. */
export function Stats() {
  const [stats, setStats] = useState<ActiveUsers | null>(null);
  const [error, setError] = useState<{ text: string; setup: boolean } | null>(
    null,
  );
  const [counted, setCountedState] = useState(isCounted);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "PlayPen active users";
    loadActiveUsers().then(setStats, (e: Error) =>
      setError({ text: e.message, setup: e instanceof StatsUnavailable }),
    );
  }, []);

  const toggleCounted = () => {
    setCounted(!counted);
    setCountedState(!counted);
  };

  const copy = async () => {
    if (!stats) return;
    try {
      await navigator.clipboard.writeText(summary(stats));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("Copy this:", summary(stats));
    }
  };

  return (
    // The page scrolls inside its own box: the body is fixed at the window's height for the
    // room, and its background wouldn't reach below the fold.
    <main className="stats-page">
      <div className="stats">
        <header className="stats-head">
          <div>
            <h1 className="stats-title">Active users</h1>
            {stats && (
              <p className="stats-since">
                {stats.since
                  ? `Counting since ${dayLong.format(asDate(stats.since))}.`
                  : "Nobody counted yet. People who open the live site show up here."}
              </p>
            )}
          </div>
          {stats && (
            <button className="btn" onClick={copy}>
              {copied ? "Copied" : "Copy summary"}
            </button>
          )}
        </header>

        {error && (
          <p
            className={error.setup ? "stats-note" : "stats-note stats-error"}
            role="alert"
          >
            {error.text}
          </p>
        )}
        {!stats && !error && <p className="stats-since">Loading…</p>}

        {stats && (
          <>
            <dl className="stats-main">
              <Figure value={count.format(stats.total)} label="all time" />
              <Figure value={count.format(stats.month)} label="last 30 days" />
              <Figure value={count.format(stats.week)} label="last 7 days" />
              <Figure value={count.format(stats.today)} label="today" />
            </dl>
            <dl className="stats-more">
              <Figure
                value={count.format(stats.returning)}
                label="came back"
                detail="opened PlayPen on two or more days"
              />
            </dl>
            <DailyChart daily={stats.daily} />
          </>
        )}

        <section className="stats-foot">
          <p>
            A user is a browser that had PlayPen open that day, whether or not
            anything was playing. The same person on a phone and a laptop counts
            twice. Only the live site counts, never local development or
            automated browsers. Nothing personal is kept, only a random id per
            browser and the days it was active. Days are in UTC.
          </p>
          <label className="stats-toggle">
            <input type="checkbox" checked={counted} onChange={toggleCounted} />
            Count this browser
          </label>
          <a className="btn btn-quiet" href="/">
            Back to PlayPen
          </a>
        </section>
      </div>
    </main>
  );
}

function Figure({
  value,
  label,
  detail,
}: {
  value: string;
  label: string;
  detail?: string;
}) {
  return (
    <div className="stats-figure">
      <dt>{label}</dt>
      <dd className="stats-value">{value}</dd>
      {detail && <dd className="stats-detail">{detail}</dd>}
    </div>
  );
}

function DailyChart({ daily }: { daily: ActiveUsers["daily"] }) {
  const peak = Math.max(1, ...daily.map((d) => d.users));
  const W = 900;
  const H = 160;
  const step = W / daily.length;
  const busiest = daily.reduce((a, d) => (d.users > a.users ? d : a), daily[0]);

  return (
    <figure className="stats-chart">
      <figcaption>
        Active users per day, last 90 days
        <span className="stats-detail">
          {busiest.users
            ? `Busiest: ${dayShort.format(asDate(busiest.day))}, with ${people(busiest.users)}.`
            : "No active days yet."}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H + 1}`}
        role="img"
        aria-label={`Active users per day over the last 90 days, at most ${peak}.`}
      >
        <line className="stats-axis" x1="0" x2={W} y1={H + 0.5} y2={H + 0.5} />
        {daily.map((d, i) => {
          const h = d.users ? Math.max(3, (d.users / peak) * (H - 8)) : 0;
          return (
            <rect
              key={d.day}
              className={
                i === daily.length - 1
                  ? "stats-bar stats-bar-today"
                  : "stats-bar"
              }
              x={i * step + 1}
              y={H - h}
              width={Math.max(1, step - 2)}
              height={h}
              rx="2"
            >
              <title>{`${dayShort.format(asDate(d.day))}: ${people(d.users)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="stats-ticks" aria-hidden="true">
        <span>{dayShort.format(asDate(daily[0].day))}</span>
        <span>Today</span>
      </div>
    </figure>
  );
}
