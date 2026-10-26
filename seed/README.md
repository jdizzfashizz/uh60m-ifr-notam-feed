This directory holds a single actual public FAA production initial-load snapshot
for bootstrap. It contains NOTAM data only, no credentials. Its retrieval time
and daily bulk reservation are recorded in state/ledger.json. The worker must
catch up incrementally before claiming current cache coverage.
