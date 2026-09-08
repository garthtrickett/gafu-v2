# FSRS transitions are preserved as events

Study schedules with a pinned FSRS adapter and stores every answer as an
append-only Review Event containing the before/after schedule and algorithm
version. Scheduler upgrades affect future transitions only, so an application
upgrade cannot silently rewrite the learner's history.
