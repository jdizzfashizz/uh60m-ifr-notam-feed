# UH-60M IFR Planner — shared NOTAM cache

This repository contains only the FAA NMS production feed updater and public
NOTAM data. The planner application stays on its existing Firebase Hosting site.
It contains no FAA keys, credential workbook, planner source or flight plans.

## Safety and scope

This is **cached, airport/location-associated advisory data**, never a complete
official briefing or automatic determination of procedure availability. Always
obtain an authoritative FAA/DoD briefing covering the route, airspace, FDC, GPS,
NAVAIDs and schedules. No matching record does not mean no restriction.

The published data carries the original FAA-provided text, identifier, effective
times, source, last successful synchronization and incomplete/stale indicators.
FAA authentication and data processing happen in GitHub Actions, not browsers.
Unknown/missing text or times remain incomplete. Cancelled and replaced records
are processed using their supplied identities/references, not keyword guesses.

## Schedule and pull limits

- Standard free Ubuntu GitHub-hosted runner in this public repository.
- Scheduled every five minutes, with one serialized workflow at a time. GitHub
  can delay jobs; this is not a guaranteed five-minute service.
- A committed reservation enforces at least 180 seconds between FAA data-pull
  attempts and at least 24 hours between bulk attempts, including failures.
- The initial seed is an actual FAA production load retrieved on 26 Oct 2026.
  Its pull reservation is retained so initial deployment cannot repeat the bulk
  request inside the FAA's 24-hour limit.
- Incremental requests overlap their last committed coverage timestamp. A gap
  exceeding the FAA's 24-hour incremental window remains incomplete until a
  permitted bulk recovery. A fresh bulk requires incremental catch-up.
- Clients only read shared static JSON; adding users does not add FAA queries.
- At 12 minutes without a successful sync, the client must warn that data is
  stale even if the static JSON was cached by a CDN or browser.
- Scheduled workflows in public repositories can be disabled after inactivity;
  actual sync timestamps must be checked before use.

## Secrets and permissions

Configure these two repository **Actions secrets**, never repository files:
`FAA_NMS_PRODUCTION_CLIENT_ID` and `FAA_NMS_PRODUCTION_CLIENT_SECRET`.
Only the pull step receives them. No pull-request or fork event runs the feed.
TLS verification stays enabled; credentials/bearers follow only the official
FAA production host and validated same-host content paths.

## No-billing setup

Firebase remains on Spark. Do not enable larger runners, Git LFS, paid cache
expansion or paid account features. Keep Actions cache at the default included
10 GB or below. Pages artifacts are removed after deployment, including cleanup
on failures; no historical NOTAM artifacts are intentionally retained. A small
initial seed stays in Git; changing runtime snapshots use the bounded Actions
cache instead of creating large recurring Git history.

If a free quota, schedule or service fails, publication may stop. The planner
must report age/unavailability, never imply an updated official briefing.
