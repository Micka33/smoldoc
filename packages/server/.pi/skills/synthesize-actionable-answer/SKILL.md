---
name: synthesize-actionable-answer
description: From evidence JSON + goal, produce the final structured SMOLDOC_RESULT_JSON and a short markdown summary for humans.
---

# synthesize-actionable-answer

You (the Pi model) must output:

1. Short markdown (Action / Command / Notes / Sources).
2. Final line **exactly**:

`SMOLDOC_RESULT_JSON:{...}`

The JSON must validate this shape:

- `recommended_action` (string)
- `command` (optional string)
- `example` (optional string)
- `assumptions` (string array)
- `version_target` (string — resolved version label)
- `sources` (URL array)
- `confidence` (0..1)
- `needs_human_review` (boolean — true if evidence weak or contradictory)
- `evidence` (array of `{ url, excerpt, title? }`)
- `answer_summary` (optional string)
- `pages_fetched` (int)
- `parallel_branches` (int)

Ground every technical claim in `evidence` excerpts.
